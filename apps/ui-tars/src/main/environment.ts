import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { GEMINI_DEFAULT_MODEL } from './shared/modelProviders';
import { DEFAULT_ASSISTANT_NAME, DEFAULT_LIVE_MODEL } from './shared/voice';

type VoiceName = 'Aoede' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';
type GeminiDefaults = {
  vlmApiKey: string;
  vlmModelName: string;
  liveModelName: string;
  assistantName: string;
  voiceName: VoiceName;
  providerMode: 'GOOGLE' | 'GROQ' | 'BOTH';
  groqApiKey: string;
  groqModel: string;
  speechInputModel: string;
  speechOutputModel: string;
};

export function resolveGeminiEnvironment(environment: NodeJS.ProcessEnv) {
  const defaults: GeminiDefaults = {
    vlmApiKey: '',
    vlmModelName: GEMINI_DEFAULT_MODEL,
    liveModelName: DEFAULT_LIVE_MODEL,
    assistantName: DEFAULT_ASSISTANT_NAME,
    voiceName: 'Aoede',
    providerMode: 'GOOGLE',
    groqApiKey: '',
    groqModel: 'qwen/qwen3.8-27b',
    speechInputModel: 'gemini-3.5-transcribe-live',
    speechOutputModel: 'gemini-3.8-flash-lite-tts',
  };
  const overrides: Partial<GeminiDefaults> = {};
  const model = (key: string) => {
    const value = environment[key]?.trim();
    const pattern =
      key === 'GEMINI_MODEL'
        ? /^(gemini-[a-zA-Z0-9._-]+|gemma-4-(31b|26b-a4b)-it)$/
        : /^gemini-[a-zA-Z0-9._-]+$/;
    if (value && !pattern.test(value))
      throw new Error(`${key} must contain a supported Google model ID.`);
    return value;
  };
  const key = environment.GEMINI_API_KEY?.trim();
  const taskModel = model('GEMINI_MODEL');
  const liveModel = model('GEMINI_LIVE_MODEL');
  const name = environment.GEMINI_ASSISTANT_NAME?.trim();
  const voice = environment.GEMINI_VOICE?.trim();
  if (name && (name.length < 2 || name.length > 32))
    throw new Error('GEMINI_ASSISTANT_NAME must contain 2–32 characters.');
  if (voice && !['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir'].includes(voice))
    throw new Error(
      'GEMINI_VOICE must be Aoede, Kore, Puck, Charon, or Fenrir.',
    );
  if (key) overrides.vlmApiKey = key;
  if (taskModel) overrides.vlmModelName = taskModel;
  if (liveModel) overrides.liveModelName = liveModel;
  if (name) overrides.assistantName = name;
  if (voice) overrides.voiceName = voice as VoiceName;
  const provider = environment.MODEL?.trim().toUpperCase();
  if (provider && !['GOOGLE', 'GROQ', 'BOTH'].includes(provider))
    throw new Error('MODEL must be GOOGLE, GROQ, or BOTH.');
  if (provider)
    overrides.providerMode = provider as GeminiDefaults['providerMode'];
  if (environment.GROQ_API_KEY?.trim())
    overrides.groqApiKey = environment.GROQ_API_KEY.trim();
  if (environment.GROQ_MODEL?.trim()) {
    if (!/^[a-zA-Z0-9._/-]{1,120}$/.test(environment.GROQ_MODEL.trim()))
      throw new Error('GROQ_MODEL is invalid.');
    overrides.groqModel = environment.GROQ_MODEL.trim();
  }
  const input = model('GOOGLE_STT_MODEL'),
    output = model('GOOGLE_TTS_MODEL');
  if (input) overrides.speechInputModel = input;
  if (output) overrides.speechOutputModel = output;
  return { defaults: { ...defaults, ...overrides }, overrides };
}

export function loadGeminiEnvironment({
  cwd = process.cwd(),
  appDirectory = resolve(__dirname, '../..'),
  environment = process.env,
}: {
  cwd?: string;
  appDirectory?: string;
  environment?: NodeJS.ProcessEnv;
} = {}) {
  // The dev task runs from apps/ui-tars; setup also supports a repository-root .env.
  const paths = [
    ...new Set([
      resolve(cwd, '.env'),
      resolve(appDirectory, '.env'),
      resolve(appDirectory, '../../.env'),
    ]),
  ];
  dotenv.config({
    path: paths,
    processEnv: environment as Record<string, string>,
    override: false,
  });
  return resolveGeminiEnvironment(environment);
}
