// api/_lib/strip.ts
// Removes metadata from delivered files and checks the result.
// Video: remux with ffmpeg (no re-encode, no quality loss), dropping container, stream and chapter metadata.
// Images: re-encoded with sharp, which drops EXIF, XMP, IPTC and text chunks (where AI tools store prompts).
//         The colour profile is kept so colours stay accurate. JPEG and WebP are saved at quality 95.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const run = promisify(execFile);

export const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};
export const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const extensionOf = (name: string) => name.toLowerCase().split('.').pop() ?? '';

// Container fields ffmpeg always reports. Anything else in the output counts as leftover metadata.
const ALLOWED_VIDEO_KEYS = new Set(['major_brand', 'minor_version', 'compatible_brands', 'encoder']);

const ffmpeg = () => {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found');
  return ffmpegPath as unknown as string;
};

export const leftoverVideoMetadata = async (path: string) => {
  const { stdout } = await run(ffmpeg(), ['-hide_banner', '-v', 'error', '-i', path, '-f', 'ffmetadata', '-'], {
    maxBuffer: 1024 * 1024,
  });
  return stdout
    .split('\n')
    .filter((l) => l && !l.startsWith(';') && !l.startsWith('['))
    .map((l) => l.split('=')[0].toLowerCase())
    .filter((key) => !ALLOWED_VIDEO_KEYS.has(key));
};

export const stripVideo = async (input: string, output: string, ext: string) => {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:v', '-map', '0:a?',
    '-c', 'copy',
    '-map_metadata', '-1',
    '-map_metadata:s:v', '-1',
    '-map_metadata:s:a', '-1',
    '-map_chapters', '-1',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
  ];
  if (ext !== 'webm') args.push('-movflags', '+faststart');
  args.push(output);
  await run(ffmpeg(), args, { timeout: 100_000, maxBuffer: 1024 * 1024 });
  return leftoverVideoMetadata(output);
};

export const leftoverImageMetadata = async (path: string) => {
  const meta = await sharp(path).metadata();
  const found: string[] = [];
  if (meta.exif) found.push('exif');
  if (meta.xmp) found.push('xmp');
  if (meta.iptc) found.push('iptc');
  if (meta.comments?.length) found.push('comments');
  return found;
};

export const stripImage = async (input: string, output: string, ext: string) => {
  // .rotate() bakes the EXIF orientation into the pixels first, so removing EXIF never turns a photo sideways.
  let pipeline = sharp(input, { failOn: 'error' }).rotate().keepIccProfile();
  if (ext === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
  else if (ext === 'webp') pipeline = pipeline.webp({ quality: 95 });
  else pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
  await pipeline.toFile(output);
  return leftoverImageMetadata(output);
};
