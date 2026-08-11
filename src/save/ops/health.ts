import type { PlayerBlob } from '../PlayerBlobCodec';
import type { BodyPartData } from '../blocks/BodyDamage';
import { BODY_PART_LABELS, calculateOverallHealth } from '../blocks/BodyDamage';
import { ORDERED_STATS } from '../blocks/Stats';

/**
 * Health / death repair operations.
 *
 * Everything here is derived from the game's own death and damage logic rather
 * than guesswork. The relevant chain is:
 *
 *   IsoGameCharacter.isDead()            zombie/characters/IsoGameCharacter.java:5616
 *     return this.health <= 0 || this.bodyDamage.getHealth() <= 0;
 *
 * `IsoGameCharacter.health` is NOT serialized (it is a transient field that
 * defaults to 1.0F, IsoGameCharacter.java:542), and
 * `BodyDamage.overallBodyHealth` is NOT serialized either — it is recomputed at
 * the end of `BodyDamage.load` by `calculateOverallHealth()`
 * (BodyDamage.java:2458) from the individual body-part healths:
 *
 *   totalDamage = sum((100 - part.health) * BodyPartType.getDamageModifyer(i))
 *   overallBodyHealth = 100 - min(totalDamage, 100)
 *
 * So the only persistent thing that makes a character load as dead from the
 * BLOB is the set of 17 body-part health values. On top of that:
 *
 *   PlayerDB.loadPlayer        zombie/savefile/PlayerDB.java:244
 *   ServerPlayerDB.loadPlayer  zombie/savefile/ServerPlayerDB.java:279
 *     if (isDead) { player.getBodyDamage().setOverallBodyHealth(0); player.setHealth(0); }
 *
 * force the character dead straight after loading when the SQL `isDead` column
 * is set, regardless of the BLOB contents. Clearing that column is therefore
 * also required, and is handled by the caller via `PlayersDatabase.updatePlayer`.
 */

export interface FieldChange {
    /** Dotted path, e.g. `bodyDamage.parts.Torso_Upper.health`. */
    path: string;
    /** Human readable label for the UI. */
    label: string;
    before: unknown;
    after: unknown;
}

export interface OperationResult {
    changes: FieldChange[];
}

class ChangeRecorder {
    readonly changes: FieldChange[] = [];

    set<T extends object, K extends keyof T>(
        target: T,
        key: K,
        value: T[K],
        path: string,
        label: string,
    ): void {
        const before = target[key];
        if (before === value) return;
        // Float32 rounding means an exact === compare is right here: values are
        // read as float32 and written back as float32.
        target[key] = value;
        this.changes.push({ path, label, before, after: value });
    }
}

