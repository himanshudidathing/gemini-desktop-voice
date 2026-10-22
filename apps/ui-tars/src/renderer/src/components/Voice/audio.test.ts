import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { audioMimeType, decodePCM16 } from './audio';

describe('PCM audio pipeline', () => {
  it('decodes signed 16-bit little-endian Google audio', () => {
    const bytes = Buffer.from([0, 128, 0, 0, 255, 127]);
    const decoded = decodePCM16(bytes.toString('base64'));
    expect(Array.from(decoded)).toEqual([-1, 0, 32767 / 32768]);
    expect(() => decodePCM16('AQ==')).toThrow();
  });
  it('encodes microphone frames into bounded 100ms PCM chunks', () => {
    const sent: ArrayBuffer[] = [];
    let Processor: any;
    runInNewContext(
      readFileSync(
        new URL('./pcm-capture.worklet.js', import.meta.url),
        'utf8',
      ),
      {
        AudioWorkletProcessor: class {
          port = { postMessage: (data: ArrayBuffer) => sent.push(data) };
        },
        registerProcessor: (_name: string, value: unknown) => {
          Processor = value;
        },
        ArrayBuffer,
        DataView,
        Math,
      },
    );
    const processor = new Processor();
    expect(processor.process([])).toBe(true);
    expect(sent).toHaveLength(0);
    const frame = new Float32Array(1600);
    frame.set([-2, -1, 0, 0.5, 1, 2]);
    processor.process([[frame]]);
    expect(sent[0].byteLength).toBe(3200);
    const view = new DataView(sent[0]);
    expect(
      [0, 2, 4, 6, 8, 10].map((offset) => view.getInt16(offset, true)),
    ).toEqual([-32768, -32768, 0, 16384, 32767, 32767]);
  });
  it('recognizes file MIME types even when the browser omits them', () => {
    expect(audioMimeType({ name: 'task.M4A', type: '' })).toBe('audio/mp4');
    expect(audioMimeType({ name: 'task.wav', type: '' })).toBe('audio/wav');
    expect(
      audioMimeType({ name: 'task.webm', type: 'audio/webm;codecs=opus' }),
    ).toBe('audio/webm');
  });
});
