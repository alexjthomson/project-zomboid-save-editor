import type { BinaryReader } from '../BinaryReader';
import type { BinaryWriter } from '../BinaryWriter';
import { VERSION_GATES } from '../SaveVersion';

/**
 * `BodyDamage` / `BodyPart` / `Thermoregulator` serialization.
 *
 * Mirrors BodyDamage.save(ByteBuffer) / BodyDamage.load(ByteBuffer, int)
 * zombie/characters/BodyDamage/BodyDamage.java:243 and :174
 */

/**
 * Body part order is fixed by the `BodyDamage` constructor, which always adds
 * exactly 17 parts in this order.
 * zombie/characters/BodyDamage/BodyDamage.java:126-142
 *
 * The enum `BodyPartType` additionally has a trailing `MAX` sentinel that is
 * never given a `BodyPart` instance.
 * zombie/characters/BodyDamage/BodyPartType.java:14-196
 */
export const BODY_PART_TYPES = [
    'Hand_L',
    'Hand_R',
    'ForeArm_L',
    'ForeArm_R',
    'UpperArm_L',
    'UpperArm_R',
    'Torso_Upper',
    'Torso_Lower',
    'Head',
    'Neck',
    'Groin',
    'UpperLeg_L',
    'UpperLeg_R',
    'LowerLeg_L',
    'LowerLeg_R',
    'Foot_L',
    'Foot_R',
] as const;

export type BodyPartType = (typeof BODY_PART_TYPES)[number];

/** Human readable labels, from the `IGUI_health_*` translation keys in BodyPartType. */
export const BODY_PART_LABELS: Record<BodyPartType, string> = {
    Hand_L: 'Left Hand',
    Hand_R: 'Right Hand',
    ForeArm_L: 'Left Forearm',
    ForeArm_R: 'Right Forearm',
    UpperArm_L: 'Left Upper Arm',
    UpperArm_R: 'Right Upper Arm',
    Torso_Upper: 'Upper Torso',
    Torso_Lower: 'Lower Torso',
    Head: 'Head',
    Neck: 'Neck',
    Groin: 'Groin',
    UpperLeg_L: 'Left Thigh',
    UpperLeg_R: 'Right Thigh',
    LowerLeg_L: 'Left Shin',
    LowerLeg_R: 'Right Shin',
    Foot_L: 'Left Foot',
    Foot_R: 'Right Foot',
};

/**
 * `BodyPartType.getDamageModifyer(index)` weights, used by
 * `BodyDamage.calculateOverallHealth()` to derive overall body health from the
 * individual part healths. This is the `damageModifier` constructor argument
 * (the second float) of each enum constant in
 * zombie/characters/BodyDamage/BodyPartType.java:14-196 and :214.
 */
export const BODY_PART_DAMAGE_MODIFIERS: Record<BodyPartType, number> = {
    Hand_L: 0.1,
    Hand_R: 0.1,
    ForeArm_L: 0.2,
    ForeArm_R: 0.2,
    UpperArm_L: 0.3,
    UpperArm_R: 0.3,
    Torso_Upper: 0.35,
    Torso_Lower: 0.4,
    Head: 0.6,
    Neck: 0.7,
    Groin: 0.4,
    UpperLeg_L: 0.3,
    UpperLeg_R: 0.3,
    LowerLeg_L: 0.2,
    LowerLeg_R: 0.2,
    Foot_L: 0.2,
    Foot_R: 0.2,
};

export interface BodyPartData {
    type: BodyPartType;
    /** `p.isCut()` */
    cut: boolean;
    /** `p.bitten()` — a bite is the primary zombie infection vector. */
    bitten: boolean;
    scratched: boolean;
    bandaged: boolean;
    bleeding: boolean;
    deepWounded: boolean;
    /** `p.IsFakeInfected()` — the "you might be infected" state under some sandbox settings. */
    fakeInfected: boolean;
    /** `p.IsInfected()` — genuine zombie infection on this part. */
    infected: boolean;
    /** 0..100 */
    health: number;
    /** Only present when `bandaged` is true. */
    bandageLife: number | null;
    /** Wound (non-zombie) infection. */
    infectedWound: boolean;
    /** Only present when `infectedWound` is true. */
    woundInfectionLevel: number | null;
    cutTime: number;
    biteTime: number;
    scratchTime: number;
    bleedingTime: number;
    alcoholLevel: number;
    additionalPain: number;
    deepWoundTime: number;
    /** Lodged glass. */
    haveGlass: boolean;
    getBandageXp: boolean;
    stitched: boolean;
    stitchTime: number;
    getStitchXp: boolean;
    getSplintXp: boolean;
    /** > 0 means the part is fractured. */
    fractureTime: number;
    splint: boolean;
    /** Only present when `splint` is true. */
    splintFactor: number | null;
    /** Lodged bullet. */
    haveBullet: boolean;
    burnTime: number;
    needBurnWash: boolean;
    lastTimeBurnWash: number;
    splintItem: string;
    bandageType: string;
    /**
     * `BodyDamage.save` writes `getCutTime()` a second time here and
     * `BodyDamage.load` assigns it back to `setCutTime`, so the second copy
     * overwrites the first on load. Both copies are kept so the BLOB can be
     * reproduced byte for byte.
     * zombie/characters/BodyDamage/BodyDamage.java:288 and :219
     */
    cutTime2: number;
    wetness: number;
    stiffness: number;
    /** worldVersion >= 227 on load; always written on save. */
    comfreyFactor: number | null;
    garlicFactor: number | null;
    plantainFactor: number | null;
}