/** Body-part fields that represent an injury and are safe to clear. */
function healBodyPart(recorder: ChangeRecorder, part: BodyPartData): void {
    const label = BODY_PART_LABELS[part.type];
    const p = (field: string) => `bodyDamage.parts.${part.type}.${field}`;

    recorder.set(part, 'health', 100, p('health'), `${label} health`);

    /* Wounds — BodyPart.java field-by-field, all persisted by BodyDamage.save. */
    recorder.set(part, 'cut', false, p('cut'), `${label} cut`);
    recorder.set(part, 'cutTime', 0, p('cutTime'), `${label} cut time`);
    recorder.set(part, 'cutTime2', 0, p('cutTime2'), `${label} cut time`);
    recorder.set(part, 'bitten', false, p('bitten'), `${label} bitten`);
    recorder.set(part, 'biteTime', 0, p('biteTime'), `${label} bite time`);
    recorder.set(part, 'scratched', false, p('scratched'), `${label} scratched`);
    recorder.set(part, 'scratchTime', 0, p('scratchTime'), `${label} scratch time`);
    recorder.set(part, 'deepWounded', false, p('deepWounded'), `${label} deep wound`);
    recorder.set(part, 'deepWoundTime', 0, p('deepWoundTime'), `${label} deep wound time`);

    /* Bleeding — BodyPart.DamageUpdate applies ReduceGeneralHealth per tick
       (BodyPart.java:168) and drives the level 4 BLEEDING moodle damage
       (BodyDamage.java:2303). */
    recorder.set(part, 'bleeding', false, p('bleeding'), `${label} bleeding`);
    recorder.set(part, 'bleedingTime', 0, p('bleedingTime'), `${label} bleeding time`);

    /* Fractures, burns and lodged objects. */
    recorder.set(part, 'fractureTime', 0, p('fractureTime'), `${label} fracture`);
    recorder.set(part, 'burnTime', 0, p('burnTime'), `${label} burn`);
    recorder.set(part, 'needBurnWash', false, p('needBurnWash'), `${label} needs burn wash`);
    recorder.set(part, 'haveGlass', false, p('haveGlass'), `${label} lodged glass`);
    recorder.set(part, 'haveBullet', false, p('haveBullet'), `${label} lodged bullet`);

    /* Infection.
       `BodyDamage.isInfected` is NOT serialized; `BodyDamage.update()` re-derives
       it from any part's IsInfected(i) (BodyDamage.java:2166) and then applies
       110 damage under mortality mode 1, or a timed death otherwise
       (BodyDamage.java:2381/:2394). Clearing the per-part flags is what actually
       removes the zombie infection. */
    recorder.set(part, 'infected', false, p('infected'), `${label} zombie infection`);
    recorder.set(part, 'fakeInfected', false, p('fakeInfected'), `${label} suspected infection`);
    recorder.set(part, 'infectedWound', false, p('infectedWound'), `${label} wound infection`);
    recorder.set(part, 'woundInfectionLevel', null, p('woundInfectionLevel'), `${label} wound infection level`);

    /* Pain contributed by this part — BodyDamage.java:2360 sums these into the
       PAIN stat every tick, so leaving them set re-applies pain immediately. */
    recorder.set(part, 'additionalPain', 0, p('additionalPain'), `${label} additional pain`);
    recorder.set(part, 'stiffness', 0, p('stiffness'), `${label} stiffness`);

    /* Treatment state that only makes sense alongside a wound. Splints and
       stitches are cleared together with the injuries they were treating so the
       character does not load wearing a splint on an uninjured limb. */
    recorder.set(part, 'stitched', false, p('stitched'), `${label} stitched`);
    recorder.set(part, 'stitchTime', 0, p('stitchTime'), `${label} stitch time`);
    recorder.set(part, 'splint', false, p('splint'), `${label} splint`);
    recorder.set(part, 'splintFactor', null, p('splintFactor'), `${label} splint factor`);
    recorder.set(part, 'splintItem', '', p('splintItem'), `${label} splint item`);
    recorder.set(part, 'bandaged', false, p('bandaged'), `${label} bandaged`);
    recorder.set(part, 'bandageLife', null, p('bandageLife'), `${label} bandage life`);
    recorder.set(part, 'bandageType', '', p('bandageType'), `${label} bandage type`);
    recorder.set(part, 'getBandageXp', false, p('getBandageXp'), `${label} pending bandage XP`);
    recorder.set(part, 'getStitchXp', false, p('getStitchXp'), `${label} pending stitch XP`);
    recorder.set(part, 'getSplintXp', false, p('getSplintXp'), `${label} pending splint XP`);

    /* Topical treatments, meaningless once the part is healed. */
    recorder.set(part, 'alcoholLevel', 0, p('alcoholLevel'), `${label} disinfectant`);
    if (part.comfreyFactor !== null) {
        recorder.set(part, 'comfreyFactor', 0, p('comfreyFactor'), `${label} comfrey`);
    }
    if (part.garlicFactor !== null) {
        recorder.set(part, 'garlicFactor', 0, p('garlicFactor'), `${label} garlic`);
    }
    if (part.plantainFactor !== null) {
        recorder.set(part, 'plantainFactor', 0, p('plantainFactor'), `${label} plantain`);
    }
}

