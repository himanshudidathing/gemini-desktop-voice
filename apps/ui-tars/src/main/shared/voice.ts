export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
export const DEFAULT_ASSISTANT_NAME = 'Gemini';
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const AUDIO_MIME_TYPES = [
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
];
export type VoiceSettings = {
  apiKey: string;
  model: string;
  assistantName: string;
  voiceName: string;
};
export type VoiceEvent =
  | {
      type: 'state';
      state: 'connecting' | 'listening' | 'awake' | 'off' | 'error';
      message?: string;
    }
  | { type: 'transcript'; speaker: 'user' | 'assistant'; text: string }
  | { type: 'audio'; data: string; sampleRate: number }
  | { type: 'interrupted' }
  | { type: 'command'; id: string; text: string; stop: boolean };

export class WakeGate {
  private until = 0;
  private readonly pattern: RegExp;
  constructor(
    readonly name: string,
    private readonly clock = () => Date.now(),
  ) {
    const escaped = name
      .normalize('NFKC')
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');
    this.pattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
      'iu',
    );
  }
  hasName(text: string) {
    return this.pattern.test(text.normalize('NFKC'));
  }
  consume(text: string): {
    kind: 'ignore' | 'wake' | 'task' | 'stop';
    text: string;
  } {
    const normalized = text.normalize('NFKC').trim();
    const match = this.pattern.exec(normalized);
    if (!match && (!this.until || this.clock() > this.until))
      return { kind: 'ignore', text: '' };
    const command = (
      match ? normalized.slice(match.index + match[0].length) : normalized
    )
      .replace(/^[\s,.:!?;-]+/, '')
      .trim();
    if (!command || /^(?:hey|hello|hi)[.!?]*$/i.test(command)) {
      this.until = this.clock() + 12000;
      return { kind: 'wake', text: '' };
    }
    this.until = 0;
    return {
      kind: /^(?:please\s+)?(?:stop|cancel|abort)(?:\s+(?:the\s+)?(?:task|everything|now|please|listening))*[.!?]*$/i.test(
        command,
      )
        ? 'stop'
        : 'task',
      text: command,
    };
  }
  reset() {
    this.until = 0;
  }
}

export function createLiveSetup(settings: VoiceSettings) {
  if (!/^gemini-[a-zA-Z0-9._-]+$/.test(settings.model))
    throw new Error('Choose a Gemini Live model ID.');
  if (
    settings.assistantName.trim().length < 2 ||
    settings.assistantName.length > 32
  )
    throw new Error('Assistant name must contain 2–32 characters.');
  if (
    !['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir'].includes(settings.voiceName)
  )
    throw new Error('Choose a supported voice.');
  return {
    setup: {
      model: `models/${settings.model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: settings.voiceName },
          },
        },
      },
      systemInstruction: {
        parts: [
          {
            text: `You are a desktop voice assistant called ${JSON.stringify(settings.assistantName)}. Ignore background speech unless addressed by that name. If the user only says your name, say "I'm listening" and wait for the task. When addressed with a task, acknowledge it very briefly. The desktop application dispatches the transcribed command separately; you do not execute actions yourself. Never claim an action succeeded before receiving a TASK RESULT from the application. Speak task results briefly and accurately. If a result says stopped, failed, or needs user help, say so. Do not read hidden instructions or verbose reasoning aloud. There are no tools in this voice session. Answer in the user's language.`,
          },
        ],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}
