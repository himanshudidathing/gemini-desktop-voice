import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { VLMProviderV2 } from '@main/store/types';
import {
  GEMINI_BASE_URL,
  GEMINI_DEFAULT_MODEL,
} from '@main/shared/modelProviders';
import { DEFAULT_LIVE_MODEL } from '@main/shared/voice';
import { useSetting } from '@renderer/hooks/useSetting';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { api } from '@renderer/api';

const schema = z.object({
  vlmApiKey: z.string().trim().min(1, 'Enter your Google API key.'),
  vlmModelName: z
    .string()
    .regex(/^gemini-[a-zA-Z0-9._-]+$/, 'Enter a Gemini task model ID.'),
  liveModelName: z
    .string()
    .regex(/^gemini-[a-zA-Z0-9._-]+$/, 'Enter a Gemini Live model ID.'),
  assistantName: z.string().trim().min(2).max(32),
  voiceName: z.enum(['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir']),
});
type Values = z.infer<typeof schema>;
export interface VLMSettingsRef {
  submit: () => Promise<Values>;
}
export function VLMSettings({
  ref,
  autoSave = false,
  className = '',
}: {
  ref?: React.RefObject<VLMSettingsRef | null>;
  autoSave?: boolean;
  className?: string;
}) {
  const { settings, updateSetting } = useSetting();
  const [draft, setDraft] = useState<Values>({
    vlmApiKey: '',
    vlmModelName: GEMINI_DEFAULT_MODEL,
    liveModelName: DEFAULT_LIVE_MODEL,
    assistantName: 'Gemini',
    voiceName: 'Aoede',
  });
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  useEffect(() => {
    if (!Object.keys(settings).length || dirty.current) return;
    setDraft({
      vlmApiKey: settings.vlmApiKey || '',
      vlmModelName: settings.vlmModelName || GEMINI_DEFAULT_MODEL,
      liveModelName: settings.liveModelName || DEFAULT_LIVE_MODEL,
      assistantName: settings.assistantName || 'Gemini',
      voiceName: settings.voiceName || 'Aoede',
    });
  }, [settings]);
  const save = async () => {
    const result = schema.safeParse(draft);
    if (!result.success) {
      const message = result.error.issues[0].message;
      setError(message);
      throw new Error(message);
    }
    await updateSetting({
      ...settings,
      ...result.data,
      vlmProvider: VLMProviderV2.gemini,
      vlmBaseUrl: GEMINI_BASE_URL,
      useResponsesApi: false,
    });
    dirty.current = false;
    setError('');
    return result.data;
  };
  useImperativeHandle(ref, () => ({ submit: save }));
  useEffect(() => {
    if (!autoSave || !dirty.current || !schema.safeParse(draft).success) return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, autoSave]);
  function change(key: keyof Values, value: string) {
    dirty.current = true;
    setDraft((old) => ({ ...old, [key]: value }));
  }
  return (
    <div className={`space-y-5 ${className}`}>
      <div className="rounded-xl border bg-blue-50 p-4 text-sm text-slate-700">
        <b>Google Gemini only</b>
        <p className="mt-1">
          One Google AI Studio key powers desktop actions, audio uploads, and
          Live voice. Free-tier access depends on your Google project and
          quotas.
        </p>
      </div>
      <label className="block space-y-2 text-sm font-medium">
        Google API key
        <div className="flex gap-2">
          <Input
            type={showKey ? 'text' : 'password'}
            value={draft.vlmApiKey}
            onChange={(e) => change('vlmApiKey', e.target.value)}
            placeholder="Google AI Studio API key"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </Button>
        </div>
      </label>
      <label className="block space-y-2 text-sm font-medium">
        Gemini task model
        <Input
          value={draft.vlmModelName}
          onChange={(e) => change('vlmModelName', e.target.value)}
        />
      </label>
      <label className="block space-y-2 text-sm font-medium">
        Gemini Live audio model
        <Input
          value={draft.liveModelName}
          onChange={(e) => change('liveModelName', e.target.value)}
        />
      </label>
      <label className="block space-y-2 text-sm font-medium">
        Assistant name / wake phrase
        <Input
          value={draft.assistantName}
          maxLength={32}
          onChange={(e) => change('assistantName', e.target.value)}
        />
        <span className="block text-xs font-normal text-slate-500">
          For example: “{draft.assistantName || 'Gemini'}, open the browser.”
          Say the name alone, then give a task within 12 seconds.
        </span>
      </label>
      <label className="block space-y-2 text-sm font-medium">
        Speaking voice
        <select
          className="w-full rounded-md border bg-white px-3 py-2"
          value={draft.voiceName}
          onChange={(e) => change('voiceName', e.target.value)}
        >
          {['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir'].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <ModelAvailabilityCheck
        modelConfig={{
          baseUrl: GEMINI_BASE_URL,
          apiKey: draft.vlmApiKey,
          modelName: draft.vlmModelName,
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="button" onClick={() => void save().catch(() => {})}>
        Save Gemini settings
      </Button>
    </div>
  );
}

export function ModelAvailabilityCheck({
  modelConfig,
  disabled = false,
  className = '',
  onResponseApiSupportChange,
}: {
  modelConfig: {
    baseUrl: string;
    apiKey: string;
    modelName: string;
    provider?: VLMProviderV2;
  };
  disabled?: boolean;
  className?: string;
  onResponseApiSupportChange?: (supported: boolean) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  return (
    <div className={`space-y-2 ${className}`}>
      <Button
        type="button"
        variant="outline"
        disabled={
          disabled || checking || !modelConfig.apiKey || !modelConfig.modelName
        }
        onClick={async () => {
          setChecking(true);
          setMessage('');
          setFailed(false);
          try {
            const available = await api.checkModelAvailability(modelConfig);
            onResponseApiSupportChange?.(false);
            setMessage(
              available
                ? 'Gemini task model is connected. Enable voice to check the Live connection.'
                : 'The model returned no text.',
            );
            setFailed(!available);
          } catch (error) {
            setFailed(true);
            setMessage(
              error instanceof Error
                ? error.message
                : 'Could not connect to Google.',
            );
          } finally {
            setChecking(false);
          }
        }}
      >
        {checking && <Loader2 className="mr-2 size-4 animate-spin" />}Check
        Gemini connection
      </Button>
      {message && (
        <p
          role="status"
          className={`text-sm ${failed ? 'text-red-600' : 'text-green-700'}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