export interface ThermalNodeData {
    bodyPartIndex: number;
    celcius: number;
    skinCelcius: number;
    heatDelta: number;
    primaryDelta: number;
    secondaryDelta: number;
    insulation: number | null;
    windresist: number | null;
    bodyWetness: number | null;
    clothingWetness: number | null;
}

export interface ThermoregulatorData {
    setPoint: number;
    metabolicRate: number;
    metabolicRateReal: number | null;
    metabolicTarget: number;
    bodyHeatDelta: number;
    coreHeatDelta: number;
    /** Accumulated hypothermia/hyperthermia damage. */
    thermalDamage: number;
    damageCounter: number;
    thermalDuration: number | null;
    nodes: ThermalNodeData[];
}

/** `BodyDamage.saveMainFields` / `loadMainFields` — BodyDamage.java:304 and :318 */
export interface BodyDamageMainFields {
    catchACold: number;
    hasACold: boolean;
    coldStrength: number;
    /** worldVersion >= 222 */
    timeToSneezeOrCough: number | null;
    reduceFakeInfection: boolean;
    healthFromFoodTimer: number;
    painReduction: number;
    coldReduction: number;
    /**
     * World-hours at which the zombie infection started; -1 means "not infected".
     * Set by `BodyDamage.update()` once any body part is infected.
     */
    infectionTime: number;
    /** Hours from `infectionTime` until death; -1 when unset. */
    infectionMortalityDuration: number;
    coldDamageStage: number;
}

export interface BodyDamageData {
    parts: BodyPartData[];
    main: BodyDamageMainFields;
    hasThermoregulator: boolean;
    thermoregulator: ThermoregulatorData | null;
}

export function readBodyDamage(reader: BinaryReader, worldVersion: number): BodyDamageData {
    const parts: BodyPartData[] = [];
    for (const type of BODY_PART_TYPES) {
        const cut = reader.bool();
        const bitten = reader.bool();
        const scratched = reader.bool();
        const bandaged = reader.bool();
        const bleeding = reader.bool();
        const deepWounded = reader.bool();
        const fakeInfected = reader.bool();
        const infected = reader.bool();
        const health = reader.float32();
        const bandageLife = bandaged ? reader.float32() : null;
        const infectedWound = reader.bool();
        const woundInfectionLevel = infectedWound ? reader.float32() : null;
        const cutTime = reader.float32();
        const biteTime = reader.float32();
        const scratchTime = reader.float32();
        const bleedingTime = reader.float32();
        const alcoholLevel = reader.float32();
        const additionalPain = reader.float32();
        const deepWoundTime = reader.float32();
        const haveGlass = reader.bool();
        const getBandageXp = reader.bool();
        const stitched = reader.bool();
        const stitchTime = reader.float32();
        const getStitchXp = reader.bool();
        const getSplintXp = reader.bool();
        const fractureTime = reader.float32();
        const splint = reader.bool();
        const splintFactor = splint ? reader.float32() : null;
        const haveBullet = reader.bool();
        const burnTime = reader.float32();
        const needBurnWash = reader.bool();
        const lastTimeBurnWash = reader.float32();
        const splintItem = reader.string();
        const bandageType = reader.string();
        const cutTime2 = reader.float32();
        const wetness = reader.float32();
        const stiffness = reader.float32();
        let comfreyFactor: number | null = null;
        let garlicFactor: number | null = null;
        let plantainFactor: number | null = null;
        if (worldVersion >= VERSION_GATES.bodyPartHerbalFactors) {
            comfreyFactor = reader.float32();
            garlicFactor = reader.float32();
            plantainFactor = reader.float32();
        }
        parts.push({
            type,
            cut,
            bitten,
            scratched,
            bandaged,
            bleeding,
            deepWounded,
            fakeInfected,
            infected,
            health,
            bandageLife,
            infectedWound,
            woundInfectionLevel,
            cutTime,
            biteTime,
            scratchTime,
            bleedingTime,
            alcoholLevel,
            additionalPain,
            deepWoundTime,
            haveGlass,
            getBandageXp,
            stitched,
            stitchTime,
            getStitchXp,
            getSplintXp,
            fractureTime,
            splint,
            splintFactor,
            haveBullet,
            burnTime,
            needBurnWash,
            lastTimeBurnWash,
            splintItem,
            bandageType,
            cutTime2,
            wetness,
            stiffness,
            comfreyFactor,
            garlicFactor,
            plantainFactor,
        });
    }

    const main = readMainFields(reader, worldVersion);
    const hasThermoregulator = reader.bool();
    const thermoregulator = hasThermoregulator ? readThermoregulator(reader, worldVersion) : null;
    return { parts, main, hasThermoregulator, thermoregulator };
}