/** Stats that can damage or kill the character and are reset to their default. */
const HARMFUL_STATS: ReadonlyArray<{ id: string; reason: string }> = [
    { id: 'Pain', reason: 'recomputed from body parts each tick (BodyDamage.java:2360)' },
    { id: 'Panic', reason: 'panic moodle' },
    { id: 'Poison', reason: 'applies damage while the SICK moodle is set (BodyDamage.java:2264)' },
    { id: 'Sickness', reason: 'illness state' },
    { id: 'FoodSickness', reason: 'level 4 SICK moodle applies damage (BodyDamage.java:2290)' },
    { id: 'ZombieInfection', reason: 'infection progress; forced to max on death by infection' },
    { id: 'ZombieFever', reason: 'fake-infection progress (BodyDamage.java:2194)' },
    { id: 'Intoxication', reason: 'drunkenness' },
    { id: 'Stress', reason: 'stress' },
    { id: 'Wetness', reason: 'feeds the cold/hypothermia system' },
];

/**
 * Stats that will kill the character quickly when maxed. `Hunger`/`Thirst` at
 * moodle level 4 apply damage every tick (BodyDamage.java:2285/:2308), and
 * `Endurance`/`Fatigue` leave the character helpless on login.
 */
const SURVIVAL_STATS: ReadonlyArray<string> = ['Hunger', 'Thirst', 'Fatigue', 'Endurance'];

function statLabel(id: string): string {
    return ORDERED_STATS.find((s) => s.id === id)?.label ?? id;
}

function statDefault(id: string): number {
    return ORDERED_STATS.find((s) => s.id === id)?.default ?? 0;
}

interface HealOptions {
    /** Also reset hunger, thirst, fatigue and endurance. */
    resetSurvivalNeeds: boolean;
}

function healCommon(player: PlayerBlob, recorder: ChangeRecorder, options: HealOptions): void {
    for (const part of player.bodyDamage.parts) {
        healBodyPart(recorder, part);
    }

    const main = player.bodyDamage.main;

    /* Infection timers. -1 is the "not infected" sentinel; BodyDamage.update()
       only assigns real values once a part is infected (BodyDamage.java:2178). */
    recorder.set(main, 'infectionTime', -1, 'bodyDamage.infectionTime', 'Infection start time');
    recorder.set(
        main,
        'infectionMortalityDuration',
        -1,
        'bodyDamage.infectionMortalityDuration',
        'Infection mortality duration',
    );
    recorder.set(main, 'reduceFakeInfection', false, 'bodyDamage.reduceFakeInfection', 'Reducing fake infection');

    /* Cold / hypothermia. UpdateTemperatureState caps max health at
       100 - coldDamageStage * 100 and calls setHealth(0) outright once that cap
       reaches zero (BodyDamage.java:2538-2543), so a saved coldDamageStage >= 1
       kills the character the moment they load. */
    recorder.set(main, 'coldDamageStage', 0, 'bodyDamage.coldDamageStage', 'Cold damage stage');
    recorder.set(main, 'catchACold', 0, 'bodyDamage.catchACold', 'Catching a cold');
    recorder.set(main, 'hasACold', false, 'bodyDamage.hasACold', 'Has a cold');
    recorder.set(main, 'coldStrength', 0, 'bodyDamage.coldStrength', 'Cold strength');
    recorder.set(main, 'coldReduction', 0, 'bodyDamage.coldReduction', 'Cold reduction');
    if (main.timeToSneezeOrCough !== null) {
        recorder.set(main, 'timeToSneezeOrCough', -1, 'bodyDamage.timeToSneezeOrCough', 'Time to sneeze/cough');
    }
    recorder.set(main, 'painReduction', 0, 'bodyDamage.painReduction', 'Pain reduction');

    /* Thermoregulator accumulates hypothermia/hyperthermia damage that is
       re-applied on the next update. */
    if (player.bodyDamage.thermoregulator) {
        const thermo = player.bodyDamage.thermoregulator;
        recorder.set(thermo, 'thermalDamage', 0, 'bodyDamage.thermoregulator.thermalDamage', 'Thermal damage');
        recorder.set(thermo, 'damageCounter', 0, 'bodyDamage.thermoregulator.damageCounter', 'Thermal damage counter');
    }

    for (const stat of HARMFUL_STATS) {
        const value = statDefault(stat.id);
        if (player.stats[stat.id] !== value) {
            const before = player.stats[stat.id];
            player.stats[stat.id] = value;
            recorder.changes.push({
                path: `stats.${stat.id}`,
                label: statLabel(stat.id),
                before,
                after: value,
            });
        }
    }

    if (options.resetSurvivalNeeds) {
        for (const id of SURVIVAL_STATS) {
            const value = statDefault(id);
            if (player.stats[id] !== value) {
                const before = player.stats[id];
                player.stats[id] = value;
                recorder.changes.push({ path: `stats.${id}`, label: statLabel(id), before, after: value });
            }
        }
    }

    /* On fire — persisted by IsoGameCharacter.save and would immediately resume
       burning the character (IsoGameCharacter.java:6058). */
    recorder.set(player, 'onFire', false, 'onFire', 'On fire');

    /* Set while a zombie is dragging the character down in a death animation.
       Restoring a character with this still set puts them straight back into the
       fatal animation state (IsoGameCharacter.deathDragDown). */
    recorder.set(player.flags, 'deathDragDown', false, 'flags.deathDragDown', 'Death drag-down animation');

    /* Nutrition.setWeight applies LOWWEIGHT damage below 35 kg
       (Nutrition.java:340). Only raised when it is actually dangerous, so a
       deliberately light character keeps their weight. */
    if (player.nutrition.weight < 35) {
        const before = player.nutrition.weight;
        player.nutrition.weight = 35;
        recorder.changes.push({
            path: 'nutrition.weight',
            label: 'Weight (kg)',
            before,
            after: 35,
        });
    }
}

