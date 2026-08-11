import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('repository', () => {
    it('ships the format documentation the parser is derived from', () => {
        const doc = readFileSync(join(root, 'docs/players-db-format.md'), 'utf8');
        expect(doc).toContain('IsoGameCharacter.isDead()');
        expect(doc).toContain('calculateOverallHealth');
        expect(doc).toContain('saveWithSize');
    });

    it('has a Pages workflow that matches the Vite base handling', () => {
        const workflow = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
        expect(workflow).toContain('PZ_EDITOR_BASE');
        expect(workflow).toContain('npm test');
    });
});
