import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = readFileSync(resolve(root, 'branding/lazydesigner-ld-master.svg'), 'utf8').trim();
const tauriSource = readFileSync(resolve(root, 'src-tauri/app-icon.svg'), 'utf8').trim();
if (canonical !== tauriSource) {
  console.error('LazyDesigner icon sources differ. Sync src-tauri/app-icon.svg with branding/lazydesigner-ld-master.svg before generating Windows assets.');
  process.exitCode = 1;
} else {
  console.log('LazyDesigner LD icon source matches the approved branding master.');
}
