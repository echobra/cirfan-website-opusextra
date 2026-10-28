// api/_lib/strip.ts
// Cleans delivered files and makes sure every video plays in every browser.
//
// Video:
//  - Already browser-safe (H.264, 8-bit 4:2:0, standard dynamic range): remuxed with ffmpeg. No re-encode,
//    no quality loss, metadata dropped.
//  - Anything else (HEVC/H.265, ProRes, 10-bit, HDR, VP9/AV1, unusual pixel formats): converted to H.264 MP4
//    at high quality (CRF 16). HDR is tone-mapped to standard range so it doesn't look grey and washed out.
//    Many browsers can't show HEVC, ProRes or 10-bit video at all: you hear the audio over a grey box.
//    Converted videos are capped at 1080 pixels on the short side (1080x1920 for vertical ads, the size ad
//    platforms ask for). Converting 4K phone footage at full size needs over 1.2 GB of memory and several
//    minutes, which crashes or times out a serverless function. Downscaling first halves the time and memory.
//  - Output is always .mp4.
// Images: re-encoded with sharp, which drops EXIF, XMP, IPTC and text chunks (where AI tools store prompts).
//         The color profile is kept so colors stay accurate. JPEG and WebP are saved at quality 95.
// After cleaning, the file is checked again; anything left over makes the upload fail.
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

const ffmpeg = () => {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found');
  return ffmpegPath as unknown as string;
};

// ---------- Probing (ffmpeg -i output; ffprobe is not bundled to keep the function small) ----------

/** Splits "a (b, c), d(e, f), g" on commas that are not inside parentheses. */
const splitTop = (text: string) => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

export type VideoInfo = {
  codec: string;
  profile: string;
  pixFmt: string;
  hdr: boolean;
  width: number;
  height: number;
  audio: string | null;
};

export const probeVideo = async (path: string): Promise<VideoInfo> => {
  // ffmpeg exits with an error when given no output; the stream description is still on stderr.
  const stderr = await run(ffmpeg(), ['-hide_banner', '-i', path], { maxBuffer: 1024 * 1024 }).then(
    (r) => r.stderr,
    (e: { stderr?: string }) => e.stderr ?? '',
  );
  const lines = stderr.split('\n');
  const videoLine = lines.find((l) => /Stream #\d+:\d+.*: Video: /.test(l) && !l.includes('(attached pic)'));
  if (!videoLine) throw new ProcessingError('unreadable', 'no video stream found');
  const audioLine = lines.find((l) => /Stream #\d+:\d+.*: Audio: /.test(l));

  const parts = splitTop(videoLine.split(': Video: ')[1]);
  const codec = parts[0].split(' ')[0];
  const profile = parts[0].match(/^\S+ \(([^)]+)\)/)?.[1] ?? '';
  const pixFmt = (parts[1] ?? '').split('(')[0].trim();
  const colorInfo = (parts[1] ?? '').toLowerCase();
  const size = parts.map((p) => p.match(/^(\d{2,5})x(\d{2,5})/)).find(Boolean);
  return {
    codec,
    profile,
    pixFmt,
    hdr: /smpte2084|arib-std-b67|bt2020/.test(colorInfo),
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    audio: audioLine ? audioLine.split(': Audio: ')[1].split(' ')[0].replace(/,$/, '') : null,
  };
};

export const isBrowserSafe = (v: VideoInfo) => v.codec === 'h264' && v.pixFmt === 'yuv420p' && !v.hdr;

export const describeVideo = (v: VideoInfo) =>
  [v.codec.toUpperCase(), v.profile, v.pixFmt, v.hdr ? 'HDR' : ''].filter(Boolean).join(' ');

// ---------- Metadata check ----------

// Container fields ffmpeg always reports. Anything else in the output counts as leftover metadata.
const ALLOWED_VIDEO_KEYS = new Set(['major_brand', 'minor_version', 'compatible_brands', 'encoder']);

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

const STRIP_ARGS = [
  '-map_metadata', '-1',
  '-map_metadata:s:v', '-1',
  '-map_metadata:s:a', '-1',
  '-map_chapters', '-1',
  '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
  '-movflags', '+faststart',
];

// Short side at most 1080 px, aspect ratio kept. Runs before tone mapping so the expensive steps work on fewer pixels.
const MAX_SHORT_SIDE = 1080;
const DOWNSCALE = `scale=w='if(gt(iw,ih),-2,min(${MAX_SHORT_SIDE},iw))':h='if(gt(iw,ih),min(${MAX_SHORT_SIDE},ih),-2)':flags=lanczos`;

// HDR (PQ or HLG) to standard range, Rec. 709, 8-bit 4:2:0.
const TONEMAP =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

/** Seconds ffmpeg may run. Leaves time to upload the result inside the function's 300 seconds. */
const CONVERT_TIMEOUT_MS = 230_000;

/** A failure the dashboard can explain, as opposed to a crash. */
export class ProcessingError extends Error {
  constructor(
    public code: 'conversion_timeout' | 'conversion_failed' | 'unreadable',
    public reason: string,
  ) {
    super(`${code}: ${reason}`);
  }
}

export type VideoResult = { leftovers: string[]; converted: boolean; source: string; width: number; height: number };

/** Writes a clean, browser-safe MP4 to `output` (which should end in .mp4). */
export const stripVideo = async (input: string, output: string): Promise<VideoResult> => {
  const info = await probeVideo(input);
  const safe = isBrowserSafe(info);
  const audioOk = !info.audio || info.audio === 'aac' || info.audio === 'mp3';
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?'];

  if (safe) {
    args.push('-c:v', 'copy');
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '16',
      '-profile:v', 'high',
      // Fewer threads and a shorter look-ahead keep memory well under the function's limit.
      '-threads', '2', '-filter_threads', '2', '-x264-params', 'rc-lookahead=20',
      '-vf', `${DOWNSCALE},${info.hdr ? TONEMAP : 'format=yuv420p'}`,
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    );
  }
  args.push(...(audioOk ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']));
  args.push(...STRIP_ARGS, output);

  try {
    await run(ffmpeg(), args, { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
  } catch (error) {
    const e = error as { killed?: boolean; stderr?: string; message: string };
    if (e.killed) throw new ProcessingError('conversion_timeout', `took longer than ${CONVERT_TIMEOUT_MS / 1000} seconds`);
    const reason = (e.stderr ?? e.message).trim().split('\n').pop() ?? 'ffmpeg failed';
    throw new ProcessingError('conversion_failed', reason.slice(0, 200));
  }

  const out = await probeVideo(output);
  if (!isBrowserSafe(out)) throw new ProcessingError('conversion_failed', `produced ${describeVideo(out)}`);
  return {
    leftovers: await leftoverVideoMetadata(output),
    converted: !safe,
    source: describeVideo(info),
    width: out.width,
    height: out.height,
  };
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
  const info = await pipeline.toFile(output);
  return { leftovers: await leftoverImageMetadata(output), width: info.width, height: info.height };
};
