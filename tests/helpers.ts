import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The sample `players.db` committed at the repository root. */
export const SAMPLE_DB_PATH = join(root, 'players.db');

export function readSampleDatabase(): Uint8Array {
    return new Uint8Array(readFileSync(SAMPLE_DB_PATH));
}

/** Lets sql.js find its .wasm when running under node. */
export function locateWasm(file: string): string {
    return join(root, 'node_modules', 'sql.js', 'dist', file);
}

export function toHex(bytes: Uint8Array, start = 0, length = bytes.length - start): string {
    let out = '';
    for (let i = start; i < start + length && i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}

/** First differing byte offset between two buffers, or -1 when identical. */
export function firstDifference(a: Uint8Array, b: Uint8Array): number {
    const limit = Math.min(a.length, b.length);
    for (let i = 0; i < limit; i++) {
        if (a[i] !== b[i]) return i;
    }
    return a.length === b.length ? -1 : limit;
}

/** Opens the committed sample database with the node wasm locator. */
export async function openSampleDatabase() {
    const { PlayersDatabase } = await import('../src/save/PlayersDatabase');
    return PlayersDatabase.open(readSampleDatabase(), locateWasm);
}
