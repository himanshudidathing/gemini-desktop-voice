import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Camera,
  Check,
  Circle,
  Expand,
  FolderOpen,
  Image,
  MessageSquare,
  Mic,
  MicOff,
  Minus,
  Paperclip,
  Settings2,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  localIntent,
  type AssistantMode,
  type MediaArtifact,
} from '@main/shared/assistant';
import { Operator, type LocalStore } from '@main/store/types';
import { useRecording } from './useRecording';
import { useGoogleVoice } from './useGoogleVoice';
import type { VisionResult } from '@ui-tars/sdk/core';
import './assistant.css';
type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  model?: string;
  state?: 'streaming' | 'done' | 'stopped' | 'error';
};
const historyKey = 'gemini-assistant-history-v2';
const shortModel = (m?: string) =>
  m?.includes('qwen')
    ? 'Qwen 3.8 · Groq'
    : m?.includes('26b')
      ? 'Gemma 26B'
      : m?.includes('31b')
        ? 'Gemma 31B'
        : m || 'Assistant';
function readHistory(): Message[] {
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey) || '[]');
    return Array.isArray(saved)
      ? saved
          .filter(
            (m) =>
              m &&
              ['user', 'assistant'].includes(m.role) &&
              typeof m.text === 'string',
          )
          .slice(-60)
          .map((m) => ({
            ...m,
            text: m.text.slice(0, 16000),
            state: m.state === 'streaming' ? 'stopped' : m.state,
          }))
      : [];
  } catch {
    return [];
  }
}
export default function AssistantPanel() {
  const api = window.electron.assistant;
  const [messages, setMessages] = useState<Message[]>(readHistory),
    messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [tab, setTab] = useState<'chat' | 'captures' | 'settings'>('chat');
  const [draft, setDraft] = useState(''),
    [mode, setMode] = useState<AssistantMode>('auto'),
    [imageId, setImageId] = useState<string>();
  const [busy, setBusy] = useState<string>(),
    active = useRef<string | undefined>(undefined);
  const [status, setStatus] = useState('Ready when you are'),
    [model, setModel] = useState<string>();
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const speech = useGoogleVoice(setError);
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const voice = speech.state;
  const [heard, setHeard] = useState('');
  const [visions, setVisions] = useState<Record<string, VisionResult>>({});
  const [artifacts, setArtifacts] = useState<MediaArtifact[]>([]);
  const [settings, setSettings] = useState<LocalStore>(),
    settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [saved, setSaved] = useState(false),
    [uploading, setUploading] = useState(false),
    uploadEpoch = useRef(0);
  const recording = useRecording(setError),
    recordingRef = useRef(recording);
  recordingRef.current = recording;
  const bottom = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const chunks = useRef(new Map<string, string>()),
    flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    const batch = new Map(chunks.current);
    chunks.current.clear();
    if (batch.size)
      setMessages((all) =>
        all.map((m) =>
          batch.has(m.id) ? { ...m, text: m.text + batch.get(m.id) } : m,
        ),
      );
  }, []);
  const safe = (p: Promise<unknown>) => {
    void p.catch((e) => setError(e.message || String(e)));
  };
  const beginMessage = useCallback((id: string, text: string) => {
    active.current = id;
    setBusy(id);
    setModel(undefined);
    setError('');
    setStatus('Choosing a model…');
    stick.current = true;
    setMessages((all) =>
      [
        ...all,
        { id: id + '-user', role: 'user', text } as Message,
        { id, role: 'assistant', text: '', state: 'streaming' } as Message,
      ].slice(-60),
    );
  }, []);
  const cancel = useCallback(() => {
    speechRef.current.interrupt();
    uploadEpoch.current++;
    setUploading(false);
    flush();
    recordingRef.current.stop();
    const id = active.current;
    active.current = undefined;
    setBusy(undefined);
    setStatus('Stopped');
    setNotice('All active work stopped.');
    if (id)
      setMessages((all) =>
        all.map((m) =>
          m.id === id
            ? { ...m, state: 'stopped', text: m.text || 'Stopped.' }
            : m,
        ),
      );
    void api.cancel().catch((e) => setError(e.message));
  }, [api, flush]);
  useEffect(() => {
    void window.electron.setting
      .getSetting()
      .then(setSettings)
      .catch((e) => setError(e.message));
    const off = api.onEvent((event) => {
      if (event.type === 'heard') {
        setHeard(event.text);
        if (
          !localIntent(
            event.text,
            settingsRef.current?.assistantName || 'Gemini',
          ) &&
          !active.current
        )
          beginMessage(event.id, event.text);
      }
      if (event.type === 'vision' && event.imageId)
        setVisions((all) =>
          Object.fromEntries([
            ...Object.entries(all)
              .filter(([id]) => id !== event.imageId)
              .slice(-23),
            [event.imageId!, event.result],
          ]),
        );
      if (event.type === 'record-stop') recordingRef.current.stop();
      if (event.type === 'artifact') {
        setArtifacts((all) =>
          [
            event.artifact,
            ...all.filter((a) => a.id !== event.artifact.id),
          ].slice(0, 24),
        );
        setNotice(
          event.artifact.kind === 'screenshot'
            ? 'Screenshot saved locally. Choose Analyze to send it to a model.'
            : 'Recording saved locally.',
        );
      }
      if (event.type === 'local') {
        setNotice(event.text);
        if (event.command === 'settings') setTab('settings');
        if (event.command === 'record-start') void recordingRef.current.start();
        if (event.command === 'record-stop') recordingRef.current.stop();
        if (['cancel', 'pause', 'clear'].includes(event.command)) {
          uploadEpoch.current++;
          setUploading(false);
          active.current = undefined;
          setBusy(undefined);
          setStatus(event.text);
        }
        if (event.command === 'clear') {
          chunks.current.clear();
          setMessages([]);
          localStorage.removeItem(historyKey);
        }
      }
      if (event.type === 'status') {
        if (!event.id) setNotice(event.text);
        if (!event.id || active.current === event.id) {
          setStatus(event.text);
          if (event.model) setModel(event.model);
        }
        if (event.id)
          setMessages((all) =>
            all.map((m) =>
              m.id === event.id ? { ...m, model: event.model || m.model } : m,
            ),
          );
      }
      if (event.type === 'delta' && active.current === event.id) {
        chunks.current.set(
          event.id,
          (chunks.current.get(event.id) || '') + event.text,
        );
        if (!flushTimer.current) flushTimer.current = setTimeout(flush, 60);
      }
      if (event.type === 'done') {
        flush();
        setMessages((all) =>
          all.map((m) =>
            m.id === event.id
              ? {
                  ...m,
                  text: event.cancelled ? m.text || event.text : event.text,
                  state: event.cancelled ? 'stopped' : 'done',
                }
              : m,
          ),
        );
        if (active.current === event.id) {
          active.current = undefined;
          setBusy(undefined);
          setStatus(event.cancelled ? 'Stopped' : 'Ready when you are');
        }
      }
      if (event.type === 'error') {
        flush();
        setError(event.text);
        setMessages((all) =>
          all.map((m) =>
            m.id === event.id
              ? { ...m, state: 'error', text: m.text || event.text }
              : m,
          ),
        );
        if (active.current === event.id) {
          active.current = undefined;
          setBusy(undefined);
          setStatus('Ready to try again');
        }
      }
    });
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setTab('settings');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      off();
      clearTimeout(flushTimer.current);
      window.removeEventListener('keydown', keydown);
      void api.cancel();
    };
  }, [api, beginMessage, cancel, flush]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(historyKey, JSON.stringify(messages.slice(-60)));
      } catch {
        setNotice(
          'History storage is full. Clear the conversation to free space.',
        );
      }
    }, 500);
    if (stick.current) bottom.current?.scrollIntoView({ behavior: 'instant' });
    return () => clearTimeout(timer);
  }, [messages]);
  const submit = async (
    text = draft,
    selectedMode = mode,
    selectedImage = imageId,
  ) => {
    if (!text.trim()) return;
    const id = crypto.randomUUID(),
      local = localIntent(text, settings?.assistantName || 'Gemini');
    if (!local && active.current) {
      setNotice('Stop the current request before sending another.');
      return;
    }
    if (!local) {
      beginMessage(id, text);
      setDraft('');
      setImageId(undefined);
      setTab('chat');
    } else {
      setError('');
      setDraft('');
    }
    try {
      const history = messagesRef.current
        .filter(
          (m) =>
            m.text &&
            !['error', 'stopped', 'streaming'].includes(m.state || ''),
        )
        .slice(-6)
        .map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('model' as const),
          text: m.text,
        }));
      await api.submit({
        id,
        text,
        mode: selectedMode,
        imageId: selectedImage,
        history,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request.');
      if (active.current === id) {
        active.current = undefined;
        setBusy(undefined);
      }
      setMessages((all) =>
        all.map((m) =>
          m.id === id
            ? { ...m, state: 'error', text: 'Request could not start.' }
            : m,
        ),
      );
    }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    const epoch = ++uploadEpoch.current;
    setUploading(true);
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error('Choose an audio file smaller than 10 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (epoch !== uploadEpoch.current) return;
      const text = await api.transcribe(bytes, file.type || 'audio/wav');
      if (epoch === uploadEpoch.current) {
        setDraft(text);
        setNotice('Audio transcribed. Review before sending.');
        input.current?.focus();
      }
    } catch (e) {
      if (epoch === uploadEpoch.current)
        setError(e instanceof Error ? e.message : 'Audio upload failed.');
    } finally {
      if (epoch === uploadEpoch.current) setUploading(false);
    }
  };
  const saveSettings = async () => {
    if (!settings) return;
    if (
      !settings.assistantName?.trim() ||
      settings.assistantName.trim().length < 2 ||
      settings.assistantName.length > 32
    ) {
      setError('Use an assistant name of 2–32 characters.');
      return;
    }
    try {
      await window.electron.setting.updateSetting({
        vlmApiKey: settings.vlmApiKey.trim(),
        assistantName: settings.assistantName.trim(),
        operator: settings.operator,
        providerMode: settings.providerMode || 'GOOGLE',
        groqApiKey: settings.groqApiKey?.trim() || '',
        groqModel: settings.groqModel?.trim() || 'qwen/qwen3.8-27b',
        speechInputModel:
          settings.speechInputModel?.trim() || 'gemini-3.5-transcribe-live',
        speechOutputModel:
          settings.speechOutputModel?.trim() || 'gemini-3.8-flash-lite-tts',
        voiceName: settings.voiceName || 'Aoede',
      });
      setSaved(true);
      setNotice('Settings saved. No test request was sent.');
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save settings.');
    }
  };
  return (
    <main className="assistant-shell">
      <header className="panel-titlebar">
        <div className="brand">
          <span className="brand-mark">
            <span className="brand-glyph">
              <i />
              <i />
              <i />
            </span>
          </span>
          <span>
            Assistant <span className="brand-light">Desktop</span>
          </span>
        </div>
        <div className="window-actions">
          <button
            aria-label="Stop all work"
            title="Stop all work (Esc)"
            onClick={cancel}
          >
            <Square size={12} />
          </button>
          <button
            aria-label="Minimize sidebar"
            title="Minimize sidebar"
            onClick={() => safe(api.window('minimize'))}
          >
            <Minus size={15} />
          </button>
          <button
            aria-label="Expand sidebar"
            title="Expand or restore width"
            onClick={() => safe(api.window('expand'))}
          >
            <Expand size={14} />
          </button>
          <button
            aria-label="Close sidebar"
            title="Close and stop active work"
            onClick={() => {
              cancel();
              safe(api.window('close'));
            }}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <nav className="panel-tabs" aria-label="Assistant views">
        <button
          className={tab === 'chat' ? 'selected' : ''}
          onClick={() => setTab('chat')}
        >
          <MessageSquare size={14} /> Chat
        </button>
        <button
          className={tab === 'captures' ? 'selected' : ''}
          onClick={() => setTab('captures')}
        >
          <Image size={14} /> Captures{' '}
          {artifacts.length > 0 && (
            <span className="count">{artifacts.length}</span>
          )}
        </button>
        <button
          className={'settings-tab ' + (tab === 'settings' ? 'selected' : '')}
          aria-label="Open settings"
          onClick={() => setTab('settings')}
        >
          <Settings2 size={16} />
        </button>
      </nav>
      <div className="connection-bar">
        <span className={'status-dot ' + (busy ? 'working' : '')} />
        <span>
          {busy
            ? shortModel(model)
            : tab === 'settings'
              ? 'Preferences'
              : tab === 'captures'
                ? 'Local library'
                : messages.length
                  ? 'Conversation'
                  : 'New conversation'}
        </span>
        <span className="local-badge">
          <span className="provider-dot" />{' '}
          {settings?.providerMode === 'BOTH'
            ? 'Groq + Google'
            : settings?.providerMode === 'GROQ'
              ? 'Groq'
              : 'Google'}
        </span>
      </div>
      {tab === 'settings' ? (
        <section className="panel-scroll settings-page">
          <div className="section-eyebrow">WORKSPACE</div>
          <h1>Settings</h1>
          <p className="muted">Your models, your voice, your preferences.</p>
          <h2 className="settings-heading">Models & providers</h2>
          <label className="field-label">
            Provider
            <select
              aria-label="Provider mode"
              value={settings?.providerMode || 'GOOGLE'}
              onChange={(e) =>
                settings &&
                setSettings({
                  ...settings,
                  providerMode: e.target.value as LocalStore['providerMode'],
                })
              }
            >
              <option value="GOOGLE">Google</option>
              <option value="GROQ">Groq</option>
              <option value="BOTH">Groq + Google fallback</option>
            </select>
          </label>
          <p className="field-help">
            Hybrid uses Groq first and switches to Google when needed. Voice
            always uses Google.
          </p>
          {settings?.providerMode !== 'GOOGLE' && (
            <>
              <label className="field-label">
                Groq API key
                <input
                  aria-label="Groq API key"
                  type="password"
                  autoComplete="off"
                  value={settings?.groqApiKey || ''}
                  placeholder="gsk_…"
                  onChange={(e) =>
                    settings &&
                    setSettings({ ...settings, groqApiKey: e.target.value })
                  }
                />
              </label>
              <label className="field-label">
                Groq model
                <input
                  aria-label="Groq model"
                  value={settings?.groqModel || 'qwen/qwen3.8-27b'}
                  onChange={(e) =>
                    settings &&
                    setSettings({ ...settings, groqModel: e.target.value })
                  }
                />
              </label>
            </>
          )}
          <label className="field-label">
            Google API key
            <input
              aria-label="Google API key"
              type="password"
              autoComplete="off"
              placeholder="Paste your API key"
              value={settings?.vlmApiKey || ''}
              onChange={(e) =>
                settings &&
                setSettings({ ...settings, vlmApiKey: e.target.value })
              }
            />
          </label>
          <p className="field-help">
            Used for Google models and voice in every provider mode. Keys stay
            on this computer.
          </p>
          <h2 className="settings-heading">Voice</h2>
          <label className="field-label">
            Speaking voice
            <select
              aria-label="Speaking voice"
              value={settings?.voiceName || 'Aoede'}
              onChange={(e) =>
                settings &&
                setSettings({
                  ...settings,
                  voiceName: e.target.value as LocalStore['voiceName'],
                })
              }
            >
              {['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir'].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Assistant name
            <input
              aria-label="Assistant name"
              maxLength={32}
              value={settings?.assistantName || ''}
              onChange={(e) =>
                settings &&
                setSettings({ ...settings, assistantName: e.target.value })
              }
            />
          </label>
          <label className="field-label">
            Desktop tools
            <select
              aria-label="Desktop tools"
              value={settings?.operator || Operator.LocalComputer}
              onChange={(e) =>
                settings &&
                setSettings({
                  ...settings,
                  operator: e.target.value as Operator,
                })
              }
            >
              <option value={Operator.LocalComputer}>Computer</option>
              <option value={Operator.LocalBrowser}>Chrome browser</option>
            </select>
          </label>
          <button
            className="primary-button"
            onClick={() => void saveSettings()}
            disabled={!settings}
          >
            {saved ? <Check size={15} /> : <Settings2 size={15} />}{' '}
            {saved ? 'Saved' : 'Save settings'}
          </button>
          <div className="settings-note">
            <AudioLines size={16} />
            <p>
              Google transcribes your microphone and reads model responses
              aloud. Say your assistant's name to start; interrupt naturally or
              say “Stop”.
            </p>
          </div>
          <details className="advanced-settings">
            <summary>Advanced voice settings</summary>
            <label className="field-label">
              Google transcription model
              <input
                aria-label="Google transcription model"
                value={
                  settings?.speechInputModel || 'gemini-3.5-transcribe-live'
                }
                onChange={(e) =>
                  settings &&
                  setSettings({ ...settings, speechInputModel: e.target.value })
                }
              />
            </label>
            <label className="field-label">
              Google speech model
              <input
                aria-label="Google speech model"
                value={
                  settings?.speechOutputModel || 'gemini-3.8-flash-lite-tts'
                }
                onChange={(e) =>
                  settings &&
                  setSettings({
                    ...settings,
                    speechOutputModel: e.target.value,
                  })
                }
              />
            </label>
            <p className="field-help">
              Save and reconnect voice after changing these settings. Nonempty
              .env values take precedence at startup.
            </p>
          </details>
          <button
            className="text-button danger-text"
            onClick={() => void submit('clear conversation')}
          >
            <Trash2 size={14} /> Clear conversation history
          </button>
        </section>
      ) : tab === 'captures' ? (
        <section className="panel-scroll captures-page">
          <div className="section-eyebrow">WORKSPACE</div>
          <h1>Captures</h1>
          <p className="muted">
            Screenshots and recordings stay local until you choose to analyze a
            screenshot.
          </p>
          <div className="tool-grid">
            <button onClick={() => void submit('take screenshot')}>
              <Camera size={18} /> Screenshot
            </button>
            <button
              onClick={() =>
                recording.state === 'off'
                  ? void recording.start()
                  : recording.stop()
              }
            >
              <Circle size={17} />
              {recording.state === 'off' ? 'Record screen' : 'Stop recording'}
            </button>
          </div>
          {!artifacts.length && (
            <div className="empty-captures">
              <Image size={30} />
              <p>Your captures will appear here.</p>
              <small>Saved to Pictures or Videos / Gemini Desktop</small>
            </div>
          )}
          {artifacts.map((a) => (
            <article className="capture-card" key={a.id}>
              {a.preview && (
                <div className="vision-preview">
                  <img src={a.preview} alt="Captured screen preview" />
                  {visions[a.id] && (
                    <svg
                      viewBox="0 0 1000 1000"
                      preserveAspectRatio="none"
                      aria-label="Detected UI element bounding boxes"
                    >
                      {visions[a.id].elements.map((e) => (
                        <g key={e.id}>
                          <title>
                            {e.label} · {Math.round(e.confidence * 100)}%
                          </title>
                          <rect
                            x={e.box[0]}
                            y={e.box[1]}
                            width={e.box[2] - e.box[0]}
                            height={e.box[3] - e.box[1]}
                          />
                        </g>
                      ))}
                    </svg>
                  )}
                </div>
              )}
              <div className="capture-meta">
                <strong>
                  {a.kind === 'screenshot' ? 'Screenshot' : 'Screen recording'}
                </strong>
                <small>
                  {a.durationMs
                    ? Math.round(a.durationMs / 1000) + ' seconds · WebM'
                    : 'PNG · saved locally'}
                </small>
              </div>
              {visions[a.id] && (
                <details className="detected-controls">
                  <summary>
                    {visions[a.id].elements.length} detected controls
                  </summary>
                  {visions[a.id].elements.map((e) => (
                    <div key={e.id}>
                      <span>{e.label}</span>
                      <small>{Math.round(e.confidence * 100)}%</small>
                    </div>
                  ))}
                </details>
              )}
              <div className="capture-actions">
                <button onClick={() => safe(api.reveal(a.id))}>
                  <FolderOpen size={13} /> Show file
                </button>
                {a.kind === 'screenshot' && (
                  <button
                    onClick={() => {
                      setImageId(a.id);
                      setMode('screen');
                      setDraft('Analyze this screenshot');
                      setTab('chat');
                    }}
                  >
                    Analyze <ArrowUpRight size={13} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div
          className="panel-scroll conversation"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (el)
              stick.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          {!messages.length && (
            <section className="welcome">
              <div className="welcome-kicker">LET'S GET STARTED</div>
              <h1>
                What are we
                <br />
                working on?
              </h1>
              <p>
                Ask a question, talk through an idea,
                <br />
                or bring your screen into the conversation.
              </p>
              {settings &&
                !(settings.providerMode === 'GROQ'
                  ? settings.groqApiKey
                  : settings.vlmApiKey || settings.groqApiKey) && (
                  <button
                    className="connect-card"
                    onClick={() => setTab('settings')}
                  >
                    <span className="connect-icon">
                      <Settings2 size={18} />
                    </span>
                    <span>
                      <strong>Connect your assistant</strong>
                      <small>Add your API keys to get started</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                )}
              <div className="welcome-tools">
                <button onClick={() => void submit('take screenshot')}>
                  <span className="tool-icon">
                    <Camera size={18} />
                  </span>
                  <span>
                    <strong>Take a screenshot</strong>
                    <small>Save a copy to your computer</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
                <button
                  onClick={() => {
                    setMode('screen');
                    setDraft('Explain what is on my screen');
                    input.current?.focus();
                  }}
                >
                  <span className="tool-icon">
                    <Image size={18} />
                  </span>
                  <span>
                    <strong>Explore my screen</strong>
                    <small>Find answers in what you see</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
                <button
                  onClick={() => {
                    setDraft('Help me think through a problem');
                    input.current?.focus();
                  }}
                >
                  <span className="tool-icon">
                    <MessageSquare size={18} />
                  </span>
                  <span>
                    <strong>Think it through</strong>
                    <small>Start with a question or an idea</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="keyboard-hint">
                <kbd>Esc</kbd> stops active work at any time
              </div>
            </section>
          )}
          {messages.map((m) => (
            <article key={m.id} className={'chat-message ' + m.role}>
              <div className="message-label">
                {m.role === 'assistant' ? (
                  <>
                    <span className="mini-mark">
                      <span className="response-mark" />
                    </span>
                    {shortModel(m.model)}
                  </>
                ) : (
                  'You'
                )}
                {m.state === 'stopped' && (
                  <span className="message-tag">Stopped</span>
                )}
                {m.state === 'error' && (
                  <span className="message-tag error-tag">Interrupted</span>
                )}
              </div>
              <div className="message-body">
                {m.state === 'streaming' ? (
                  m.text ? (
                    <span className="stream-text">{m.text}</span>
                  ) : (
                    <span className="thinking-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                  )
                ) : (
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                )}
              </div>
            </article>
          ))}
          {artifacts[0]?.kind === 'screenshot' && (
            <div className="inline-capture">
              <img src={artifacts[0].preview} alt="Latest screenshot" />
              <div>
                <strong>Screenshot saved</strong>
                <span>Saved on this computer</span>
                <button onClick={() => setTab('captures')}>
                  View capture <ArrowUpRight size={12} />
                </button>
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>
      )}
      {recording.state !== 'off' && (
        <div className="recording-bar" role="status">
          <span className="record-dot" />
          <span>
            {recording.state === 'recording'
              ? 'Recording screen'
              : recording.state === 'starting'
                ? 'Preparing recording…'
                : 'Saving recording…'}
          </span>
          <button
            onClick={recording.stop}
            disabled={recording.state === 'saving'}
          >
            <Square size={11} /> Stop
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <Check size={12} />
          <span>{notice}</span>
          <button aria-label="Dismiss status" onClick={() => setNotice('')}>
            <X size={12} />
          </button>
        </div>
      )}
      <footer className="composer-zone">
        <div
          className={
            'voice-strip ' + (voice === 'listening' ? 'voice-active' : '')
          }
        >
          <button
            className="voice-toggle"
            aria-label={
              voice === 'off' || voice === 'error'
                ? 'Enable microphone'
                : 'Disable microphone'
            }
            onClick={() => safe(speech.toggle())}
          >
            {voice === 'listening' ? (
              <Mic size={16} />
            ) : voice === 'starting' ? (
              <AudioLines size={16} />
            ) : (
              <MicOff size={16} />
            )}
            <span>
              {voice === 'starting'
                ? 'Connecting voice'
                : speech.speaking === 'playing'
                  ? 'Speaking'
                  : speech.speaking === 'preparing'
                    ? 'Preparing voice'
                    : voice === 'listening'
                      ? 'Listening'
                      : 'Talk to your assistant'}
            </span>
          </button>
          {voice === 'listening' ? (
            <div
              className={
                'voice-meter ' + (speech.speaking !== 'idle' ? 'speaking' : '')
              }
              aria-label="Voice activity"
            >
              {[0.35, 0.65, 1, 0.75, 0.4, 0.8, 0.55, 0.95, 0.6].map((h, i) => (
                <i
                  key={i}
                  style={{
                    height: 3 + speech.level * h * 18,
                    animationDelay: i * -0.09 + 's',
                  }}
                />
              ))}
            </div>
          ) : (
            <span className="voice-provider">Google voice</span>
          )}
        </div>
        {(speech.transcript || heard) && voice === 'listening' && (
          <div className="heard">{speech.transcript || heard}</div>
        )}
        {tab === 'chat' && (
          <>
            <div className={'composer ' + (busy ? 'composer-busy' : '')}>
              {imageId && (
                <div className="attached-image">
                  <Image size={13} /> Screenshot attached
                  <button
                    aria-label="Remove screenshot"
                    onClick={() => setImageId(undefined)}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <textarea
                ref={input}
                aria-label="Message assistant"
                placeholder="Message your assistant…"
                value={draft}
                maxLength={16000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              <div className="composer-actions">
                <select
                  aria-label="Request mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as AssistantMode)}
                >
                  <option value="auto">Auto</option>
                  <option value="chat">Conversation</option>
                  <option value="screen">Analyze screen</option>
                  <option value="computer">Desktop task</option>
                </select>
                <div className="composer-buttons">
                  <button
                    aria-label="Take screenshot"
                    title="Take screenshot locally"
                    onClick={() => void submit('take screenshot')}
                  >
                    <Camera size={16} />
                  </button>
                  <button
                    aria-label={
                      recording.state === 'off'
                        ? 'Start screen recording'
                        : 'Stop screen recording'
                    }
                    title="Screen recording"
                    onClick={() =>
                      recording.state === 'off'
                        ? void recording.start()
                        : recording.stop()
                    }
                  >
                    <Circle
                      size={15}
                      className={recording.state === 'recording' ? 'red' : ''}
                    />
                  </button>
                  <button
                    aria-label="Upload audio for transcription"
                    title="Transcribe audio with Gemini"
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip size={15} />
                  </button>
                  {busy || uploading ? (
                    <button
                      className="stop-button"
                      aria-label="Stop all activity"
                      title="Stop (Esc)"
                      onClick={cancel}
                    >
                      <Square size={14} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      aria-label="Send message"
                      disabled={!draft.trim()}
                      onClick={() => void submit()}
                    >
                      <ArrowUp size={17} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {tab === 'chat' && (
          <div className="composer-status" role="status">
            <span>
              {uploading
                ? 'Transcribing audio…'
                : busy
                  ? status
                  : voice === 'listening'
                    ? 'Say “' +
                      (settings?.assistantName || 'Gemini') +
                      '” to start'
                    : 'Enter to send · Shift + Enter for a new line'}
            </span>
            {busy && (
              <button onClick={cancel}>
                Stop <kbd>Esc</kbd>
              </button>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}
