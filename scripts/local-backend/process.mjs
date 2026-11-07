import { readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve relative Node script arguments against the process's actual working directory.
export function isOwnedNodeProcess(pid, script) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    return realpathSync(`/proc/${pid}/exe`) === realpathSync(process.execPath)
      && Boolean(args[1])
      && resolve(readlinkSync(`/proc/${pid}/cwd`), args[1]) === resolve(script);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    throw error;
  }
}
