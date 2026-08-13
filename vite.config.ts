import { defineConfig } from 'vite';

/**
 * Normalises a public base path into the leading-and-trailing-slash form Vite
 * expects.
 *
 * The GitHub Pages workflow feeds this from `actions/configure-pages`, whose
 * `base_path` output has no trailing slash for a project site ("/my-repo") and
 * is empty for a user/organisation site served from the domain root.
 */
export function normalizeBase(raw: string | undefined): string {
    const value = (raw ?? '/project-zomboid-save-editor/').trim();
    if (value === '' || value === '/') return '/';
    const withLeading = value.startsWith('/') ? value : `/${value}`;
    return `${withLeading.replace(/\/+$/, '')}/`;
}

export default defineConfig({
    // Overridable at build time: `PZ_EDITOR_BASE=/ npm run build`.
    base: normalizeBase(process.env.PZ_EDITOR_BASE),
    build: {
        outDir: 'dist',
        target: 'es2022',
        sourcemap: true,
    },
});
