import { describe, expect, it } from 'vitest';
import { openSampleDatabase, firstDifference } from './helpers';
import { parsePlayerBlob, serializePlayerBlob } from '../src/save/PlayerBlobCodec';
import {
    countInjuries,
    isDeadFromBlob,
    restoreFullHealth,
    revivePlayer,
} from '../src/save/ops/health';
import { calculateOverallHealth } from '../src/save/blocks/BodyDamage';
import { diffBytes, diffPlayers } from '../src/save/ops/diff';
import { countItems } from '../src/save/blocks/Inventory';

/** The sample database's character whose body parts are all at ~0 health. */
const DEAD_USERNAME = 'QuackyBoi';

async function loadPlayer(username: string) {
    const db = await openSampleDatabase();
    const record = db.listPlayers().find((r) => r.username === username);
    if (!record) throw new Error(`no player "${username}" in the sample database`);
    const player = parsePlayerBlob(record.data, record.worldVersion);
    db.close();
    return { record, player };
}

describe('revivePlayer', () => {
    it('turns a character that loads as dead into a living one', async () => {
        const { player } = await loadPlayer(DEAD_USERNAME);

        expect(isDeadFromBlob(player)).toBe(true);
        expect(calculateOverallHealth(player.bodyDamage.parts)).toBe(0);

        const result = revivePlayer(player);

        expect(isDeadFromBlob(player)).toBe(false);
        expect(calculateOverallHealth(player.bodyDamage.parts)).toBe(100);
        expect(result.changes.length).toBeGreaterThan(0);
    });

    it('clears every persistent state that causes death or damage', async () => {
        const { player } = await loadPlayer(DEAD_USERNAME);
        revivePlayer(player);

        for (const part of player.bodyDamage.parts) {
            expect(part.health, `${part.type} health`).toBe(100);
            expect(part.bleeding).toBe(false);
            expect(part.bitten).toBe(false);
            expect(part.scratched).toBe(false);
            expect(part.cut).toBe(false);
            expect(part.deepWounded).toBe(false);
            expect(part.infected).toBe(false);
            expect(part.fakeInfected).toBe(false);
            expect(part.infectedWound).toBe(false);
            expect(part.woundInfectionLevel).toBeNull();
            expect(part.fractureTime).toBe(0);
            expect(part.burnTime).toBe(0);
            expect(part.haveGlass).toBe(false);
            expect(part.haveBullet).toBe(false);
            expect(part.additionalPain).toBe(0);
            expect(part.bleedingTime).toBe(0);
        }

        // Infection timers back to the "never infected" sentinel.
        expect(player.bodyDamage.main.infectionTime).toBe(-1);
        expect(player.bodyDamage.main.infectionMortalityDuration).toBe(-1);
        // coldDamageStage >= 1 calls setHealth(0) outright on the next update.
        expect(player.bodyDamage.main.coldDamageStage).toBe(0);
        expect(player.bodyDamage.main.hasACold).toBe(false);

        expect(player.stats.Pain).toBe(0);
        expect(player.stats.ZombieInfection).toBe(0);
        expect(player.stats.ZombieFever).toBe(0);
        expect(player.stats.Poison).toBe(0);
        expect(player.stats.FoodSickness).toBe(0);
        expect(player.stats.Sickness).toBe(0);
        expect(player.stats.Panic).toBe(0);

        // Survival needs that kill at moodle level 4.
        expect(player.stats.Hunger).toBe(0);
        expect(player.stats.Thirst).toBe(0);
        expect(player.stats.Fatigue).toBe(0);
        expect(player.stats.Endurance).toBe(1);

        expect(player.onFire).toBe(false);
        expect(player.flags.deathDragDown).toBe(false);
        expect(player.nutrition.weight).toBeGreaterThanOrEqual(35);

        if (player.bodyDamage.thermoregulator) {
            expect(player.bodyDamage.thermoregulator.thermalDamage).toBe(0);
        }

        expect(countInjuries(player)).toBe(0);
    });

    it('preserves identity, progression, inventory and appearance', async () => {
        const { record, player } = await loadPlayer(DEAD_USERNAME);
        const original = parsePlayerBlob(record.data, record.worldVersion);

        const beforeItemBytes = original.inventory.groups.map((g) => Array.from(g.item.body).join(','));

        revivePlayer(player);

        expect(player.descriptor!.forename).toBe(original.descriptor!.forename);
        expect(player.descriptor!.surname).toBe(original.descriptor!.surname);
        expect(player.descriptor!.profession).toBe(original.descriptor!.profession);
        expect(player.descriptor!.female).toBe(original.descriptor!.female);
        expect(player.displayName).toBe(original.displayName);

        expect(player.hoursSurvived).toBe(original.hoursSurvived);
        expect(player.zombieKills).toBe(original.zombieKills);
        expect(player.survivorKills).toBe(original.survivorKills);

        expect(player.xp.totalXp).toBe(original.xp.totalXp);
        expect(player.xp.level).toBe(original.xp.level);
        expect(player.xp.xpMap).toEqual(original.xp.xpMap);
        expect(player.xp.perkLevels).toEqual(original.xp.perkLevels);
        expect(player.xp.traits).toEqual(original.xp.traits);

        expect(player.movingObject.x).toBe(original.movingObject.x);
        expect(player.movingObject.y).toBe(original.movingObject.y);
        expect(player.movingObject.z).toBe(original.movingObject.z);

        expect(player.visual).toEqual(original.visual);
        expect(player.wornItems).toEqual(original.wornItems);
        expect(player.primaryHandIndex).toBe(original.primaryHandIndex);
        expect(player.secondaryHandIndex).toBe(original.secondaryHandIndex);

        expect(countItems(player.inventory)).toBe(countItems(original.inventory));
        expect(player.inventory.groups.map((g) => Array.from(g.item.body).join(','))).toEqual(
            beforeItemBytes,
        );

        expect(player.knownRecipes).toEqual(original.knownRecipes);
        expect(player.readBooks).toEqual(original.readBooks);
        expect(player.movingObject.modData).toEqual(original.movingObject.modData);
    });

    it('produces a BLOB that re-parses to the same values', async () => {
        const { record, player } = await loadPlayer(DEAD_USERNAME);
        revivePlayer(player);

        const blob = serializePlayerBlob(player);
        const reparsed = parsePlayerBlob(blob, record.worldVersion);

        expect(isDeadFromBlob(reparsed)).toBe(false);
        expect(calculateOverallHealth(reparsed.bodyDamage.parts)).toBe(100);
        expect(reparsed.trailingBytes.length).toBe(0);

        // A second round-trip of the modified BLOB must be byte-stable.
        expect(firstDifference(blob, serializePlayerBlob(reparsed))).toBe(-1);
    });

    it('changes only the bytes it needs to', async () => {
        const { record, player } = await loadPlayer(DEAD_USERNAME);
        revivePlayer(player);
        const blob = serializePlayerBlob(player);

        const bytes = diffBytes(record.data, blob);
        expect(bytes.identical).toBe(false);
        // Body-part and stat fields are all fixed width, so the BLOB length must
        // not change; anything else means an unintended structural edit.
        expect(bytes.afterLength).toBe(bytes.beforeLength);
        expect(bytes.changedBytes).toBeGreaterThan(0);
        expect(bytes.changedBytes).toBeLessThan(record.data.length / 2);
    });

    it('reports semantic changes', async () => {
        const { record, player } = await loadPlayer(DEAD_USERNAME);
        const original = parsePlayerBlob(record.data, record.worldVersion);
        revivePlayer(player);

        const changes = diffPlayers(original, player);
        const paths = changes.map((c) => c.path);

        expect(paths).toContain('overallBodyHealth');
        expect(paths.some((p) => p.endsWith('.health'))).toBe(true);

        const overall = changes.find((c) => c.path === 'overallBodyHealth')!;
        expect(overall.before).toBe(0);
        expect(overall.after).toBe(100);
    });
});

