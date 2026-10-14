// Audio helpers (ffmpeg/ffprobe). Phone recordings from MediaRecorder
// (webm/opus, fragmented mp4) carry no duration metadata, so players show
// 0:00 and can't seek. Converting to .m4a (AAC, faststart) fixes that.
// If ffmpeg is missing, everything degrades gracefully: files stay as-is.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FFMPEG  = process.env.FFMPEG_PATH  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function run(cmd, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${path.basename(cmd)} failed: ${(stderr || err.message).toString().trim().split('\n').pop()}`;
        reject(err);
      } else {
        resolve(stdout.toString());
      }
    });
  });
}

let availablePromise = null;

function ffmpegAvailable() {
  if (!availablePromise) {
    availablePromise = Promise.all([run(FFMPEG, ['-version'], 10000), run(FFPROBE, ['-version'], 10000)])
      .then(() => true, () => {
        console.warn('[audio] ffmpeg/ffprobe not found — quick note audio will not be converted');
        return false;
      });
  }
  return availablePromise;
}

async function probeDuration(file) {
  try {
    const out = await run(FFPROBE, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ], 30000);
    const sec = parseFloat(out);
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 10) / 10 : null;
  } catch {
    return null;
  }
}

async function probeCodec(file) {
  try {
    const out = await run(FFPROBE, [
      '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ], 30000);
    return out.trim().toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Convert an audio file to <same name>.m4a (AAC). AAC input is remuxed
 * losslessly; anything else (opus, etc.) is re-encoded.
 * Returns { converted, file (basename), durationSec }. On failure the original
 * file is kept and returned with whatever duration ffprobe can read.
 */
async function convertToM4a(srcPath) {
  const src = path.resolve(srcPath);
  if (!(await ffmpegAvailable())) {
    return { converted: false, file: path.basename(src), durationSec: null, error: 'ffmpeg not available' };
  }

  const out = src.replace(/\.[^.]+$/, '') + '.m4a';
  const tmp = src.replace(/\.[^.]+$/, '') + '.converting.m4a';
  try {
    const codec = await probeCodec(src);
    const codecArgs = codec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '96k'];
    await run(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', src, '-vn', '-map_metadata', '-1',
      ...codecArgs, '-movflags', '+faststart', '-f', 'mp4', tmp,
    ]);
    const durationSec = await probeDuration(tmp);
    if (!durationSec) throw new Error('converted file has no duration');
    fs.renameSync(tmp, out);
    if (out !== src) fs.rmSync(src, { force: true });
    return { converted: true, file: path.basename(out), durationSec };
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    return { converted: false, file: path.basename(src), durationSec: await probeDuration(src), error: err.message };
  }
}

module.exports = { ffmpegAvailable, convertToM4a, probeDuration };
