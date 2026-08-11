import type { PlayerBlob } from '../PlayerBlobCodec';
import type { FieldChange } from './health';
import { BODY_PART_LABELS, calculateOverallHealth } from '../blocks/BodyDamage';
import { ORDERED_STATS } from '../blocks/Stats';

/**
 * Diffing utilities used by the modification-tracking UI.
 *
 * Two independent views are produced:
 *  - a semantic diff over the parsed model (what the user actually changed)
 *  - a byte diff between the original and re-serialized BLOB (proof of what
 *    landed in the file)
 */

export interface ByteRunDiff {
    offset: number;
    length: number;
    before: Uint8Array;
    after: Uint8Array;
}

export interface ByteDiffResult {
    identical: boolean;
    beforeLength: number;
    afterLength: number;
    runs: ByteRunDiff[];
    /** Total number of differing bytes within the overlapping region. */
    changedBytes: number;
    /** True when `runs` was capped by `maxRuns`. */
    truncated: boolean;
}

/**
 * Byte-level diff. Differing bytes that are close together are merged into a
 * single run so the UI shows meaningful blocks rather than thousands of
 * single-byte entries.
 */
export function diffBytes(
    before: Uint8Array,
    after: Uint8Array,
    options: { gap?: number; maxRuns?: number } = {},
): ByteDiffResult {
    const gap = options.gap ?? 8;
    const maxRuns = options.maxRuns ?? 512;

    const limit = Math.min(before.length, after.length);
    const runs: ByteRunDiff[] = [];
    let changedBytes = 0;
    let truncated = false;

    let runStart = -1;
    let lastDiff = -1;

    const flush = (end: number) => {
        if (runStart < 0) return;
        if (runs.length >= maxRuns) {
            truncated = true;
            runStart = -1;
            return;
        }
        runs.push({
            offset: runStart,
            length: end - runStart,
            before: before.slice(runStart, end),
            after: after.slice(runStart, end),
        });
        runStart = -1;
    };

    for (let i = 0; i < limit; i++) {
        if (before[i] !== after[i]) {
            changedBytes++;
            if (runStart < 0) {
                runStart = i;
            } else if (i - lastDiff > gap) {
                flush(lastDiff + 1);
                runStart = i;
            }
            lastDiff = i;
        }
    }
    flush(lastDiff + 1);

    if (before.length !== after.length && runs.length < maxRuns) {
        const start = limit;
        runs.push({
            offset: start,
            length: Math.max(before.length, after.length) - start,
            before: before.slice(start),
            after: after.slice(start),
        });
    }

    return {
        identical: before.length === after.length && changedBytes === 0,
        beforeLength: before.length,
        afterLength: after.length,
        runs,
        changedBytes,
        truncated,
    };
}

function pushIfChanged(
    changes: FieldChange[],
    path: string,
    label: string,
    before: unknown,
    after: unknown,
): void {
    if (before === after) return;
    if (typeof before === 'number' && typeof after === 'number' && Number.isNaN(before) && Number.isNaN(after)) {
        return;
    }
    changes.push({ path, label, before, after });
}

/**
 * Semantic diff over the fields this editor understands. Deliberately does not
 * walk the entire model: inventory item bodies and visuals are compared only by
 * a coarse summary, because a byte-identical raw slice is the useful signal
 * there.
 */
