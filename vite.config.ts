import { defineConfig } from 'vite';

// `base` must match the GitHub Pages sub-path (https://<user>.github.io/<repo>/).
// It can be overridden at build time with `PZ_EDITOR_BASE=/ npm run build`.
const base = process.env.PZ_EDITOR_BASE ?? '/project-zomboid-save-editor/';

export default defineConfig({
    base,
    build: {
        outDir: 'dist',
        target: 'es2022',
        sourcemap: true,
    },
    // sql.js ships a prebuilt .wasm; it is copied into public/ by `npm run prepare:wasm`.
    optimizeDeps: {
        exclude: [],
    },
});
