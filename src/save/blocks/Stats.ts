import type { BinaryReader } from '../BinaryReader';
import type { BinaryWriter } from '../BinaryWriter';

/**
 * `Stats` serialization.
 *
 * Mirrors Stats.save(ByteBuffer) / Stats.load(ByteBuffer, int)
 * zombie/characters/Stats.java
 *
 *   for (CharacterStat stat : CharacterStat.ORDERED_STATS) output.putFloat(this.get(stat));
 *
 * The layout is therefore just 24 consecutive float32s in the fixed order of
 * `CharacterStat.ORDERED_STATS` (zombie/characters/CharacterStat.java:41-66).
 * There is no count prefix and no names, so the order below is load bearing.
 */

export interface CharacterStatDef {
    /** The `id` passed to `CharacterStat.register`. */
    id: string;
    label: string;
    min: number;
    max: number;
    default: number;
}

/** zombie/characters/CharacterStat.java:12-35 (registration order == ORDERED_STATS order). */
export const ORDERED_STATS: readonly CharacterStatDef[] = [
    { id: 'Anger', label: 'Anger', min: 0, max: 1, default: 0 },
    { id: 'Boredom', label: 'Boredom', min: 0, max: 100, default: 0 },
    { id: 'Discomfort', label: 'Discomfort', min: 0, max: 100, default: 0 },
    { id: 'Endurance', label: 'Endurance', min: 0, max: 1, default: 1 },
    { id: 'Fatigue', label: 'Fatigue', min: 0, max: 1, default: 0 },
    { id: 'Fitness', label: 'Fitness', min: -1, max: 1, default: 0 },
    { id: 'FoodSickness', label: 'Food Sickness', min: 0, max: 100, default: 0 },
    { id: 'Hunger', label: 'Hunger', min: 0, max: 1, default: 0 },
    { id: 'Idleness', label: 'Idleness', min: 0, max: 1, default: 0 },
    { id: 'Intoxication', label: 'Intoxication (drunk)', min: 0, max: 100, default: 0 },
    { id: 'Morale', label: 'Morale', min: 0, max: 1, default: 1 },
    { id: 'NicotineWithdrawal', label: 'Nicotine Withdrawal', min: 0, max: 0.51, default: 0 },
    { id: 'Pain', label: 'Pain', min: 0, max: 100, default: 0 },
    { id: 'Panic', label: 'Panic', min: 0, max: 100, default: 0 },
    { id: 'Poison', label: 'Poison', min: 0, max: 100, default: 0 },
    { id: 'Sanity', label: 'Sanity', min: 0, max: 1, default: 1 },
    { id: 'Sickness', label: 'Sickness', min: 0, max: 1, default: 0 },
    { id: 'Stress', label: 'Stress', min: 0, max: 1, default: 0 },
    { id: 'Temperature', label: 'Body Temperature', min: 20, max: 40, default: 37 },
    { id: 'Thirst', label: 'Thirst', min: 0, max: 1, default: 0 },
    { id: 'Unhappiness', label: 'Unhappiness', min: 0, max: 100, default: 0 },
    { id: 'Wetness', label: 'Wetness', min: 0, max: 100, default: 0 },
    { id: 'ZombieFever', label: 'Zombie Fever', min: 0, max: 100, default: 0 },
    { id: 'ZombieInfection', label: 'Zombie Infection', min: 0, max: 100, default: 0 },
] as const;

export type StatsData = Record<string, number>;

export function readStats(reader: BinaryReader): StatsData {
    const stats: StatsData = {};
    for (const stat of ORDERED_STATS) {
        stats[stat.id] = reader.float32();
    }
    return stats;
}

export function writeStats(writer: BinaryWriter, stats: StatsData): void {
    for (const stat of ORDERED_STATS) {
        writer.float32(stats[stat.id] ?? stat.default);
    }
}