export function diffPlayers(before: PlayerBlob, after: PlayerBlob): FieldChange[] {
    const changes: FieldChange[] = [];

    /* Position. */
    pushIfChanged(changes, 'x', 'X', before.movingObject.x, after.movingObject.x);
    pushIfChanged(changes, 'y', 'Y', before.movingObject.y, after.movingObject.y);
    pushIfChanged(changes, 'z', 'Z', before.movingObject.z, after.movingObject.z);
    pushIfChanged(
        changes,
        'direction',
        'Facing direction',
        before.movingObject.direction,
        after.movingObject.direction,
    );

    /* Identity. */
    if (before.descriptor && after.descriptor) {
        pushIfChanged(changes, 'descriptor.forename', 'Forename', before.descriptor.forename, after.descriptor.forename);
        pushIfChanged(changes, 'descriptor.surname', 'Surname', before.descriptor.surname, after.descriptor.surname);
        pushIfChanged(changes, 'descriptor.female', 'Gender', before.descriptor.female, after.descriptor.female);
        pushIfChanged(
            changes,
            'descriptor.profession',
            'Profession',
            before.descriptor.profession,
            after.descriptor.profession,
        );
    }
    pushIfChanged(changes, 'displayName', 'Display name', before.displayName, after.displayName);

    /* Derived overall health, shown first because it is the value that decides
       whether the character is alive. */
    pushIfChanged(
        changes,
        'overallBodyHealth',
        'Overall health',
        calculateOverallHealth(before.bodyDamage.parts),
        calculateOverallHealth(after.bodyDamage.parts),
    );

    /* Body parts. */
    for (let i = 0; i < before.bodyDamage.parts.length && i < after.bodyDamage.parts.length; i++) {
        const a = before.bodyDamage.parts[i];
        const b = after.bodyDamage.parts[i];
        const label = BODY_PART_LABELS[a.type];
        for (const key of Object.keys(a) as Array<keyof typeof a>) {
            if (key === 'type') continue;
            pushIfChanged(
                changes,
                `bodyDamage.parts.${a.type}.${key}`,
                `${label} ${String(key)}`,
                a[key],
                b[key],
            );
        }
    }

    /* BodyDamage main fields. */
    for (const key of Object.keys(before.bodyDamage.main) as Array<keyof typeof before.bodyDamage.main>) {
        pushIfChanged(
            changes,
            `bodyDamage.${key}`,
            String(key),
            before.bodyDamage.main[key],
            after.bodyDamage.main[key],
        );
    }

    /* Stats. */
    for (const stat of ORDERED_STATS) {
        pushIfChanged(changes, `stats.${stat.id}`, stat.label, before.stats[stat.id], after.stats[stat.id]);
    }

    /* Character-level flags and misc. */
    pushIfChanged(changes, 'onFire', 'On fire', before.onFire, after.onFire);
    pushIfChanged(changes, 'asleep', 'Asleep', before.asleep, after.asleep);
    pushIfChanged(changes, 'hoursSurvived', 'Hours survived', before.hoursSurvived, after.hoursSurvived);
    pushIfChanged(changes, 'zombieKills', 'Zombie kills', before.zombieKills, after.zombieKills);
    pushIfChanged(changes, 'survivorKills', 'Survivor kills', before.survivorKills, after.survivorKills);
    pushIfChanged(changes, 'extraInfoFlags', 'Extra info flags', before.extraInfoFlags, after.extraInfoFlags);

    for (const key of Object.keys(before.flags) as Array<keyof typeof before.flags>) {
        pushIfChanged(changes, `flags.${key}`, String(key), before.flags[key], after.flags[key]);
    }

    /* Nutrition. */
    for (const key of Object.keys(before.nutrition) as Array<keyof typeof before.nutrition>) {
        pushIfChanged(changes, `nutrition.${key}`, String(key), before.nutrition[key], after.nutrition[key]);
    }

    /* XP and skills. */
    const beforeXp = new Map(before.xp.xpMap.map((p) => [p.perk, p]));
    for (const perk of after.xp.xpMap) {
        const prev = beforeXp.get(perk.perk);
        if (!prev) {
            changes.push({ path: `xp.${perk.perk}`, label: `${perk.perk} XP`, before: undefined, after: perk.xp });
            continue;
        }
        pushIfChanged(changes, `xp.${perk.perk}`, `${perk.perk} XP`, prev.xp, perk.xp);
    }
    const beforeLevels = new Map(before.xp.perkLevels.map((p) => [p.perk, p.level]));
    for (const perk of after.xp.perkLevels) {
        pushIfChanged(
            changes,
            `perks.${perk.perk}`,
            `${perk.perk} level`,
            beforeLevels.get(perk.perk),
            perk.level,
        );
    }

    /* Traits — reported as a set difference rather than per index. */
    const beforeTraits = new Set(before.xp.traits.traits);
    const afterTraits = new Set(after.xp.traits.traits);
    for (const trait of afterTraits) {
        if (!beforeTraits.has(trait)) {
            changes.push({ path: `traits.${trait}`, label: `Trait ${trait}`, before: false, after: true });
        }
    }
    for (const trait of beforeTraits) {
        if (!afterTraits.has(trait)) {
            changes.push({ path: `traits.${trait}`, label: `Trait ${trait}`, before: true, after: false });
        }
    }

    return changes;
}

/** Formats a value the way the change list should display it. */
export function formatChangeValue(value: unknown): string {
    if (value === null) return 'none';
    if (value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (Number.isInteger(value)) return String(value);
        return value.toFixed(3).replace(/\.?0+$/, '');
    }
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value === '' ? '(empty)' : value;
    return String(value);
}
