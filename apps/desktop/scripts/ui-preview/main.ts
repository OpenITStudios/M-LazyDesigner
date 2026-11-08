// Toolbar-only Vite entry. iframe loads REAL production index.html -> src/main.ts -> App.svelte.
import { mount } from 'svelte';
import PreviewApp from './PreviewApp.svelte';

const target = document.querySelector<HTMLDivElement>('#ui-preview');
if (!target) throw new Error('The UI preview controls root is unavailable.');
mount(PreviewApp, { target });
