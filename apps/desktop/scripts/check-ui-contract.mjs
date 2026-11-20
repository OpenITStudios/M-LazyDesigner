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
const nativeStage = read('src/NativeEditorStage.svelte');
const brand = read('branding/lazydesigner-ld-master.svg').trim();
const tauriBrand = read('src-tauri/app-icon.svg').trim();
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const rustEditor = read('src/RustEditorPage.svelte');
const rustHost = read('src-tauri/src/main.rs');
const rustAdapter = read('src-tauri/src/desktop_authoring.rs');
const rustEntry = read('src/main.ts');
const rustRoot = read('src/RustEditorRoot.svelte');
const agentOperator = read('code-mode/run.mjs');

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// The native Rust viewport and Paint atlas render vetted embedded PNG data
// URLs. Verify their exact CSP allowance without relaxing other origins.
const csp = String(config.app?.security?.csp ?? '');
const imageCsp = csp.split(';').map(rule => rule.trim()).find(rule => rule.startsWith('img-src '));
check(imageCsp === "img-src 'self' data:",
  'Rust embedded PNGs require only self/data image sources in native CSP');
check(rustEditor.includes("src={snapshot.texturePreviewSources[paintTextureIndex] ?? ''}"),
  'Rust Paint must continue to render Rust-vetted inline PNG data');
check(rustEditor.includes('onCloseRequested((event) =>') &&
  rustEditor.includes('event.preventDefault()') &&
  rustEditor.includes('unlistenClose?.()'),
  'Rust editor native close guard or teardown is missing');

// Source-level architectural checks only: they do not prove host isolation,
 // native file safety or that any Codex/agent integration is installed.
check(rustEntry.includes("import RustEditorRoot from './RustEditorRoot.svelte'") &&
  rustRoot.includes('<RustEditorPage onLegacy=') &&
  rustEditor.includes("'rust_editor_open'") &&
  rustAdapter.includes('pub async fn rust_editor_open('),
  'Rust editor must use the existing native saved-model opening path');
check([rustEntry, rustRoot, rustEditor, rustHost].every(source =>
  !source.includes('sandbox-worker.mjs') &&
  !source.includes('code-mode/run.mjs') &&
  !source.includes('lazydesigner_code_mode(') &&
  !source.includes('createCodeModeHost(')),
  'Rust GUI/Tauri entrypoints must not embed Code Mode AI execution');
check(agentOperator.includes('createCodeModeHost(') &&
  agentOperator.includes("args['--deno']") &&
  agentOperator.includes("args['--rust']"),
  'External agent operator must own the Code Mode host boundary');
check(rustEditor.includes('{#if liveReadAvailable}') &&
  rustEditor.includes('Pair external agent (read-only)'),
  'Experimental read-only agent pairing must stay behind native availability');
check(rustEditor.includes('function openLegacyWorkspace()') &&
  rustEditor.includes('if (loading || busy || paintStroke || snapshot?.dirty)') &&
  rustEditor.includes('onclick={openLegacyWorkspace}'),
  'Legacy navigation must not bypass the Rust unsaved-close guard');

check(rustHost.includes('desktop_authoring::rust_editor_export_bedrock_geometry,') &&
  rustAdapter.includes('pub async fn rust_editor_export_bedrock_geometry(') &&
  rustEditor.includes("'rust_editor_export_bedrock_geometry'") &&
  rustEditor.includes('onclick={() => void exportGeometry()}'),
  'Rust Bedrock Geometry exporter must be wired from native handler through UI');
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
check(editor.includes('blockbenchConfirmedStopped = Boolean(status && !status.blockbench.running'), 'Missing fresh observed-stopped admission for native recovery');
check(editor.includes('blockbenchObservationUnknown'), 'Unverified Blockbench state must be distinguished from stopped state');
check(editor.includes('class="native-recovery-layer"'), 'Closed-Blockbench center recovery UI missing');
check(editor.includes('onclick={() => void launchBlockbench()}'), 'Native recovery must use existing Blockbench launch action');
check(editor.includes("return afterDetach(openBlockbenchEditor);"), 'Native launch must preserve detach-before-action contract');
check(editor.includes('Refresh status'), 'Recovery must expose a status refresh action');
check(editor.includes('@container ld-sidebar'), 'Width-aware sidebar rule missing');
check(!editor.includes('class="workspace-return"'), 'Removed Workspace header button reintroduced');
check(nativeStage.includes("action: 'detach', viewport: null"), 'Native stage must request explicit Rust detach');
check(nativeStage.includes("receipt.status !== 'DETACHED'"), 'Native detach must require a confirmed DETACHED receipt');
check(nativeStage.includes("onPlacementChange('UNCERTAIN'"), 'Native stage must report uncertain recovery');
check(app.includes('editorNavigationPending = true;'), 'Editor navigation must lock while detaching');
check(app.includes('nativeEditorStage.detach().then(restored =>'), 'Leaving Editor must await native detach');
check(app.includes('if (restored) finishNavigate(next);'), 'Editor route must change only after confirmed detach');
check(editor.includes('nativeStage.detach()'), 'Editor file-picker/recovery path must use native detach');

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
