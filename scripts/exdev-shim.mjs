// Test helper for test-migrate-cross-volume.mjs (never used by the app):
//   EXDEV_ROOTS=<dirA><path.delimiter><dirB>  rename between the two roots throws EXDEV, as Linux does
//                                             between two Docker volumes / mount points
//   EXDEV_FAIL_NAME=<file name>               moving that file throws EIO (reproduces an interrupted run)
import fs from 'node:fs';
import path from 'node:path';

const roots = (process.env.EXDEV_ROOTS || '').split(path.delimiter).filter(Boolean).map(r => path.resolve(r).toLowerCase());
const rootOf = p => {
  const a = path.resolve(p).toLowerCase();
  return roots.find(r => a === r || a.startsWith(r + path.sep));
};
const failName = process.env.EXDEV_FAIL_NAME || '';
const original = fs.renameSync;

fs.renameSync = (from, to) => {
  if (failName && path.basename(String(from)) === failName) {
    throw Object.assign(new Error(`EIO: simulated failure moving '${from}'`), { code: 'EIO' });
  }
  const a = rootOf(String(from));
  const b = rootOf(String(to));
  if (a && b && a !== b) {
    throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${from}' -> '${to}'`), { code: 'EXDEV', errno: -18, syscall: 'rename' });
  }
  return original(from, to);
};
