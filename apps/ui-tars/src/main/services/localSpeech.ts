import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { windowsSpeechScript } from './windowsSpeechScript';
import { WakeGate } from '../shared/voice';
import { localIntent } from '../shared/assistant';

export class LocalSpeech {
  private child?: ChildProcessWithoutNullStreams;
  private ready = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private emit: (
      state: 'off' | 'starting' | 'listening' | 'error',
      text?: string,
    ) => void,
    private heard: (text: string) => void,
  ) {}
  get enabled() {
    return !!this.child;
  }
  start(name: string) {
    if (this.child) return;
    if (process.platform !== 'win32')
      throw new Error(
        'Offline voice currently requires Windows with an installed speech language pack. All sidebar controls also work by typing.',
      );
    if (name.trim().length < 2 || name.length > 32)
      throw new Error('Assistant name must contain 2–32 characters.');
    const gate = new WakeGate(name);
    this.ready = false;
    this.emit('starting');
    const executable =
      (process.env.SystemRoot || 'C:\\Windows') +
      '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const child = spawn(
      executable,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(windowsSpeechScript, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GEMINI_WAKE_NAME: name },
      },
    );
    this.child = child;
    let buffer = '',
      ready = false,
      failed = false;
    const fail = (text: string) => {
      if (this.child !== child) return;
      failed = true;
      this.stop();
      this.emit('error', text);
    };
    this.timer = setTimeout(
      () =>
        fail(
          'Offline voice took too long to start. Check your Windows speech language pack.',
        ),
      20000,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 65536) {
        fail('Local speech returned invalid output.');
        return;
      }
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith('{')) continue;
        try {
          const value = JSON.parse(line);
          if (value.type === 'ready') {
            ready = true;
            this.ready = true;
            clearTimeout(this.timer);
            this.emit('listening', value.text);
          }
          if (value.type === 'error') {
            fail(value.text);
            return;
          }
          if (value.type === 'transcript' && typeof value.text === 'string') {
            // Exact local controls do not require a wake name; model tasks do.
            if (localIntent(value.text, name)) this.heard(value.text);
            else {
              const command = gate.consume(value.text);
              if (command.kind === 'wake') this.speak('I am listening.');
              if (command.kind === 'task' || command.kind === 'stop')
                this.heard(command.text);
            }
          }
        } catch {
          /* Ignore non-protocol startup output. */
        }
      }
    });
    child.stderr.on('data', () => {
      /* Never expose process/environment details. */
    });
    child.on('error', () => fail('Could not start offline Windows speech.'));
    child.on('exit', () => {
      if (this.child === child) {
        this.child = undefined;
        clearTimeout(this.timer);
        this.emit(
          failed || !ready ? 'error' : 'off',
          ready ? 'Voice stopped.' : 'Offline speech could not initialize.',
        );
      }
    });
    child.stdin.on('error', () => {});
  }
  speak(text: string) {
    this.write({ type: 'speak', text: text.slice(0, 1200) });
  }
  interrupt() {
    if (!this.ready) {
      this.stop();
      return;
    }
    this.write({ type: 'stop' });
  }
  private write(value: object) {
    if (this.child?.stdin.writable)
      this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  stop() {
    this.ready = false;
    clearTimeout(this.timer);
    const child = this.child;
    this.child = undefined;
    if (child) {
      child.stdin.end(JSON.stringify({ type: 'close' }) + '\n');
      child.kill();
    }
    this.emit('off');
  }
}
