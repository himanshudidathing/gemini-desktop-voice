import { app, desktopCapturer, screen, shell } from 'electron';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MediaArtifact } from '../shared/assistant';
import { abortable } from './operations';

type Saved = MediaArtifact & { bytes?: Buffer };
const artifacts = new Map<string, Saved>();
let capture: ReturnType<typeof desktopCapturer.getSources> | undefined;
const remember = (artifact: Saved) => {
  artifacts.set(artifact.id, artifact);
  while (artifacts.size > 50) artifacts.delete(artifacts.keys().next().value!);
  const { bytes: _, ...publicArtifact } = artifact;
  return publicArtifact;
};
export async function takeScreenshot(
  signal: AbortSignal,
): Promise<MediaArtifact> {
  signal.throwIfAborted();
  const display = screen.getPrimaryDisplay();
  if (!capture) {
    const pending: ReturnType<typeof desktopCapturer.getSources> =
      desktopCapturer
        .getSources({
          types: ['screen'],
          fetchWindowIcons: false,
          thumbnailSize: {
            width: Math.round(display.size.width * display.scaleFactor),
            height: Math.round(display.size.height * display.scaleFactor),
          },
        })
        .finally(() => {
          if (capture === pending) capture = undefined;
        });
    capture = pending;
  }
  const pending = capture;
  let sources: Awaited<typeof pending>;
  try {
    sources = await abortable(pending, signal);
  } catch (error) {
    if (signal.aborted && capture === pending) capture = undefined;
    throw error;
  }
  signal.throwIfAborted();
  const image = (
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  )?.thumbnail;
  if (!image || image.isEmpty())
    throw new Error(
      'Screen capture is unavailable. Check screen-recording permission.',
    );
  const id = randomUUID();
  const folder = path.join(app.getPath('pictures'), 'Gemini Desktop');
  const name =
    'Screenshot-' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '-' +
    id.slice(0, 8) +
    '.png';
  const file = path.join(folder, name);
  await mkdir(folder, { recursive: true });
  signal.throwIfAborted();
  try {
    await writeFile(file, image.toPNG(), { flag: 'wx', signal });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
      await unlink(file).catch(() => {});
    throw error;
  }
  if (signal.aborted) {
    await unlink(file).catch(() => {});
    signal.throwIfAborted();
  }
  const size = image.getSize();
  const resized = image.resize({ width: Math.min(1600, size.width) });
  return remember({
    id,
    kind: 'screenshot',
    name,
    path: file,
    bytes: resized.toJPEG(70),
    preview:
      'data:image/jpeg;base64,' +
      image
        .resize({ width: Math.min(720, size.width) })
        .toJPEG(65)
        .toString('base64'),
  });
}
export function screenshotPart(id: string) {
  const artifact = artifacts.get(id);
  if (!artifact || artifact.kind !== 'screenshot' || !artifact.bytes)
    throw new Error('Capture a screenshot again to analyze it.');
  return {
    inlineData: {
      mimeType: 'image/jpeg',
      data: artifact.bytes.toString('base64'),
    },
  };
}
export function revealArtifact(id: string) {
  const artifact = artifacts.get(id);
  if (!artifact)
    throw new Error('This capture is no longer in the current session.');
  shell.showItemInFolder(artifact.path);
}

type Recording = {
  id: string;
  name: string;
  path: string;
  temp: string;
  handle: FileHandle;
  tail: Promise<void>;
  bytes: number;
  started: number;
  closing: boolean;
  failure?: Error;
};
let recording: Recording | null = null;
export function currentRecordingId() {
  return recording?.id;
}
export async function beginRecording() {
  if (recording) throw new Error('A recording is already active.');
  const folder = path.join(app.getPath('videos'), 'Gemini Desktop');
  const id = randomUUID(),
    name =
      'Recording-' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '-' +
      id.slice(0, 8) +
      '.webm';
  const file = path.join(folder, name),
    temp = file + '.part';
  await mkdir(folder, { recursive: true });
  const handle = await open(temp, 'wx');
  if (recording) {
    await handle.close();
    await unlink(temp);
    throw new Error('A recording is already active.');
  }
  recording = {
    id,
    name,
    path: file,
    temp,
    handle,
    tail: Promise.resolve(),
    bytes: 0,
    started: Date.now(),
    closing: false,
  };
  return id;
}
export async function appendRecording(id: string, bytes: Uint8Array) {
  const r = recording;
  if (!r || r.id !== id || r.closing) throw new Error('Recording has stopped.');
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > 8 * 1024 * 1024 ||
    !bytes.length
  )
    throw new Error('Invalid recording chunk.');
  if (r.bytes + bytes.length > 512 * 1024 * 1024)
    throw new Error('Recording reached the 512 MB limit.');
  r.bytes += bytes.length;
  r.tail = r.tail
    .then(async () => {
      if (r.failure) throw r.failure;
      await r.handle.writeFile(bytes);
    })
    .catch((error) => {
      r.failure = error;
      throw error;
    });
  await r.tail;
}
export async function finishRecording(
  id?: string,
): Promise<MediaArtifact | null> {
  const r = recording;
  if (!r || (id && r.id !== id) || r.closing) return null;
  r.closing = true;
  try {
    await r.tail.catch(() => {});
    await r.handle.close();
    if (!r.bytes || r.failure) {
      await unlink(r.temp).catch(() => {});
      if (r.failure) throw r.failure;
      return null;
    }
    await rename(r.temp, r.path);
    return remember({
      id: r.id,
      name: r.name,
      path: r.path,
      kind: 'recording',
      durationMs: Date.now() - r.started,
    });
  } finally {
    if (recording === r) recording = null;
  }
}
