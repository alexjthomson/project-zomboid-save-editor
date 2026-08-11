import type { BinaryReader } from '../BinaryReader';
import type { BinaryWriter } from '../BinaryWriter';

/**
 * `HumanVisual` and `ItemVisual` serialization — the character's appearance.
 *
 * Mirrors HumanVisual.save(ByteBuffer) / HumanVisual.load(ByteBuffer, int)
 * zombie/core/skinnedmodel/visual/HumanVisual.java:393 and :503
 *
 * and ItemVisual.save(ByteBuffer) / ItemVisual.load(ByteBuffer, int)
 * zombie/core/skinnedmodel/visual/ItemVisual.java:293 and :402
 *
 * NOTE: `HumanVisual.bodyVisuals` is declared as `ItemVisuals` (which has its
 * own int16-counted codec) but `HumanVisual` deliberately does NOT use it — it
 * writes an int8 count and loops manually. Do not substitute one for the other.
 */

/** RGB triple; alpha is never serialized (ImmutableColor's 3-arg ctor forces 1.0). */
export interface RgbColor {
    r: number;
    g: number;
    b: number;
}

/* HumanVisual flags1 bits — HumanVisual.java:394-416 */
const HV_BEARD_COLOR = 0x02;
const HV_HAIR_COLOR = 0x04;
const HV_SKIN_COLOR = 0x08;
const HV_BEARD_MODEL = 0x10;
const HV_HAIR_MODEL = 0x20;
const HV_SKIN_TEXTURE_NAME = 0x40;

/* HumanVisual flags2 bits — HumanVisual.java:479-486 */
const HV_NATURAL_BEARD_COLOR = 0x02;
const HV_NATURAL_HAIR_COLOR = 0x04;

/* ItemVisual flags1 bits — ItemVisual.java:294-314 */
const IV_TINT = 0x01;
const IV_BASE_TEXTURE = 0x02;
const IV_TEXTURE_CHOICE = 0x04;
const IV_HUE = 0x08;
const IV_DECAL = 0x10;

export interface ItemVisualData {
    /**
     * Raw flag byte as it appeared in the file. Kept so unknown bits are
     * preserved; the presence flags below are derived from it.
     */
    flags: number;
    fullType: string;
    alternateModelName: string;
    clothingItemName: string;
    tint: RgbColor | null;
    baseTexture: number | null;
    textureChoice: number | null;
    hue: number | null;
    decal: string | null;
    blood: number[];
    dirt: number[];
    holes: number[];
    basicPatches: number[];
    denimPatches: number[];
    leatherPatches: number[];
}

export interface HumanVisualData {
    flags1: number;
    hairColor: RgbColor | null;
    beardColor: RgbColor | null;
    skinColor: RgbColor | null;
    bodyHair: number;
    skinTexture: number;
    zombieRotStage: number;
    skinTextureName: string | null;
    beardModel: string | null;
    hairModel: string | null;
    /** One entry per `BloodBodyPartType` (18 in build 42). */
    blood: number[];
    dirt: number[];
    holes: number[];
    bodyVisuals: ItemVisualData[];
    nonAttachedHair: string;
    flags2: number;
    naturalHairColor: RgbColor | null;
    naturalBeardColor: RgbColor | null;
}

function readColor(reader: BinaryReader): RgbColor {
    return { r: reader.uint8(), g: reader.uint8(), b: reader.uint8() };
}

function writeColor(writer: BinaryWriter, color: RgbColor): void {
    writer.int8(color.r);
    writer.int8(color.g);
    writer.int8(color.b);
}

function readByteArray(reader: BinaryReader): number[] {
    const count = reader.int8();
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
        values.push(reader.int8());
    }
    return values;
}

function writeByteArray(writer: BinaryWriter, values: number[]): void {
    writer.int8(values.length);
    for (const value of values) {
        writer.int8(value);
    }
}

export function readItemVisual(reader: BinaryReader): ItemVisualData {
    const flags = reader.uint8();
    const fullType = reader.string();
    const alternateModelName = reader.string();
    const clothingItemName = reader.string();
    const tint = (flags & IV_TINT) !== 0 ? readColor(reader) : null;
    const baseTexture = (flags & IV_BASE_TEXTURE) !== 0 ? reader.int8() : null;
    const textureChoice = (flags & IV_TEXTURE_CHOICE) !== 0 ? reader.int8() : null;
    const hue = (flags & IV_HUE) !== 0 ? reader.float32() : null;
    const decal = (flags & IV_DECAL) !== 0 ? reader.string() : null;
    return {
        flags,
        fullType,
        alternateModelName,
        clothingItemName,
        tint,
        baseTexture,
        textureChoice,
        hue,
        decal,
        blood: readByteArray(reader),
        dirt: readByteArray(reader),
        holes: readByteArray(reader),
        basicPatches: readByteArray(reader),
        denimPatches: readByteArray(reader),
        leatherPatches: readByteArray(reader),
    };
}

