import type { BinaryReader } from '../BinaryReader';
import type { BinaryWriter } from '../BinaryWriter';

/**
 * Small self-contained blocks of the player BLOB that are shared between
 * `IsoGameCharacter` and `IsoPlayer`.
 */

/* ------------------------------------------------------------------------- */
/* Nutrition                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Mirrors Nutrition.save(ByteBuffer) / Nutrition.load(ByteBuffer)
 * zombie/characters/BodyDamage/Nutrition.java
 *
 * Note `save` writes `(float)getWeight()` even though `weight` is a double
 * internally, so it round-trips as a float32.
 */
export interface NutritionData {
    calories: number;
    proteins: number;
    lipids: number;
    carbohydrates: number;
    weight: number;
}

export function readNutrition(reader: BinaryReader): NutritionData {
    return {
        calories: reader.float32(),
        proteins: reader.float32(),
        lipids: reader.float32(),
        carbohydrates: reader.float32(),
        weight: reader.float32(),
    };
}

export function writeNutrition(writer: BinaryWriter, data: NutritionData): void {
    writer.float32(data.calories);
    writer.float32(data.proteins);
    writer.float32(data.lipids);
    writer.float32(data.carbohydrates);
    writer.float32(data.weight);
}

/* ------------------------------------------------------------------------- */
/* Fitness                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Mirrors Fitness.save(ByteBuffer) / Fitness.load(ByteBuffer, int)
 * zombie/characters/BodyDamage/Fitness.java
 *
 * Five consecutive int32-counted maps/lists, all keyed by strings.
 */
export interface FitnessData {
    stiffnessInc: Array<{ key: string; value: number }>;
    stiffnessTimer: Array<{ key: string; value: number }>;
    regularity: Array<{ key: string; value: number }>;
    bodypartToIncStiffness: string[];
    exeTimer: Array<{ key: string; value: bigint }>;
}

export function readFitness(reader: BinaryReader): FitnessData {
    const stiffnessInc: Array<{ key: string; value: number }> = [];
    let size = reader.int32();
    for (let i = 0; i < size; i++) {
        stiffnessInc.push({ key: reader.string(), value: reader.float32() });
    }

    const stiffnessTimer: Array<{ key: string; value: number }> = [];
    size = reader.int32();
    for (let i = 0; i < size; i++) {
        stiffnessTimer.push({ key: reader.string(), value: reader.int32() });
    }

    const regularity: Array<{ key: string; value: number }> = [];
    size = reader.int32();
    for (let i = 0; i < size; i++) {
        regularity.push({ key: reader.string(), value: reader.float32() });
    }

    const bodypartToIncStiffness: string[] = [];
    size = reader.int32();
    for (let i = 0; i < size; i++) {
        bodypartToIncStiffness.push(reader.string());
    }

    const exeTimer: Array<{ key: string; value: bigint }> = [];
    size = reader.int32();
    for (let i = 0; i < size; i++) {
        exeTimer.push({ key: reader.string(), value: reader.int64() });
    }

    return { stiffnessInc, stiffnessTimer, regularity, bodypartToIncStiffness, exeTimer };
}

export function writeFitness(writer: BinaryWriter, data: FitnessData): void {
    writer.int32(data.stiffnessInc.length);
    for (const e of data.stiffnessInc) {
        writer.string(e.key);
        writer.float32(e.value);
    }

    writer.int32(data.stiffnessTimer.length);
    for (const e of data.stiffnessTimer) {
        writer.string(e.key);
        writer.int32(e.value);
    }

    writer.int32(data.regularity.length);
    for (const e of data.regularity) {
        writer.string(e.key);
        writer.float32(e.value);
    }

    writer.int32(data.bodypartToIncStiffness.length);
    for (const e of data.bodypartToIncStiffness) {
        writer.string(e);
    }

    writer.int32(data.exeTimer.length);
    for (const e of data.exeTimer) {
        writer.string(e.key);
        writer.int64(e.value);
    }
}

/* ------------------------------------------------------------------------- */
/* PlayerCraftHistory                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Mirrors PlayerCraftHistory.save(ByteBuffer) / load(ByteBuffer)
 * zombie/characters/PlayerCraftHistory.java
 *
 * WARNING: unlike every other string in the player BLOB, the craft-history key
 * is NOT a `GameWindow` UTF-8 string. It is written as an int32 char count
 * followed by that many raw UTF-16 code units via `ByteBuffer.putChar`.
 */
export interface CraftHistoryEntry {
    key: string;
    craftCount: number;
    lastCraftTime: number;
}

export type CraftHistoryData = CraftHistoryEntry[];

export function readCraftHistory(reader: BinaryReader): CraftHistoryData {
    const count = reader.int32();
    const entries: CraftHistoryData = [];
    for (let i = 0; i < count; i++) {
        const keyCharCount = reader.int32();
        const key = reader.utf16String(keyCharCount);
        const craftCount = reader.int32();
        const lastCraftTime = reader.float64();
        entries.push({ key, craftCount, lastCraftTime });
    }
    return entries;
}

export function writeCraftHistory(writer: BinaryWriter, data: CraftHistoryData): void {
    writer.int32(data.length);
    for (const entry of data) {
        writer.int32(entry.key.length);
        writer.utf16String(entry.key);
        writer.int32(entry.craftCount);
        writer.float64(entry.lastCraftTime);
    }
}

/* ------------------------------------------------------------------------- */
/* PlayerCheats                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Mirrors PlayerCheats.save(ByteBuffer, boolean) / load(ByteBuffer, int, boolean)
 * zombie/characters/PlayerCheats.java
 *
 *   output.putInt(cheats.size());
 *   for each: output.put((byte)cheat.ordinal());
 */
export interface PlayerCheatsData {
    cheats: number[];
}

export function readPlayerCheats(reader: BinaryReader): PlayerCheatsData {
    const size = reader.int32();
    const cheats: number[] = [];
    for (let i = 0; i < size; i++) {
        cheats.push(reader.int8());
    }
    return { cheats };
}

export function writePlayerCheats(writer: BinaryWriter, data: PlayerCheatsData): void {
    writer.int32(data.cheats.length);
    for (const cheat of data.cheats) {
        writer.int8(cheat);
    }
}
