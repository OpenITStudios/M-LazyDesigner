// Source-only guardrails for the approved Desktop UI baseline.
// This is not a substitute for Svelte compilation, native Windows or visual QA.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const app = read('src/App.svelte');
const editor = read('src/UnifiedWorkspacePage.svelte');
const icons = read('src/EditorChromeIcon.svelte');
const brand = read('branding/lazydesigner-ld-master.svg').trim();
const tauriBrand = read('src-tauri/app-icon.svg').trim();
const config = JSON.parse(read('src-tauri/tauri.conf.json'));

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(brand === tauriBrand, 'Tauri icon source diverged from the approved LD master');
check(config.bundle?.windows?.nsis?.installerIcon === 'icons/icon.ico', 'NSIS installer icon path changed');
check(config.bundle?.icon?.includes('icons/icon.ico'), 'Windows bundle ICO missing');
check(editor.includes("import brandLogoUrl from '../branding/lazydesigner-ld-master.svg?url'"), 'Unified Editor must use approved LD master');
check(app.includes("import brandLogoUrl from '../branding/lazydesigner-ld-master.svg?url'"), 'Desktop navigation must use approved LD master');
check(app.includes("page === 'Editor' && import.meta.env.DEV"), 'Production Editor guard changed without native acceptance');
check(app.includes("if (next === 'Editor' && !import.meta.env.DEV) return;"), 'Production navigation guard missing');
check(editor.includes('class="native-stage"'), 'Native Blockbench stage reservation missing');
check(editor.includes('<NativeEditorStage'), 'Native Blockbench stage component missing');
check(editor.includes('class="sidebar-tabs"'), 'Projects/Status tab navigation missing');
check(editor.includes('class="sidebar-footer"'), 'Status footer missing');
check(editor.includes('class="status-indicator"'), 'System/AI status indicators missing');
check(editor.includes('class="tree-caret recent-caret"'), 'Recent Models disclosure alignment missing');
check(editor.includes('Help & settings'), 'Help & settings label missing');
check(editor.includes('readinessOutdated'), 'Stale-readiness guard missing');
check(editor.includes('@container ld-sidebar'), 'Width-aware sidebar rule missing');
check(!editor.includes('class="workspace-return"'), 'Removed Workspace header button reintroduced');

const iconNames = [...editor.matchAll(/<EditorChromeIcon\s+name="([^"]+)"/g)].map(match => match[1]);
for (const name of new Set(iconNames)) {
  check(icons.includes("'"+name+"'"), 'Unregistered EditorChromeIcon: '+name);
}
if (failures.length) {
  for (const failure of failures) console.error('FAIL: '+failure);
  process.exitCode = 1;
} else {
  console.log('PASS: approved UI source contract ('+new Set(iconNames).size+' static icon names). Native and visual QA remain separate.');
}
