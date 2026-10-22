import { describe, expect, it, vi } from 'vitest';
import { transcribeAudio } from './audioTranscription';
import { MAX_AUDIO_BYTES } from '../shared/voice';
const settings = { vlmApiKey: 'private', vlmModelName: 'gemini-3.8-flash' };
const audio = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' };
function transport(text = 'Open Chrome', finishReason = 'STOP') {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [{ finishReason, content: { parts: [{ text }] } }],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
}

describe('audio file transcription', () => {
  it('sends audio only to Google and returns editable text, not a running command', async () => {
    const fetcher = transport();
    expect(await transcribeAudio(audio, settings, fetcher)).toBe('Open Chrome');
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(
      JSON.parse(options.body as string).contents[0].parts[0].inlineData,
    ).toEqual({ mimeType: 'audio/wav', data: 'AQID' });
  });
  it('rejects unsupported, empty, or oversized files before network I/O', async () => {
    const fetcher = transport();
    for (const value of [
      { ...audio, mimeType: 'application/pdf' },
      { ...audio, bytes: new Uint8Array() },
      { ...audio, bytes: new Uint8Array(MAX_AUDIO_BYTES + 1) },
    ])
      await expect(transcribeAudio(value, settings, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects missing credentials and other providers', async () => {
    await expect(
      transcribeAudio(audio, { ...settings, vlmApiKey: '' }, transport()),
    ).rejects.toThrow();
    await expect(
      transcribeAudio(
        audio,
        { ...settings, vlmModelName: 'other' },
        transport(),
      ),
    ).rejects.toThrow();
  });
  it('rejects incomplete or empty transcripts', async () => {
    await expect(
      transcribeAudio(audio, settings, transport('', 'MAX_TOKENS')),
    ).rejects.toThrow('incomplete');
    await expect(
      transcribeAudio(audio, settings, transport('')),
    ).rejects.toThrow('No speech');
  });
  it('surfaces quota failure without response-body secrets', async () => {
    await expect(
      transcribeAudio(
        audio,
        settings,
        vi.fn(async () => new Response('private', { status: 429 })),
      ),
    ).rejects.toThrow('429');
  });
});
