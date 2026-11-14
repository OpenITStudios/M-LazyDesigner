import './styles.css';
import RustEditorRoot from './RustEditorRoot.svelte';
import { mount } from 'svelte';

// Rust is the independent editor entrypoint on the selected Rust branch.
mount(RustEditorRoot, { target: document.getElementById('app')! });
