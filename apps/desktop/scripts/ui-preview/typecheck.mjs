// Strict preview TypeScript/Svelte check with existing locked toolchain only; no installation.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
let checker;
try {
  checker = resolve(dirname(require.resolve('svelte-check/package.json')), 'bin/svelte-check');
} catch {
  console.error('[ui-preview:typecheck] NOT_EXECUTED: svelte-check is unavailable; no installation attempted.');
  process.exit(2);
}
const result = spawnSync(process.execPath, [checker, '--tsconfig', './scripts/ui-preview/tsconfig.json'], {
  cwd: appRoot, encoding: 'utf8', shell: false,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error || result.status !== 0) {
  console.error('[ui-preview:typecheck] FAILED or unavailable; browser/native NOT_EXECUTED.');
  process.exit(result.status || 1);
}
const summary = (String(result.stdout ?? '') + '\n' + String(result.stderr ?? '')).match(/svelte-check found\s+(\d+)\s+errors?\s+and\s+(\d+)\s+warnings?/i);
if (!summary || Number(summary[1]) !== 0 || Number(summary[2]) !== 0) {
  console.error('[ui-preview:typecheck] Strict acceptance requires 0 errors and 0 warnings.');
  process.exit(1);
}
console.log('[ui-preview:typecheck] 0 errors / 0 warnings; F2/browser/native NOT_EXECUTED.');
