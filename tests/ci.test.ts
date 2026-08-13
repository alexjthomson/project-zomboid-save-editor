import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBase } from '../vite.config';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('repository', () => {
    it('ships the format documentation the parser is derived from', () => {
        const doc = read('docs/players-db-format.md');
        expect(doc).toContain('IsoGameCharacter.isDead()');
        expect(doc).toContain('calculateOverallHealth');
        expect(doc).toContain('saveWithSize');
    });

    it('has a Pages workflow wired to the build, tests and base path', () => {
        const w = read('.github/workflows/deploy.yml');
        expect(w).toContain('actions/configure-pages');
        expect(w).toContain('actions/upload-pages-artifact');
        expect(w).toContain('actions/deploy-pages');
        expect(w).toContain('npm test');
        // The base path must come from configure-pages, not be hardcoded.
        expect(w).toContain('PZ_EDITOR_BASE: ${{ steps.pages.outputs.base_path }}');
        expect(w).toMatch(/pages:\s*write/);
        expect(w).toMatch(/id-token:\s*write/);
        // upload-pages-artifact must publish the Vite output directory.
        expect(w).toMatch(/path:\s*dist/);
    });
});

/**
 * `actions/configure-pages` emits `base_path` without a trailing slash for a
 * project site and empty for a user/organisation site. Vite needs a leading and
 * trailing slash, so getting this wrong yields a site that 404s every asset.
 */
describe('normalizeBase', () => {
    it.each([
        ['/my-repo', '/my-repo/'],
        ['my-repo', '/my-repo/'],
        ['/my-repo/', '/my-repo/'],
        ['/my-repo///', '/my-repo/'],
        ['', '/'],
        ['/', '/'],
        ['  /spaced  ', '/spaced/'],
        ['/nested/path', '/nested/path/'],
    ])('normalizes %o to %o', (input, expected) => {
        expect(normalizeBase(input)).toBe(expected);
    });

    it('falls back to the repository sub-path when unset', () => {
        expect(normalizeBase(undefined)).toBe('/project-zomboid-save-editor/');
    });
});
