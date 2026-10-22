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
};

export function resolveGeminiEnvironment(environment: NodeJS.ProcessEnv) {
  const defaults: GeminiDefaults = {
    vlmApiKey: '',
    vlmModelName: GEMINI_DEFAULT_MODEL,
    liveModelName: DEFAULT_LIVE_MODEL,
    assistantName: DEFAULT_ASSISTANT_NAME,
    voiceName: 'Aoede',
  };
  const overrides: Partial<GeminiDefaults> = {};
  const model = (key: string) => {
    const value = environment[key]?.trim();
    if (value && !/^gemini-[a-zA-Z0-9._-]+$/.test(value))
      throw new Error(`${key} must contain a Gemini model ID.`);
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
