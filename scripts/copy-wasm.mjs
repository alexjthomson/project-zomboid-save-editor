// Copies the sql.js WebAssembly binary into public/ so the built site can load
// it from a static path (GitHub Pages has no server-side logic).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const targetDir = join(root, 'public');
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, 'sql-wasm.wasm'));
console.log('copied sql-wasm.wasm -> public/sql-wasm.wasm');
