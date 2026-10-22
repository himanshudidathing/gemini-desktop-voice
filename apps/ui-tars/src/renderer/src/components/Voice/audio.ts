export function decodePCM16(base64: string): Float32Array {
  const raw = atob(base64);
  if (raw.length % 2) throw new Error('Invalid PCM audio length.');
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const values = new Float32Array(raw.length / 2);
  for (let index = 0; index < values.length; index++)
    values[index] = view.getInt16(index * 2, true) / 32768;
  return values;
}

export function audioMimeType(file: Pick<File, 'name' | 'type'>): string {
  const known: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
  };
  return (
    known[file.name.split('.').pop()?.toLowerCase() || ''] ||
    file.type.split(';')[0]
  );
}
