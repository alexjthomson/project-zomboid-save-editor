import { describe, expect, it } from 'vitest';
import { PlayersDatabase } from '../src/save/PlayersDatabase';
import { locateWasm, readSampleDatabase } from './helpers';

describe('PlayersDatabase', () => {
    it('opens the sample players.db', async () => {
        const db = await PlayersDatabase.open(readSampleDatabase(), locateWasm);
        expect(db.tables).toContain('networkPlayers');
        db.close();
    });

    it('rejects files that are not SQLite databases', async () => {
        const notADatabase = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        await expect(PlayersDatabase.open(notADatabase, locateWasm)).rejects.toThrow();
    });

    it('describes the Project Zomboid schema', async () => {
        const db = await PlayersDatabase.open(readSampleDatabase(), locateWasm);
        const info = db.describe();
        const names = info.tables.map((t) => t.name);
        expect(names).toContain('localPlayers');
        expect(names).toContain('networkPlayers');

        const network = info.tables.find((t) => t.name === 'networkPlayers')!;
        expect(network.columns.map((c) => c.name)).toEqual([
            'id',
            'world',
            'username',
            'playerIndex',
            'name',
            'steamid',
            'x',
            'y',
            'z',
            'worldversion',
            'data',
            'isDead',
        ]);
        expect(info.indexes.map((i) => i.name)).toContain('inpusername');
        db.close();
    });

    it('enumerates players and extracts their BLOBs', async () => {
        const db = await PlayersDatabase.open(readSampleDatabase(), locateWasm);
        const players = db.listPlayers();
        expect(players.length).toBe(3);

        for (const player of players) {
            expect(player.table).toBe('networkPlayers');
            expect(player.data.length).toBeGreaterThan(1000);
            expect(player.worldVersion).toBe(249);
            expect(player.username).toBeTruthy();
        }

        const first = players[0];
        expect(first.name).toBe('Alex Thomson');
        expect(first.username).toBe('QuackyBoi');
        expect(first.steamid).toBe('76561198102963660');
        expect(first.x).toBeCloseTo(6138.2495, 3);
        db.close();
    });

    it('round-trips an export through a re-open', async () => {
        const db = await PlayersDatabase.open(readSampleDatabase(), locateWasm);
        const players = db.listPlayers();
        const exported = db.export();
        db.close();

        const reopened = await PlayersDatabase.open(exported, locateWasm);
        const reloaded = reopened.listPlayers();
        expect(reloaded.length).toBe(players.length);
        expect(reloaded[0].data).toEqual(players[0].data);
        reopened.close();
    });

    it('writes a modified BLOB back into the row', async () => {
        const db = await PlayersDatabase.open(readSampleDatabase(), locateWasm);
        const players = db.listPlayers();
        const target = players[0];

        const modified = new Uint8Array(target.data);
        modified[modified.length - 1] ^= 0xff;
        db.updatePlayer({ ...target, data: modified, isDead: true });

        const exported = db.export();
        db.close();

        const reopened = await PlayersDatabase.open(exported, locateWasm);
        const updated = reopened.listPlayers().find((p) => p.id === target.id)!;
        expect(updated.data).toEqual(modified);
        expect(updated.isDead).toBe(true);
        // Other rows untouched.
        const other = reopened.listPlayers().find((p) => p.id !== target.id)!;
        expect(other.data).toEqual(players.find((p) => p.id === other.id)!.data);
        reopened.close();
    });
});
