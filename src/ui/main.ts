import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { EditorState, type PlayerSession } from './state';
import { el, renderChangeList, versionWarning, parseErrorBox, formatBytes } from './components';
import { renderPanel } from './panels';
import { parsePlayerBlob } from '../save/PlayerBlobCodec';
import { diffPlayers } from '../save/ops/diff';
import { isDeadFromBlob } from '../save/ops/health';

const state = new EditorState();

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    document.querySelector(selector) as T;

const screenOpen = $('#screen-open');
const screenEditor = $('#screen-editor');
const dropzone = $('#dropzone');
const fileInput = $<HTMLInputElement>('#file-input');
const openError = $('#open-error');
const playerList = $('#player-list');
const playerHeader = $('#player-header');
const changeList = $('#change-list');
const dbInfo = $('#db-info');
const dbSummary = $('#db-summary');
const btnExport = $<HTMLButtonElement>('#btn-export');
const btnResetDb = $<HTMLButtonElement>('#btn-reset-db');
const btnResetPlayer = $<HTMLButtonElement>('#btn-reset-player');
const btnClose = $<HTMLButtonElement>('#btn-close');

/** sql.js needs an absolute URL to its .wasm; Vite rewrites this for the Pages base path. */
const locateFile = (file: string): string => (file.endsWith('.wasm') ? wasmUrl : file);

function toast(message: string, isError = false): void {
    const node = el('div', { class: `toast${isError ? ' is-error' : ''}` }, message);
    document.body.append(node);
    setTimeout(() => node.remove(), 3800);
}

async function openFile(file: File): Promise<void> {
    openError.hidden = true;
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await state.open(bytes, file.name, locateFile);
        if (state.sessions.length === 0) {
            throw new Error(
                'This database has no player rows in localPlayers or networkPlayers. ' +
                    'Make sure you picked players.db and not another save file.',
            );
        }
        screenOpen.hidden = true;
        screenEditor.hidden = false;
        btnExport.hidden = false;
        btnResetDb.hidden = false;
        btnClose.hidden = false;
        render();
    } catch (error) {
        openError.hidden = false;
        openError.textContent = (error as Error).message;
    }
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

function renderSidebar(): void {
    playerList.replaceChildren();
    state.sessions.forEach((session, index) => {
        const dead = session.isDead || (session.working ? isDeadFromBlob(session.working) : false);
        const modified = state.isModified(session);

        const item = el(
            'li',
            { class: `player-item${index === state.selectedIndex ? ' is-active' : ''}` },
            el(
                'div',
                { class: 'pi-name' },
                session.record.name ?? '(unnamed)',
                el('span', { class: `badge ${dead ? 'badge-dead' : 'badge-alive'}` }, dead ? 'Dead' : 'Alive'),
                modified ? el('span', { class: 'badge badge-edited' }, 'Edited') : null,
                session.parseError ? el('span', { class: 'badge badge-error' }, 'Unreadable') : null,
            ),
            el(
                'div',
                { class: 'pi-meta' },
                `${session.record.username ?? session.record.table} · ` +
                    `${Math.round(session.record.x)}, ${Math.round(session.record.y)}, ${Math.round(session.record.z)}`,
            ),
        );
        item.addEventListener('click', () => {
            state.selectedIndex = index;
            render();
        });
        playerList.append(item);
    });

    dbInfo.replaceChildren();
    const rows: Array<[string, string]> = [
        ['File', state.fileName],
        ['Size', formatBytes(state.fileSize)],
        ['Players', String(state.sessions.length)],
        ['Modified', String(state.modifiedCount)],
    ];
    const first = state.sessions[0];
    if (first) {
        rows.push(['World', first.record.world ?? '(local)']);
        rows.push(['World version', String(first.record.worldVersion)]);
    }
    for (const [key, value] of rows) {
        dbInfo.append(el('dt', {}, key), el('dd', {}, value));
    }

    dbSummary.textContent = state.modifiedCount > 0 ? `${state.modifiedCount} player(s) modified` : '';
}