export function writeBodyDamage(
    writer: BinaryWriter,
    data: BodyDamageData,
    worldVersion: number,
): void {
    for (const p of data.parts) {
        writer.bool(p.cut);
        writer.bool(p.bitten);
        writer.bool(p.scratched);
        writer.bool(p.bandaged);
        writer.bool(p.bleeding);
        writer.bool(p.deepWounded);
        writer.bool(p.fakeInfected);
        writer.bool(p.infected);
        writer.float32(p.health);
        if (p.bandaged) {
            writer.float32(p.bandageLife ?? 0);
        }
        writer.bool(p.infectedWound);
        if (p.infectedWound) {
            writer.float32(p.woundInfectionLevel ?? 0);
        }
        writer.float32(p.cutTime);
        writer.float32(p.biteTime);
        writer.float32(p.scratchTime);
        writer.float32(p.bleedingTime);
        writer.float32(p.alcoholLevel);
        writer.float32(p.additionalPain);
        writer.float32(p.deepWoundTime);
        writer.bool(p.haveGlass);
        writer.bool(p.getBandageXp);
        writer.bool(p.stitched);
        writer.float32(p.stitchTime);
        writer.bool(p.getStitchXp);
        writer.bool(p.getSplintXp);
        writer.float32(p.fractureTime);
        writer.bool(p.splint);
        if (p.splint) {
            writer.float32(p.splintFactor ?? 0);
        }
        writer.bool(p.haveBullet);
        writer.float32(p.burnTime);
        writer.bool(p.needBurnWash);
        writer.float32(p.lastTimeBurnWash);
        writer.string(p.splintItem);
        writer.string(p.bandageType);
        writer.float32(p.cutTime2);
        writer.float32(p.wetness);
        writer.float32(p.stiffness);
        // Always written by BodyDamage.save regardless of version.
        if (worldVersion >= VERSION_GATES.bodyPartHerbalFactors) {
            writer.float32(p.comfreyFactor ?? 0);
            writer.float32(p.garlicFactor ?? 0);
            writer.float32(p.plantainFactor ?? 0);
        }
    }

    writeMainFields(writer, data.main, worldVersion);
    writer.bool(data.hasThermoregulator);
    if (data.hasThermoregulator && data.thermoregulator) {
        writeThermoregulator(writer, data.thermoregulator, worldVersion);
    }
}

function readMainFields(reader: BinaryReader, worldVersion: number): BodyDamageMainFields {
    const catchACold = reader.float32();
    const hasACold = reader.bool();
    const coldStrength = reader.float32();
    const timeToSneezeOrCough =
        worldVersion >= VERSION_GATES.timeToSneezeOrCough ? reader.int32() : null;
    const reduceFakeInfection = reader.bool();
    const healthFromFoodTimer = reader.float32();
    const painReduction = reader.float32();
    const coldReduction = reader.float32();
    const infectionTime = reader.float32();
    const infectionMortalityDuration = reader.float32();
    const coldDamageStage = reader.float32();
    return {
        catchACold,
        hasACold,
        coldStrength,
        timeToSneezeOrCough,
        reduceFakeInfection,
        healthFromFoodTimer,
        painReduction,
        coldReduction,
        infectionTime,
        infectionMortalityDuration,
        coldDamageStage,
    };
}