describe('restoreFullHealth', () => {
    it('heals injuries on a living character', async () => {
        const { player } = await loadPlayer('Gen. Waste');

        expect(countInjuries(player)).toBeGreaterThan(0);
        restoreFullHealth(player);

        expect(countInjuries(player)).toBe(0);
        expect(calculateOverallHealth(player.bodyDamage.parts)).toBe(100);
    });

    it('leaves survival needs alone, unlike revive', async () => {
        const { record } = await loadPlayer('Gen. Waste');

        const restored = parsePlayerBlob(record.data, record.worldVersion);
        const original = parsePlayerBlob(record.data, record.worldVersion);
        restoreFullHealth(restored);

        expect(restored.stats.Hunger).toBe(original.stats.Hunger);
        expect(restored.stats.Thirst).toBe(original.stats.Thirst);
        expect(restored.stats.Fatigue).toBe(original.stats.Fatigue);

        const revived = parsePlayerBlob(record.data, record.worldVersion);
        revivePlayer(revived);
        expect(revived.stats.Hunger).toBe(0);
        expect(revived.stats.Thirst).toBe(0);
    });

    it('is idempotent and stable across serialization', async () => {
        const { record } = await loadPlayer('盲獣mōjū');

        const once = parsePlayerBlob(record.data, record.worldVersion);
        restoreFullHealth(once);
        const blobOnce = serializePlayerBlob(once);

        const twice = parsePlayerBlob(blobOnce, record.worldVersion);
        const secondResult = restoreFullHealth(twice);
        expect(secondResult.changes).toHaveLength(0);
        expect(firstDifference(blobOnce, serializePlayerBlob(twice))).toBe(-1);
    });
});