function renderHeader(session: PlayerSession): void {
    const dead = session.isDead || (session.working ? isDeadFromBlob(session.working) : false);
    playerHeader.replaceChildren(
        el(
            'h2',
            {},
            session.record.name ?? '(unnamed)',
            el('span', { class: `badge ${dead ? 'badge-dead' : 'badge-alive'}` }, dead ? 'Dead' : 'Alive'),
        ),
        el(
            'div',
            { class: 'ph-meta' },
            `${session.record.table} row #${session.record.id}` +
                (session.record.username ? ` · ${session.record.username}` : '') +
                (session.record.steamid ? ` · Steam ${session.record.steamid}` : '') +
                ` · world version ${session.record.worldVersion}` +
                ` · BLOB ${session.originalBlob.length} bytes`,
        ),
    );
}

function renderChanges(session: PlayerSession): void {
    const changes = [];
    if (session.isDead !== session.originalIsDead) {
        changes.push({
            path: 'database.isDead',
            label: 'Marked dead (SQL column)',
            before: session.originalIsDead,
            after: session.isDead,
        });
    }
    if (session.original && session.working) {
        changes.push(...diffPlayers(session.original, session.working));
    }
    changeList.replaceChildren(renderChangeList(changes));
    btnResetPlayer.disabled = changes.length === 0;
}

function render(): void {
    const session = state.selected;
    renderSidebar();
    if (!session) return;

    renderHeader(session);
    renderChanges(session);

    const editable = session.working !== null && session.versionSupport.level !== 'unsupported';
    const currentBlob = state.currentBlob(session);

    const ctx = {
        session,
        currentBlob,
        editable,
        onChange: render,
        toast,
    };

    for (const panel of document.querySelectorAll<HTMLElement>('.panel')) {
        const tab = panel.dataset.panel!;
        panel.hidden = tab !== state.activeTab;
        if (panel.hidden) {
            panel.replaceChildren();
            continue;
        }
        const children: Node[] = [];
        const warning = versionWarning(session);
        if (warning) children.push(warning);
        const parseErr = parseErrorBox(session);
        if (parseErr) children.push(parseErr);
        children.push(renderPanel(tab, ctx));
        panel.replaceChildren(...children);
    }

    for (const tabButton of document.querySelectorAll<HTMLElement>('.tab')) {
        tabButton.classList.toggle('is-active', tabButton.dataset.tab === state.activeTab);
    }
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

$('#btn-pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void openFile(file);
    fileInput.value = '';
});

for (const event of ['dragenter', 'dragover'] as const) {
    dropzone.addEventListener(event, (e) => {
        e.preventDefault();
        dropzone.classList.add('is-over');
    });
}
for (const event of ['dragleave', 'drop'] as const) {
    dropzone.addEventListener(event, (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-over');
    });
}
dropzone.addEventListener('drop', (e) => {
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (file) void openFile(file);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

$('#tabs').addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.tab');
    if (!target) return;
    state.activeTab = target.dataset.tab!;
    render();
});

btnResetPlayer.addEventListener('click', () => {
    const session = state.selected;
    if (!session) return;
    state.resetPlayer(session);
    toast('Player changes reset.');
    render();
});

btnResetDb.addEventListener('click', () => {
    state.resetAll();
    toast('All changes reset.');
    render();
});

btnExport.addEventListener('click', () => {
    try {
        const bytes = state.export();
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = el('a', { href: url, download: 'players.db' });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Exported players.db — back up the original before replacing it.');
        render();
    } catch (error) {
        toast(`Export failed: ${(error as Error).message}`, true);
    }
});

btnClose.addEventListener('click', () => {
    if (state.modifiedCount > 0 && !confirm('Discard unsaved changes and close the database?')) return;
    state.close();
    screenEditor.hidden = true;
    screenOpen.hidden = false;
    btnExport.hidden = true;
    btnResetDb.hidden = true;
    btnClose.hidden = true;
    dbSummary.textContent = '';
});

window.addEventListener('beforeunload', (e) => {
    if (state.modifiedCount > 0) {
        e.preventDefault();
        e.returnValue = '';
    }
});

/* Re-exported for the console so the format can be inspected interactively. */
Object.assign(globalThis, { pzEditor: { state, parsePlayerBlob } });
