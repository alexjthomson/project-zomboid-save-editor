import { describe, expect, it } from 'vitest';
import { PlayersDatabase } from '../src/save/PlayersDatabase';
import { locateWasm, readSampleDatabase, firstDifference } from './helpers';
import { parsePlayerBlob, serializePlayerBlob } from '../src/save/PlayerBlobCodec';
import { calculateOverallHealth } from '../src/save/blocks/BodyDamage';
import { countInjuries, isDeadFromBlob, revivePlayer } from '../src/save/ops/health';
import { countItems } from '../src/save/blocks/Inventory';

const DEAD_USERNAME = 'QuackyBoi';

/**
 * The project's definition of done, start to finish: open the supplied
 * players.db, revive a dead character, export, re-open the export and confirm
 * the character is alive with all unrelated progression intact.
 */
describe('end to end', () => {
    it('revives a character, exports, and the exported database loads correctly', async () => {
        /* 1. Open the supplied players.db. */
        const db = await PlayersDatabase.open(readSampleDatabase(), locateWasm);
        const records = db.listPlayers();

        /* 2. Select a player record. */
        const target = records.find((r) => r.username === DEAD_USERNAME)!;
        expect(target).toBeDefined();

        /* 3-4. Extract and decode its BLOB. */
        const before = parsePlayerBlob(target.data, target.worldVersion);
        expect(isDeadFromBlob(before)).toBe(true);

        /* 5-6. Modify and re-serialize. */
        const working = parsePlayerBlob(target.data, target.worldVersion);
        revivePlayer(working);
        const newBlob = serializePlayerBlob(working, target.worldVersion);

        /* 7. Write it back into the row, clearing the authoritative death flag. */
        db.updatePlayer({ ...target, data: newBlob, isDead: false });

        /* 10. Export. */
        const exported = db.export();
        db.close();

        /* 12. The exported database opens and the character loads as alive. */
        const reopened = await PlayersDatabase.open(exported, locateWasm);
        try {
            const after = reopened.listPlayers();
            expect(after).toHaveLength(records.length);

            const revived = after.find((r) => r.username === DEAD_USERNAME)!;
            expect(revived.isDead).toBe(false);

            const player = parsePlayerBlob(revived.data, revived.worldVersion);
            expect(isDeadFromBlob(player)).toBe(false);
            expect(calculateOverallHealth(player.bodyDamage.parts)).toBe(100);
            expect(countInjuries(player)).toBe(0);
            expect(player.trailingBytes.length).toBe(0);

            /* 13. Unrelated progression is retained. */
            expect(player.descriptor!.forename).toBe(before.descriptor!.forename);
            expect(player.descriptor!.surname).toBe(before.descriptor!.surname);
            expect(player.descriptor!.profession).toBe(before.descriptor!.profession);
            expect(player.xp.xpMap).toEqual(before.xp.xpMap);
            expect(player.xp.perkLevels).toEqual(before.xp.perkLevels);
            expect(player.xp.traits).toEqual(before.xp.traits);
            expect(player.visual).toEqual(before.visual);
            expect(player.zombieKills).toBe(before.zombieKills);
            expect(player.hoursSurvived).toBe(before.hoursSurvived);
            expect(countItems(player.inventory)).toBe(countItems(before.inventory));
            expect(player.wornItems).toEqual(before.wornItems);
            expect(player.movingObject.x).toBe(before.movingObject.x);
            expect(revived.steamid).toBe(target.steamid);

            /* Untouched players must be byte-identical to the originals. */
            for (const original of records) {
                if (original.username === DEAD_USERNAME) continue;
                const same = after.find((r) => r.id === original.id)!;
                expect(
                    firstDifference(original.data, same.data),
                    `player "${original.username}" was modified but should not have been`,
                ).toBe(-1);
                expect(same.isDead).toBe(original.isDead);
            }
        } finally {
            reopened.close();
        }
    });

    it('keeps conditional payloads consistent when a flag is toggled', async () => {
        const db = await PlayersDatabase.open(readSampleDatabase(), locateWasm);
        const record = db.listPlayers()[0];
        db.close();

        const player = parsePlayerBlob(record.data, record.worldVersion);
        const part = player.bodyDamage.parts[0];

        // bandageLife/woundInfectionLevel/splintFactor are only written when
        // their boolean is set, so a mismatch changes the BLOB length and makes
        // the file unreadable. Setting a flag must add its payload.
        expect(part.bandaged).toBe(false);
        expect(part.bandageLife).toBeNull();

        part.bandaged = true;
        part.bandageLife = 100;
        part.infectedWound = true;
        part.woundInfectionLevel = 5;
        part.splint = true;
        part.splintFactor = 1;

        const grown = serializePlayerBlob(player, record.worldVersion);
        expect(grown.length).toBe(record.data.length + 12);

        const reparsed = parsePlayerBlob(grown, record.worldVersion);
        expect(reparsed.bodyDamage.parts[0].bandageLife).toBe(100);
        expect(reparsed.bodyDamage.parts[0].woundInfectionLevel).toBe(5);
        expect(reparsed.bodyDamage.parts[0].splintFactor).toBe(1);
        expect(reparsed.trailingBytes.length).toBe(0);
        expect(firstDifference(grown, serializePlayerBlob(reparsed))).toBe(-1);

        // And clearing them again must return the exact original bytes.
        reparsed.bodyDamage.parts[0].bandaged = false;
        reparsed.bodyDamage.parts[0].bandageLife = null;
        reparsed.bodyDamage.parts[0].infectedWound = false;
        reparsed.bodyDamage.parts[0].woundInfectionLevel = null;
        reparsed.bodyDamage.parts[0].splint = false;
        reparsed.bodyDamage.parts[0].splintFactor = null;
        expect(firstDifference(serializePlayerBlob(reparsed), record.data)).toBe(-1);
    });

    it('rejects a BLOB that does not match its declared world version', async () => {
        const db = await PlayersDatabase.open(readSampleDatabase(), locateWasm);
        const record = db.listPlayers()[0];
        db.close();

        // Version 201 removes several conditional fields, so the stream must
        // desynchronise rather than silently producing wrong values.
        const { tryParsePlayerBlob } = await import('../src/save/PlayerBlobCodec');
        const result = tryParsePlayerBlob(record.data, 201);
        const misparsed =
            result.error !== null || (result.player?.trailingBytes.length ?? 0) > 0;
        expect(misparsed).toBe(true);
    });
});