/**
 * Repairs every injury, debuff and infection without touching anything that is
 * only relevant to death. Safe to run on a living character.
 */
export function restoreFullHealth(player: PlayerBlob): OperationResult {
    const recorder = new ChangeRecorder();
    healCommon(player, recorder, { resetSurvivalNeeds: false });
    return { changes: recorder.changes };
}

/**
 * Full revival. Does everything `restoreFullHealth` does, and additionally
 * resets the survival stats that would kill or incapacitate a character the
 * moment they log back in.
 *
 * The caller must ALSO clear the SQL `isDead` column — see
 * `PlayersDatabase.updatePlayer`. Without that, PlayerDB/ServerPlayerDB force
 * health to 0 immediately after `load` and the character is dead again.
 */
export function revivePlayer(player: PlayerBlob): OperationResult {
    const recorder = new ChangeRecorder();
    healCommon(player, recorder, { resetSurvivalNeeds: true });

    /* Sleep state — a character forced asleep at the moment of death would wake
       up mid-animation. forceWakeUpTime is an hour-of-day value; -1 disables it
       (IsoGameCharacter.java:6032). */
    if (player.asleep) {
        recorder.set(player, 'asleep', false, 'asleep', 'Asleep');
    }

    return { changes: recorder.changes };
}

/**
 * True when the character would be considered dead by
 * `IsoGameCharacter.isDead()` purely from the contents of the BLOB.
 */
export function isDeadFromBlob(player: PlayerBlob): boolean {
    return calculateOverallHealth(player.bodyDamage.parts) <= 0;
}

/** Number of body parts that are damaged or wounded in some way. */
export function countInjuries(player: PlayerBlob): number {
    let count = 0;
    for (const part of player.bodyDamage.parts) {
        if (
            part.health < 100 ||
            part.cut ||
            part.bitten ||
            part.scratched ||
            part.bleeding ||
            part.deepWounded ||
            part.infected ||
            part.fakeInfected ||
            part.infectedWound ||
            part.fractureTime > 0 ||
            part.burnTime > 0 ||
            part.haveGlass ||
            part.haveBullet
        ) {
            count++;
        }
    }
    return count;
}
