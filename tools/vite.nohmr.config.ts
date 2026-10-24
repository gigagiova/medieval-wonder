import { defineConfig } from 'vite';

// Dev server for long screenshot runs: no hot reload, no file watching, so
// edits elsewhere don't restart a page mid-render.
export default defineConfig({ base: './', server: { hmr: false, watch: null } });