function writeMainFields(
    writer: BinaryWriter,
    main: BodyDamageMainFields,
    worldVersion: number,
): void {
    writer.float32(main.catchACold);
    writer.bool(main.hasACold);
    writer.float32(main.coldStrength);
    // `saveMainFields` always writes this int; `loadMainFields` only reads it for >= 222.
    if (worldVersion >= VERSION_GATES.timeToSneezeOrCough) {
        writer.int32(main.timeToSneezeOrCough ?? 0);
    }
    writer.bool(main.reduceFakeInfection);
    writer.float32(main.healthFromFoodTimer);
    writer.float32(main.painReduction);
    writer.float32(main.coldReduction);
    writer.float32(main.infectionTime);
    writer.float32(main.infectionMortalityDuration);
    writer.float32(main.coldDamageStage);
}

function readThermoregulator(reader: BinaryReader, worldVersion: number): ThermoregulatorData {
    const setPoint = reader.float32();
    const metabolicRate = reader.float32();
    const metabolicRateReal = worldVersion >= VERSION_GATES.thermoWetness ? reader.float32() : null;
    const metabolicTarget = reader.float32();
    const bodyHeatDelta = reader.float32();
    const coreHeatDelta = reader.float32();
    const thermalDamage = reader.float32();
    const damageCounter = reader.float32();
    const thermalDuration = worldVersion >= VERSION_GATES.thermoDuration ? reader.float32() : null;
    const count = reader.int32();
    const nodes: ThermalNodeData[] = [];
    for (let i = 0; i < count; i++) {
        const bodyPartIndex = reader.int32();
        const celcius = reader.float32();
        const skinCelcius = reader.float32();
        const heatDelta = reader.float32();
        const primaryDelta = reader.float32();
        const secondaryDelta = reader.float32();
        const insulation =
            worldVersion >= VERSION_GATES.thermoNodeInsulation ? reader.float32() : null;
        let windresist: number | null = null;
        let bodyWetness: number | null = null;
        let clothingWetness: number | null = null;
        if (worldVersion >= VERSION_GATES.thermoWetness) {
            windresist = reader.float32();
            bodyWetness = reader.float32();
            clothingWetness = reader.float32();
        }
        nodes.push({
            bodyPartIndex,
            celcius,
            skinCelcius,
            heatDelta,
            primaryDelta,
            secondaryDelta,
            insulation,
            windresist,
            bodyWetness,
            clothingWetness,
        });
    }
    return {
        setPoint,
        metabolicRate,
        metabolicRateReal,
        metabolicTarget,
        bodyHeatDelta,
        coreHeatDelta,
        thermalDamage,
        damageCounter,
        thermalDuration,
        nodes,
    };
}

function writeThermoregulator(
    writer: BinaryWriter,
    data: ThermoregulatorData,
    worldVersion: number,
): void {
    writer.float32(data.setPoint);
    writer.float32(data.metabolicRate);
    if (worldVersion >= VERSION_GATES.thermoWetness) {
        writer.float32(data.metabolicRateReal ?? 0);
    }
    writer.float32(data.metabolicTarget);
    writer.float32(data.bodyHeatDelta);
    writer.float32(data.coreHeatDelta);
    writer.float32(data.thermalDamage);
    writer.float32(data.damageCounter);
    if (worldVersion >= VERSION_GATES.thermoDuration) {
        writer.float32(data.thermalDuration ?? 0);
    }
    writer.int32(data.nodes.length);
    for (const node of data.nodes) {
        writer.int32(node.bodyPartIndex);
        writer.float32(node.celcius);
        writer.float32(node.skinCelcius);
        writer.float32(node.heatDelta);
        writer.float32(node.primaryDelta);
        writer.float32(node.secondaryDelta);
        if (worldVersion >= VERSION_GATES.thermoNodeInsulation) {
            writer.float32(node.insulation ?? 0);
        }
        if (worldVersion >= VERSION_GATES.thermoWetness) {
            writer.float32(node.windresist ?? 0);
            writer.float32(node.bodyWetness ?? 0);
            writer.float32(node.clothingWetness ?? 0);
        }
    }
}

/**
 * Mirrors `BodyDamage.calculateOverallHealth()`
 * zombie/characters/BodyDamage/BodyDamage.java:2459
 *
 * `overallBodyHealth` is NOT stored in the BLOB — it is recomputed from the
 * individual body-part healths every time `loadMainFields` runs. That makes the
 * per-part healths the authoritative persistent health state.
 *
 * The `getDamageFromPills()` term is omitted here because it depends on
 * `IsoPlayer.getSleepingPillsTaken()`, which is runtime-only state that is
 * never serialized (BodyDamage.java:2555).
 */
export function calculateOverallHealth(parts: BodyPartData[]): number {
    let totalDamage = 0;
    for (const part of parts) {
        totalDamage += (100 - part.health) * BODY_PART_DAMAGE_MODIFIERS[part.type];
    }
    if (totalDamage > 100) {
        totalDamage = 100;
    }
    return 100 - totalDamage;
}
