import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { getVersionSupport } from '../src/save/SaveVersion';
import { PlayersDatabase } from '../src/save/PlayersDatabase';
import { parsePlayerBlob, tracePlayerBlob } from '../src/save/PlayerBlobCodec';
import type { TraceNode } from '../src/save/BinaryWriter';
import { revivePlayer } from '../src/save/ops/health';
import { EditorState } from '../src/ui/state';
import { locateWasm, openSampleDatabase } from './helpers';

describe('getVersionSupport', () => {
    it('fully supports every version checked against source', () => {
        for (const version of [249, 250, 251]) {
            expect(getVersionSupport(version).level).toBe('full');
        }
    });

    it('refuses versions newer than anything verified', () => {
        expect(getVersionSupport(252).level).toBe('unsupported');
    });

    it('still handles older versions as before', () => {
        const older = getVersionSupport(230);
        expect(older.level).toBe('partial');
        expect(older.message).toContain('byte-for-byte');
        expect(getVersionSupport(100).level).toBe('unsupported');
    });
});

/**
 * Builds a single-player (`localPlayers`) database around a sample BLOB. The
 * committed fixture only has `networkPlayers` rows; world version 251 uses the
 * same player layout as 249 (checked against the 251 source), so a 249 BLOB
 * stands in for a 251 one.
 */
async function buildLocalDatabase(
    data: Uint8Array,
    row: { x: number; y: number; z: number; worldVersion: number; isDead: boolean },
): Promise<Uint8Array> {
    const SQL = await initSqlJs({ locateFile: locateWasm });
    const db = new SQL.Database();
    // PlayerDBHelper.create() — zombie/savefile/PlayerDBHelper.java:38
    db.run(
        'CREATE TABLE localPlayers (id INTEGER PRIMARY KEY NOT NULL, name STRING, wx INTEGER, ' +
            'wy INTEGER, x FLOAT, y FLOAT, z FLOAT, worldversion INTEGER, data BLOB, isDead BOOLEAN)',
    );
    db.run('INSERT INTO localPlayers VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        'Test Player',
        Math.floor(row.x / 8),
        Math.floor(row.y / 8),
        row.x,
        row.y,
        row.z,
        row.worldVersion,
        data,
        row.isDead ? 1 : 0,
    ]);
    const bytes = db.export();
    db.close();
    return bytes;
}

function findNode(node: TraceNode, name: string): TraceNode | null {
    if (node.name === name) return node;
    for (const child of node.children ?? []) {
        const found = findNode(child, name);
        if (found) return found;
    }
    return null;
}

async function sampleBlob(): Promise<{ data: Uint8Array; x: number; y: number; z: number }> {
    const db = await openSampleDatabase();
    const record = db.listPlayers()[0];
    db.close();
    return { data: record.data.slice(), x: record.x, y: record.y, z: record.z };
}

describe('world version 251 single-player save', () => {
    it('opens, revives, moves and exports a dead local character', async () => {
        const sample = await sampleBlob();
        const file = await buildLocalDatabase(sample.data, { ...sample, worldVersion: 251, isDead: true });

        const state = new EditorState();
        await state.open(file, 'players.db', locateWasm);
        const session = state.sessions[0];
        expect(session.record.table).toBe('localPlayers');
        expect(session.parseError).toBeNull();
        expect(session.roundTripOk).toBe(true);
        expect(state.isEditable(session)).toBe(true);
        expect(state.isModified(session)).toBe(false);

        revivePlayer(session.working!);
        session.isDead = false;
        session.working!.movingObject.x = 9001.5;
        session.working!.movingObject.y = 7003.5;

        const exported = state.export();
        state.close();

        const reopened = await PlayersDatabase.open(exported, locateWasm);
        const record = reopened.listPlayers()[0];
        reopened.close();
        expect(record.worldVersion).toBe(251);
        expect(record.isDead).toBe(false);
        expect(record.x).toBe(9001.5);
        expect(record.y).toBe(7003.5);
        // Chunk columns must follow the character, not keep the old chunk.
        expect(record.wx).toBe(1125);
        expect(record.wy).toBe(875);
        const player = parsePlayerBlob(record.data, record.worldVersion);
        expect(player.bodyDamage.parts.every((part) => part.health === 100)).toBe(true);
    });

    it('refuses to edit a BLOB that parses but does not round-trip', async () => {
        const sample = await sampleBlob();
        const parsed = parsePlayerBlob(sample.data, 249);
        expect(parsed.onFire).toBe(false);
        // A boolean byte of 2 reads as `true` but is written back as 1, so the
        // BLOB parses cleanly and still fails to reproduce.
        const onFire = findNode(tracePlayerBlob(parsed), 'onFire')!;
        const data = sample.data.slice();
        data[onFire.offset] = 2;
        const file = await buildLocalDatabase(data, { ...sample, worldVersion: 251, isDead: false });

        const state = new EditorState();
        await state.open(file, 'players.db', locateWasm);
        const session = state.sessions[0];
        expect(session.parseError).toBeNull();
        expect(session.roundTripOk).toBe(false);
        expect(state.isEditable(session)).toBe(false);
        expect(state.isModified(session)).toBe(false);

        // Changing only the SQL death flag must leave the BLOB untouched.
        session.isDead = true;
        const exported = state.export();
        state.close();
        const reopened = await PlayersDatabase.open(exported, locateWasm);
        const record = reopened.listPlayers()[0];
        reopened.close();
        expect(record.isDead).toBe(true);
        expect(Array.from(record.data)).toEqual(Array.from(data));
    });
});
