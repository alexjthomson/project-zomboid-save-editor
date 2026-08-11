import type { PlayerSession } from './state';
import type { TraceNode } from '../save/BinaryWriter';
import type { ByteDiffResult } from '../save/ops/diff';
import type { FieldChange } from '../save/ops/health';
import { formatChangeValue } from '../save/ops/diff';

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | boolean | number> = {},
    ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === false || value === null || value === undefined) continue;
        if (key === 'class') node.className = String(value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(value));
    }
    for (const child of children) {
        if (child === null || child === undefined) continue;
        node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

export function section(title: string, ...children: Array<Node | string | null>): HTMLElement {
    return el('div', { class: 'section' }, el('h3', {}, title), ...children);
}

export function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function hex(value: number, width = 4): string {
    return `0x${value.toString(16).padStart(width, '0')}`;
}

/** Classic offset / hex / ascii dump, optionally highlighting changed bytes. */
export function renderHexDump(
    bytes: Uint8Array,
    options: { start?: number; length?: number; highlight?: Set<number> } = {},
): HTMLElement {
    const start = options.start ?? 0;
    const end = Math.min(bytes.length, start + (options.length ?? bytes.length));
    const highlight = options.highlight;
    const root = el('div', { class: 'hex' });

    for (let row = start; row < end; row += 16) {
        const line = el('div');
        line.append(el('span', { class: 'off' }, `${row.toString(16).padStart(8, '0')}  `));

        let ascii = '';
        for (let i = 0; i < 16; i++) {
            const index = row + i;
            if (index >= end) {
                line.append(document.createTextNode('   '));
                continue;
            }
            const byte = bytes[index];
            const text = `${byte.toString(16).padStart(2, '0')} `;
            if (highlight?.has(index)) {
                line.append(el('mark', {}, text.trimEnd()), document.createTextNode(' '));
            } else {
                line.append(document.createTextNode(text));
            }
            ascii += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';
        }

        line.append(el('span', { class: 'ascii' }, ` |${ascii}|`));
        root.append(line);
    }

    if (end < bytes.length) {
        root.append(el('div', { class: 'off' }, `... ${bytes.length - end} more bytes`));
    }
    return root;
}

function traceValue(node: TraceNode): string {
    if (node.value === undefined) return '';
    if (typeof node.value === 'number') {
        return Number.isInteger(node.value) ? String(node.value) : node.value.toFixed(4);
    }
    if (typeof node.value === 'string') {
        const text = node.value.length > 60 ? `${node.value.slice(0, 60)}...` : node.value;
        return text === '' ? '""' : JSON.stringify(text);
    }
    return String(node.value);
}

/** Renders the nested field trace as a collapsible tree. */
export function renderTrace(root: TraceNode): HTMLElement {
    const container = el('div', { class: 'tree' });
    container.append(
        el(
            'div',
            { class: 'tree-head' },
            el('span', {}, 'Offset'),
            el('span', {}, 'Size'),
            el('span', {}, 'Type'),
            el('span', {}, 'Field'),
        ),
    );

    const build = (node: TraceNode, depth: number): HTMLElement => {
        if (!node.children || node.children.length === 0) {
            const row = el(
                'div',
                { class: 'node' },
                el('span', { class: 'n-off' }, hex(node.offset, 4)),
                el('span', { class: 'n-size' }, String(node.size)),
                el('span', { class: 'n-type' }, node.type),
                el(
                    'span',
                    { class: 'n-name' },
                    node.name,
                    node.value !== undefined ? el('span', { class: 'n-val' }, ` = ${traceValue(node)}`) : null,
                    node.condition ? el('span', { class: 'n-src' }, `  [${node.condition}]`) : null,
                    node.source ? el('span', { class: 'n-src' }, `  ${node.source}`) : null,
                ),
            );
            return row;
        }

        const details = el('details', depth < 1 ? { open: true } : {});
        details.append(
            el(
                'summary',
                {},
                `${hex(node.offset, 4)}  ${String(node.size).padStart(6)}  ${node.name}` +
                    (node.source ? `   — ${node.source}` : ''),
            ),
        );
        for (const child of node.children) {
            details.append(build(child, depth + 1));
        }
        return details;
    };

    for (const child of root.children ?? []) {
        container.append(build(child, 0));
    }
    return container;
}

export function renderChangeList(changes: FieldChange[]): HTMLElement {
    if (changes.length === 0) {
        return el('div', { class: 'empty' }, 'No changes yet.');
    }
    const root = el('div');
    for (const change of changes) {
        root.append(
            el(
                'div',
                { class: 'change' },
                el('div', { class: 'c-path' }, change.path),
                el(
                    'div',
                    { class: 'c-vals' },
                    el('span', { class: 'c-before' }, formatChangeValue(change.before)),
                    document.createTextNode(' \u2192 '),
                    el('span', { class: 'c-after' }, formatChangeValue(change.after)),
                ),
            ),
        );
    }
    return root;
}

export function renderByteDiff(diff: ByteDiffResult): HTMLElement {
    const root = el('div');
    if (diff.identical) {
        root.append(el('div', { class: 'empty' }, 'The serialized BLOB is byte-for-byte identical to the original.'));
        return root;
    }

    root.append(
        el(
            'p',
            { class: 'section-note' },
            `${diff.changedBytes} byte(s) changed across ${diff.runs.length} run(s). ` +
                `Length ${diff.beforeLength} \u2192 ${diff.afterLength}.` +
                (diff.truncated ? ' (list truncated)' : ''),
        ),
    );

    const toHexString = (bytes: Uint8Array) =>
        Array.from(bytes.slice(0, 24))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ') + (bytes.length > 24 ? ` ... (+${bytes.length - 24})` : '');

    for (const run of diff.runs) {
        root.append(
            el(
                'div',
                { class: 'diff-run' },
                el('div', { class: 'off' }, `${hex(run.offset, 4)}  (${run.length} bytes)`),
                el('div', { class: 'c-before' }, `- ${toHexString(run.before)}`),
                el('div', { class: 'c-after' }, `+ ${toHexString(run.after)}`),
            ),
        );
    }
    return root;
}

export function versionWarning(session: PlayerSession): HTMLElement | null {
    if (session.versionSupport.level === 'full') return null;
    return el(
        'div',
        { class: session.versionSupport.level === 'unsupported' ? 'err-box' : 'warn-box' },
        el('strong', {}, `World version ${session.versionSupport.version}: `),
        session.versionSupport.message,
    );
}

export function parseErrorBox(session: PlayerSession): HTMLElement | null {
    if (!session.parseError) return null;
    return el(
        'div',
        { class: 'err-box' },
        `This character's BLOB could not be decoded, so editing is disabled and its bytes will be ` +
            `written back unchanged.\n\n${session.parseError.message}`,
    );
}
