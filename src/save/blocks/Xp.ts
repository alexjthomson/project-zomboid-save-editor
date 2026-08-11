import type { BinaryReader } from '../BinaryReader';
import type { BinaryWriter } from '../BinaryWriter';

/**
 * `IsoGameCharacter.XP` (inner class) serialization, which also carries the
 * character's traits.
 *
 * Mirrors XP.save(ByteBuffer) / XP.load(ByteBuffer, int)
 * zombie/characters/IsoGameCharacter.java:18349 and :18299
 *
 *   this.chr.characterTraits.save(output);
 *   output.putFloat(this.totalXp);
 *   output.putInt(this.level);
 *   output.putInt(this.lastlevel);
 *   output.putInt(this.xpMap.size());        // perkId string + float xp
 *   output.putInt(perkList.size());          // perkId string + int level
 *   output.putInt(this.xpMapMultiplier.size()); // perkId string + float + byte + byte
 *
 * Perks are keyed by `perk.getId()` written with `GameWindow.WriteString`
 * (XP.savePerk, IsoGameCharacter.java:18288); a null perk is written as the
 * empty string and dropped on load (`PerkFactory.Perks.FromString` returning
 * `MAX`).
 */

/** `CharacterTraits.save/load` — zombie/characters/traits/CharacterTraits.java:100 and :90 */
export interface CharacterTraitsData {
    /**
     * Trait resource locations, e.g. `Base.Brave`. Written with
     * `Registries.CHARACTER_TRAIT.getLocation(trait).toString()`.
     */
    traits: string[];
}

export interface PerkXpEntry {
    perk: string;
    xp: number;
}

export interface PerkLevelEntry {
    perk: string;
    level: number;
}

export interface PerkMultiplierEntry {
    perk: string;
    multiplier: number;
    minLevel: number;
    maxLevel: number;
}

export interface XpData {
    traits: CharacterTraitsData;
    totalXp: number;
    level: number;
    lastLevel: number;
    xpMap: PerkXpEntry[];
    perkLevels: PerkLevelEntry[];
    xpMultipliers: PerkMultiplierEntry[];
}

export function readCharacterTraits(reader: BinaryReader): CharacterTraitsData {
    const count = reader.int32();
    const traits: string[] = [];
    for (let i = 0; i < count; i++) {
        traits.push(reader.string());
    }
    return { traits };
}

export function writeCharacterTraits(writer: BinaryWriter, data: CharacterTraitsData): void {
    writer.int32(data.traits.length);
    for (const trait of data.traits) {
        writer.string(trait);
    }
}

export function readXp(reader: BinaryReader): XpData {
    const traits = readCharacterTraits(reader);
    const totalXp = reader.float32();
    const level = reader.int32();
    const lastLevel = reader.int32();

    const xpMapSize = reader.int32();
    const xpMap: PerkXpEntry[] = [];
    for (let i = 0; i < xpMapSize; i++) {
        const perk = reader.string();
        const xp = reader.float32();
        xpMap.push({ perk, xp });
    }

    const perkListSize = reader.int32();
    const perkLevels: PerkLevelEntry[] = [];
    for (let i = 0; i < perkListSize; i++) {
        const perk = reader.string();
        const lvl = reader.int32();
        perkLevels.push({ perk, level: lvl });
    }

    const multiplierSize = reader.int32();
    const xpMultipliers: PerkMultiplierEntry[] = [];
    for (let i = 0; i < multiplierSize; i++) {
        const perk = reader.string();
        const multiplier = reader.float32();
        const minLevel = reader.int8();
        const maxLevel = reader.int8();
        xpMultipliers.push({ perk, multiplier, minLevel, maxLevel });
    }

    return { traits, totalXp, level, lastLevel, xpMap, perkLevels, xpMultipliers };
}

export function writeXp(writer: BinaryWriter, data: XpData): void {
    writeCharacterTraits(writer, data.traits);
    writer.float32(data.totalXp);
    writer.int32(data.level);
    writer.int32(data.lastLevel);

    writer.int32(data.xpMap.length);
    for (const entry of data.xpMap) {
        writer.string(entry.perk);
        writer.float32(entry.xp);
    }

    writer.int32(data.perkLevels.length);
    for (const entry of data.perkLevels) {
        writer.string(entry.perk);
        writer.int32(entry.level);
    }

    writer.int32(data.xpMultipliers.length);
    for (const entry of data.xpMultipliers) {
        writer.string(entry.perk);
        writer.float32(entry.multiplier);
        writer.int8(entry.minLevel);
        writer.int8(entry.maxLevel);
    }
}