export function writeItemVisual(writer: BinaryWriter, data: ItemVisualData): void {
    writer.int8(data.flags);
    writer.string(data.fullType);
    writer.string(data.alternateModelName);
    writer.string(data.clothingItemName);
    if ((data.flags & IV_TINT) !== 0 && data.tint) {
        writeColor(writer, data.tint);
    }
    if ((data.flags & IV_BASE_TEXTURE) !== 0) {
        writer.int8(data.baseTexture ?? 0);
    }
    if ((data.flags & IV_TEXTURE_CHOICE) !== 0) {
        writer.int8(data.textureChoice ?? 0);
    }
    if ((data.flags & IV_HUE) !== 0) {
        writer.float32(data.hue ?? 0);
    }
    if ((data.flags & IV_DECAL) !== 0) {
        writer.string(data.decal ?? '');
    }
    writeByteArray(writer, data.blood);
    writeByteArray(writer, data.dirt);
    writeByteArray(writer, data.holes);
    writeByteArray(writer, data.basicPatches);
    writeByteArray(writer, data.denimPatches);
    writeByteArray(writer, data.leatherPatches);
}

export function readHumanVisual(reader: BinaryReader): HumanVisualData {
    const flags1 = reader.uint8();
    // Read order differs from the flag-building order: hair, beard, skin.
    const hairColor = (flags1 & HV_HAIR_COLOR) !== 0 ? readColor(reader) : null;
    const beardColor = (flags1 & HV_BEARD_COLOR) !== 0 ? readColor(reader) : null;
    const skinColor = (flags1 & HV_SKIN_COLOR) !== 0 ? readColor(reader) : null;

    const bodyHair = reader.int8();
    const skinTexture = reader.int8();
    const zombieRotStage = reader.int8();

    const skinTextureName = (flags1 & HV_SKIN_TEXTURE_NAME) !== 0 ? reader.string() : null;
    const beardModel = (flags1 & HV_BEARD_MODEL) !== 0 ? reader.string() : null;
    const hairModel = (flags1 & HV_HAIR_MODEL) !== 0 ? reader.string() : null;

    const blood = readByteArray(reader);
    const dirt = readByteArray(reader);
    const holes = readByteArray(reader);

    const visualCount = reader.int8();
    const bodyVisuals: ItemVisualData[] = [];
    for (let i = 0; i < visualCount; i++) {
        bodyVisuals.push(readItemVisual(reader));
    }

    const nonAttachedHair = reader.string();
    const flags2 = reader.uint8();
    const naturalHairColor = (flags2 & HV_NATURAL_HAIR_COLOR) !== 0 ? readColor(reader) : null;
    const naturalBeardColor = (flags2 & HV_NATURAL_BEARD_COLOR) !== 0 ? readColor(reader) : null;

    return {
        flags1,
        hairColor,
        beardColor,
        skinColor,
        bodyHair,
        skinTexture,
        zombieRotStage,
        skinTextureName,
        beardModel,
        hairModel,
        blood,
        dirt,
        holes,
        bodyVisuals,
        nonAttachedHair,
        flags2,
        naturalHairColor,
        naturalBeardColor,
    };
}

export function writeHumanVisual(writer: BinaryWriter, data: HumanVisualData): void {
    writer.int8(data.flags1);
    if ((data.flags1 & HV_HAIR_COLOR) !== 0 && data.hairColor) {
        writeColor(writer, data.hairColor);
    }
    if ((data.flags1 & HV_BEARD_COLOR) !== 0 && data.beardColor) {
        writeColor(writer, data.beardColor);
    }
    if ((data.flags1 & HV_SKIN_COLOR) !== 0 && data.skinColor) {
        writeColor(writer, data.skinColor);
    }

    writer.int8(data.bodyHair);
    writer.int8(data.skinTexture);
    writer.int8(data.zombieRotStage);

    if ((data.flags1 & HV_SKIN_TEXTURE_NAME) !== 0) {
        writer.string(data.skinTextureName ?? '');
    }
    if ((data.flags1 & HV_BEARD_MODEL) !== 0) {
        writer.string(data.beardModel ?? '');
    }
    if ((data.flags1 & HV_HAIR_MODEL) !== 0) {
        writer.string(data.hairModel ?? '');
    }

    writeByteArray(writer, data.blood);
    writeByteArray(writer, data.dirt);
    writeByteArray(writer, data.holes);

    writer.int8(data.bodyVisuals.length);
    for (const visual of data.bodyVisuals) {
        writeItemVisual(writer, visual);
    }

    writer.string(data.nonAttachedHair);
    writer.int8(data.flags2);
    if ((data.flags2 & HV_NATURAL_HAIR_COLOR) !== 0 && data.naturalHairColor) {
        writeColor(writer, data.naturalHairColor);
    }
    if ((data.flags2 & HV_NATURAL_BEARD_COLOR) !== 0 && data.naturalBeardColor) {
        writeColor(writer, data.naturalBeardColor);
    }
}
