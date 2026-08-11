import type { BinaryReader } from '../BinaryReader';
import type { BinaryWriter } from '../BinaryWriter';

/**
 * `SurvivorDesc` serialization — the character's identity block.
 *
 * Mirrors SurvivorDesc.save(ByteBuffer) / SurvivorDesc.load(ByteBuffer, int, IsoGameCharacter)
 * zombie/characters/SurvivorDesc.java:304 and :258
 *
 * Called from `IsoGameCharacter.save/load` behind a one byte "descriptor
 * present" flag (IsoGameCharacter.java:6028 / :5888).
 */

/** Gate for the voice fields — `SurvivorDesc.load` reads them only for >= 208. */
export const SURVIVOR_DESC_VOICE_VERSION = 208;

export interface XpBoostEntry {
    perk: string;
    level: number;
}

export interface SurvivorDescData {
    id: number;
    forename: string;
    surname: string;
    /** Torso model name, default "Base_Torso". */
    torso: string;
    /** int32: 1 == FEMALE, anything else == MALE. */
    female: boolean;
    /** `ResourceLocation` string, e.g. "base:unemployed". Must never be empty. */
    profession: string;
    /**
     * `extra` is written as an int32 flag (1 when non-empty) followed by an
     * int32 count and that many strings. The flag/count pair is preserved
     * verbatim so an empty list still writes a single 0 int32.
     */
    extra: string[];
    xpBoosts: XpBoostEntry[];
    /** worldVersion >= 208 */
    voicePrefix: string | null;
    voicePitch: number | null;
    voiceType: number | null;
}

export function readSurvivorDesc(reader: BinaryReader, worldVersion: number): SurvivorDescData {
    const id = reader.int32();
    const forename = reader.string();
    const surname = reader.string();
    const torso = reader.string();
    const female = reader.int32() === 1;
    const profession = reader.string();

    const extra: string[] = [];
    if (reader.int32() === 1) {
        const size = reader.int32();
        for (let i = 0; i < size; i++) {
            extra.push(reader.string());
        }
    }

    const boostCount = reader.int32();
    const xpBoosts: XpBoostEntry[] = [];
    for (let i = 0; i < boostCount; i++) {
        const perk = reader.string();
        const level = reader.int32();
        xpBoosts.push({ perk, level });
    }

    let voicePrefix: string | null = null;
    let voicePitch: number | null = null;
    let voiceType: number | null = null;
    if (worldVersion >= SURVIVOR_DESC_VOICE_VERSION) {
        voicePrefix = reader.string();
        voicePitch = reader.float32();
        voiceType = reader.int32();
    }

    return {
        id,
        forename,
        surname,
        torso,
        female,
        profession,
        extra,
        xpBoosts,
        voicePrefix,
        voicePitch,
        voiceType,
    };
}

export function writeSurvivorDesc(
    writer: BinaryWriter,
    data: SurvivorDescData,
    worldVersion: number,
): void {
    writer.int32(data.id);
    writer.string(data.forename);
    writer.string(data.surname);
    writer.string(data.torso);
    writer.int32(data.female ? 1 : 0);
    writer.string(data.profession);

    if (data.extra.length > 0) {
        writer.int32(1);
        writer.int32(data.extra.length);
        for (const value of data.extra) {
            writer.string(value);
        }
    } else {
        writer.int32(0);
    }

    writer.int32(data.xpBoosts.length);
    for (const boost of data.xpBoosts) {
        writer.string(boost.perk);
        writer.int32(boost.level);
    }

    // `save` writes these unconditionally, but a stream produced for an older
    // version would not contain them, so mirror the load gate for symmetry.
    if (worldVersion >= SURVIVOR_DESC_VOICE_VERSION) {
        writer.string(data.voicePrefix ?? '');
        writer.float32(data.voicePitch ?? 0);
        writer.int32(data.voiceType ?? 0);
    }
}
