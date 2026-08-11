import { describe, expect, it } from 'vitest';
import { openSampleDatabase, firstDifference, toHex } from './helpers';
import { parsePlayerBlob, serializePlayerBlob, tryParsePlayerBlob } from '../src/save/PlayerBlobCodec';
import { countItems } from '../src/save/blocks/Inventory';
import { calculateOverallHealth } from '../src/save/blocks/BodyDamage';

describe('player BLOB codec', () => {
    it('parses every player in the sample database', async () => {
        const db = await openSampleDatabase();
        try {
            const players = db.listPlayers();
            expect(players.length).toBeGreaterThan(0);

            for (const record of players) {
                const result = tryParsePlayerBlob(record.data, record.worldVersion);
                if (result.error) {
                    throw new Error(
                        `player "${record.username}" failed at offset ${result.errorOffset}: ` +
                            `${result.error.message}\n` +
                            `context: ${toHex(record.data.subarray(Math.max(0, (result.errorOffset ?? 0) - 32), (result.errorOffset ?? 0) + 32))}`,
                    );
                }
                expect(result.player).not.toBeNull();
            }
        } finally {
            db.close();
        }
    });

    it('consumes the BLOB exactly, leaving no trailing bytes', async () => {
        const db = await openSampleDatabase();
        try {
            for (const record of db.listPlayers()) {
                const player = parsePlayerBlob(record.data, record.worldVersion);
                expect(
                    player.trailingBytes.length,
                    `player "${record.username}" left ${player.trailingBytes.length} unparsed trailing bytes`,
                ).toBe(0);
            }
        } finally {
            db.close();
        }
    });

    it('round-trips every player BLOB byte-for-byte', async () => {
        const db = await openSampleDatabase();
        try {
            for (const record of db.listPlayers()) {
                const player = parsePlayerBlob(record.data, record.worldVersion);
                const reserialized = serializePlayerBlob(player);

                const diff = firstDifference(record.data, reserialized);
                if (diff !== -1) {
                    throw new Error(
                        `player "${record.username}" differs at offset ${diff} (0x${diff.toString(16)})\n` +
                            `original:     ${toHex(record.data.subarray(Math.max(0, diff - 16), diff + 16))}\n` +
                            `reserialized: ${toHex(reserialized.subarray(Math.max(0, diff - 16), diff + 16))}\n` +
                            `lengths: ${record.data.length} vs ${reserialized.length}`,
                    );
                }
                expect(reserialized.length).toBe(record.data.length);
            }
        } finally {
            db.close();
        }
    });

    it('decodes recognisable character data', async () => {
        const db = await openSampleDatabase();
        try {
            const records = db.listPlayers();
            for (const record of records) {
                const player = parsePlayerBlob(record.data, record.worldVersion);

                // The descriptor name must match the database columns, which are
                // written separately by ServerPlayerDB from the same character.
                expect(player.descriptor).not.toBeNull();
                const fullName = `${player.descriptor!.forename} ${player.descriptor!.surname}`.trim();
                expect(fullName).toBe(record.name);

                // Coordinates in the BLOB must match the indexed x/y/z columns.
                expect(player.movingObject.x).toBeCloseTo(record.x, 3);
                expect(player.movingObject.y).toBeCloseTo(record.y, 3);
                expect(player.movingObject.z).toBeCloseTo(record.z, 3);

                expect(player.bodyDamage.parts).toHaveLength(17);
                expect(countItems(player.inventory)).toBeGreaterThanOrEqual(0);

                const overall = calculateOverallHealth(player.bodyDamage.parts);
                expect(overall).toBeGreaterThanOrEqual(0);
                expect(overall).toBeLessThanOrEqual(100);

            // The sample database contains one character whose body parts are all
            // at (or near) zero health. IsoGameCharacter.isDead() is
            // `health <= 0 || bodyDamage.getHealth() <= 0`, so this character is
            // dead even though the SQL isDead column is 0 - exactly the state the
            // revive operation exists to repair.
            const quacky = records.find((r) => r.username === 'QuackyBoi')!;
            const deadPlayer = parsePlayerBlob(quacky.data, quacky.worldVersion);
            expect(calculateOverallHealth(deadPlayer.bodyDamage.parts)).toBe(0);
            }
        } finally {
            db.close();
        }
    });
});

describe('BLOB field trace', () => {
    it('produces a nested trace covering the whole BLOB', async () => {
        const { tracePlayerBlob } = await import('../src/save/PlayerBlobCodec');
        const db = await openSampleDatabase();
        try {
            const record = db.listPlayers()[0];
            const player = parsePlayerBlob(record.data, record.worldVersion);
            const trace = tracePlayerBlob(player);

            expect(trace.size).toBe(record.data.length);
            expect(trace.children!.length).toBeGreaterThan(0);

            const names = trace.children!.map((c) => c.name);
            expect(names).toContain('IsoMovingObject');
            expect(names).toContain('IsoGameCharacter');
            expect(names).toContain('IsoPlayer');

            // Offsets must be contiguous and in order, proving the trace is a
            // faithful map of the serialized bytes.
            let expected = 0;
            const walk = (node: { offset: number; size: number; children?: unknown[] }) => {
                expect(node.offset).toBe(expected);
                if (!node.children || node.children.length === 0) {
                    expected += node.size;
                    return;
                }
                for (const child of node.children) {
                    walk(child as never);
                }
                expect(expected).toBe(node.offset + node.size);
            };
            for (const child of trace.children!) {
                walk(child as never);
            }
            expect(expected).toBe(record.data.length);

            // A named leaf must carry its provenance.
            const iso = trace.children!.find((c) => c.name === 'IsoMovingObject')!;
            const xField = iso.children!.find((c) => c.name === 'x')!;
            expect(xField.type).toBe('float32');
            expect(xField.source).toContain('IsoMovingObject');
            expect(xField.value).toBeCloseTo(record.x, 3);
        } finally {
            db.close();
        }
    });
});
