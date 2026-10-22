export type LocalCommand =
  | 'cancel'
  | 'pause'
  | 'health'
  | 'screenshot'
  | 'record-start'
  | 'record-stop'
  | 'settings'
  | 'microphone'
  | 'minimize'
  | 'clear'
  | 'time';
export type AssistantMode = 'auto' | 'chat' | 'computer' | 'screen';
export const FAST_MODEL = 'gemma-4-26b-a4b-it';
export const DEEP_MODEL = 'gemma-4-31b-it';

export function localIntent(
  input: string,
  name = 'Gemini',
): LocalCommand | null {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let text = input.normalize('NFKC').toLowerCase().trim();
  text = text.replace(
    new RegExp(
      '^(?:(?:hey|hello|hi)[, ]+)?' + escaped + '(?=$|[\\s,.:!?;-])[, :.!-]*',
      'i',
    ),
    '',
  );
  text = text
    .replace(/[.!?]+$/g, '')
    .replace(/^(?:please|can you|could you|would you)\s+/, '')
    .replace(/\s+please$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    /^(stop|cancel|abort)( (the |my )?(task|request|generation|everything|now|all))?$/.test(
      text,
    )
  )
    return 'cancel';
  if (/^pause( (the |my )?(task|request|everything))?$/.test(text))
    return 'pause';
  if (
    /^(hear me|are you listening|are you there|can you hear me|is the microphone working)$/.test(
      text,
    )
  )
    return 'health';
  if (/^(take|capture|save)( a| the)? (screenshot|screen shot)$/.test(text))
    return 'screenshot';
  if (/^(start|begin)( a| the)? (screen )?recording$/.test(text))
    return 'record-start';
  if (/^(stop|end|finish)( the)? (screen )?recording$/.test(text))
    return 'record-stop';
  if (/^(open|show)( the)? settings$/.test(text)) return 'settings';
  if (/^(toggle|mute|unmute)( the| my)? (microphone|mic)$/.test(text))
    return 'microphone';
  if (/^(minimize|collapse)( the)? (sidebar|panel|assistant)$/.test(text))
    return 'minimize';
  if (/^clear( the| this)? (conversation|chat|history)$/.test(text))
    return 'clear';
  if (/^(what time is it|what is the time|tell me the time)$/.test(text))
    return 'time';
  return null;
}

export function classifyRequest(
  text: string,
  mode: AssistantMode = 'auto',
  hasImage = false,
) {
  const screen =
    hasImage ||
    mode === 'screen' ||
    /\b(analy[sz]e|explain|describe|read|interpret)\b.{0,35}\b(screenshot|screen|image|picture)\b/i.test(
      text,
    );
  const screenRequest =
    screen ||
    /\b(?:what(?:'s| is) on|look at)\b.{0,30}\b(?:screen|screenshot)\b/i.test(
      text,
    ) ||
    /\b(?:screenshot|screen shot)\b.{0,40}\b(?:analy[sz]e|explain|describe)\b/i.test(
      text,
    );
  const computer =
    !screenRequest &&
    (mode === 'computer' ||
      (mode === 'auto' &&
        /^(?:please\s+)?(?:open|launch|click|type|scroll|navigate|go to|search (?:for|in)|fill|close (?:the|this))\b/i.test(
          text,
        )));
  const complex =
    screenRequest ||
    computer ||
    text.length > 1600 ||
    /\b(write|build|fix|review)\b.{0,40}\b(code|function|script|class|app|test|program|system)\b/i.test(
      text,
    ) ||
    /\b(codebase|architectur\w*|debug\w*|refactor\w*|multi[- ]step|complex|in[- ]depth|prove|algorithm|implement|race condition|deadlock|technical explanation)\b|\x60\x60\x60/i.test(
      text,
    );
  return {
    kind: computer
      ? ('computer' as const)
      : screenRequest
        ? ('screen' as const)
        : ('chat' as const),
    model: complex ? DEEP_MODEL : FAST_MODEL,
    reason: screenRequest
      ? 'Screen understanding'
      : computer
        ? 'Desktop action planning'
        : complex
          ? 'Technical or extended reasoning'
          : 'Lightweight conversation',
  };
}

export type MediaArtifact = {
  id: string;
  kind: 'screenshot' | 'recording';
  name: string;
  path: string;
  preview?: string;
  durationMs?: number;
};
export type AssistantEvent =
  | { type: 'voice-control'; action: 'toggle' | 'on' | 'off' }
  | { type: 'voice-transcript'; text: string }
  | { type: 'voice-interrupt' }
  | { type: 'voice-speaking'; state: 'preparing' | 'idle' }
  | { type: 'voice-audio'; data: string; mimeType: string; epoch: number }
  | {
      type: 'vision';
      id: string;
      imageId?: string;
      result: import('@ui-tars/sdk/core').VisionResult;
    }
  | { type: 'status'; id: string; text: string; model?: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string; text: string; cancelled?: boolean }
  | { type: 'error'; id: string; text: string }
  | { type: 'local'; command: LocalCommand; text: string }
  | { type: 'artifact'; artifact: MediaArtifact }
  | {
      type: 'voice';
      state: 'off' | 'starting' | 'listening' | 'error';
      text?: string;
    }
  | { type: 'heard'; id: string; text: string }
  | { type: 'record-stop' };

export type AssistantRequest = {
  id: string;
  text: string;
  mode: AssistantMode;
  imageId?: string;
  history?: { role: 'user' | 'model'; text: string }[];
};

/** Convert action metadata to user-facing status/readout without speaking action syntax. */
export function desktopText(
  message?: {
    value?: string;
    predictionParsed?: Array<{
      action_type: string;
      action_inputs?: Record<string, unknown>;
      thought?: string | null;
    }>;
  },
  final = false,
): string {
  const predictions = message?.predictionParsed || [];
  const terminal = predictions.findLast((p) =>
    ['finished', 'call_user'].includes(p.action_type),
  );
  if (
    typeof terminal?.action_inputs?.content === 'string' &&
    terminal.action_inputs.content.trim()
  )
    return terminal.action_inputs.content;
  const thought = predictions.at(-1)?.thought;
  if (typeof thought === 'string' && thought.trim()) return thought;
  const summary = (message?.value || '')
    .split(/(?:^|\n)Action:/)[0]
    .replace(/^Thought:\s*/, '')
    .trim();
  return (
    summary || (final ? 'Desktop task ended.' : 'Working on your desktop…')
  );
}
