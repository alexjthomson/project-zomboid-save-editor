import { BinaryReader, BinaryReadError } from './BinaryReader';
import { BinaryWriter, TraceCollector, type TraceNode } from './BinaryWriter';
import { readLuaTable, writeLuaTable, type LuaTable } from './LuaTable';
import { VERSION_GATES } from './SaveVersion';
import {
    readBodyDamage,
    writeBodyDamage,
    type BodyDamageData,
} from './blocks/BodyDamage';
import { readStats, writeStats, type StatsData } from './blocks/Stats';
import { readXp, writeXp, type XpData } from './blocks/Xp';
import {
    readCraftHistory,
    readFitness,
    readNutrition,
    readPlayerCheats,
    writeCraftHistory,
    writeFitness,
    writeNutrition,
    writePlayerCheats,
    type CraftHistoryData,
    type FitnessData,
    type NutritionData,
    type PlayerCheatsData,
} from './blocks/Misc';
import {
    readSurvivorDesc,
    writeSurvivorDesc,
    type SurvivorDescData,
} from './blocks/SurvivorDesc';
import {
    readHumanVisual,
    writeHumanVisual,
    type HumanVisualData,
} from './blocks/HumanVisual';
import {
    readItemContainer,
    writeItemContainer,
    type ItemContainerData,
} from './blocks/Inventory';

/**
 * Top level player BLOB codec.
 *
 * The BLOB stored in `networkPlayers.data` / `localPlayers.data` is exactly what
 * `IsoPlayer.save(ByteBuffer, boolean isDebugSave)` produces, with no header,
 * magic number or embedded version. Call chain, outermost first:
 *
 *   IsoPlayer.save            zombie/characters/IsoPlayer.java:1456
 *     IsoGameCharacter.save   zombie/characters/IsoGameCharacter.java:6024
 *       IsoMovingObject.save  zombie/iso/IsoMovingObject.java:686
 *
 * `IsoMovingObject.save` writes the two leading bytes (`Serialize()` flag and
 * object class id); `IsoPlayer.load` reads them back before delegating to
 * `super.load` (IsoPlayer.java:1238-1240), which is why they appear first here.
 *
 * `IsoMovingObject.load` does NOT call `IsoObject.load`, so none of the
 * IsoObject sprite/attached-sprite serialization appears in a player BLOB.
 */

export interface MovingObjectData {
    /** `IsoObject.Serialize()` result — 1 for players. */
    serialize: number;
    /** `IsoObject.factoryGetClassID(getObjectName())` — 1 for "player". */
    objectId: number;
    offsetX: number;
    offsetY: number;
    x: number;
    y: number;
    z: number;
    /** `IsoDirections` ordinal. */
    direction: number;
    /** Lua `modData` table, absent when the character has none. */
    modData: LuaTable | null;
}

export interface ReadBookData {
    fullType: string;
    alreadyReadPages: number;
}

export interface ReadLiteratureData {
    title: string;
    day: number;
}

export interface WornItemData {
    /** `ItemBodyLocation` resource location, e.g. "base:jacket". */
    location: string;
    /** Index into the flattened saved inventory item list, or -1. */
    itemIndex: number;
}

export interface VehicleData {
    x: number;
    y: number;
    seat: number;
    engineRunning: boolean;
}

export interface CharacterFlags {
    unlimitedCarry: boolean;
    buildCheat: boolean;
    healthCheat: boolean;
    mechanicsCheat: boolean;
    movablesCheat: boolean;
    farmingCheat: boolean;
    /** worldVersion >= 202 */
    fishingCheat: boolean | null;
    /** worldVersion >= 217 */
    canUseBrushTool: boolean | null;
    fastMoveCheat: boolean | null;
    timedActionInstantCheat: boolean;
    unlimitedEndurance: boolean;
    /** worldVersion >= 230 */
    unlimitedAmmo: boolean | null;
    knowAllRecipes: boolean | null;
    sneaking: boolean;
    /**
     * `IsoGameCharacter.deathDragDown` — set while a zombie is dragging the
     * character down during a death animation.
     */
    deathDragDown: boolean;
}

export interface PlayerBlob {
    worldVersion: number;

    /* --- IsoMovingObject --- */
    movingObject: MovingObjectData;

    /* --- IsoGameCharacter --- */
    hasDescriptor: boolean;
    descriptor: SurvivorDescData | null;
    visual: HumanVisualData;
    inventory: ItemContainerData;
    asleep: boolean;
    forceWakeUpTime: number;
    stats: StatsData;
    bodyDamage: BodyDamageData;
    xp: XpData;
    /** int32 index into the inventory list; -1 when empty. */
    leftHandItemIndex: number;
    rightHandItemIndex: number;
    onFire: boolean;
    depressEffect: number;
    depressFirstTakeTime: number;
    betaEffect: number;
    betaDelta: number;
    painEffect: number;
    painDelta: number;
    sleepingTabletEffect: number;
    sleepingTabletDelta: number;
    readBooks: ReadBookData[];
    reduceInfectionPower: number;
    knownRecipes: string[];
    lastHourSleeped: number;
    timeSinceLastSmoke: number;
    beardGrowTiming: number;
    hairGrowTiming: number;
    flags: CharacterFlags;
    readLiterature: ReadLiteratureData[];
    /** worldVersion >= 222 */
    readPrintMedia: string[] | null;
    lastAnimalPet: bigint;
    /** worldVersion >= 231 */
    playerCheats: PlayerCheatsData | null;

    /* --- IsoPlayer --- */
    hoursSurvived: number;
    zombieKills: number;
    wornItems: WornItemData[];
    /** int16 index into the flattened saved inventory list. */
    primaryHandIndex: number;
    secondaryHandIndex: number;
    survivorKills: number;
    nutrition: NutritionData;
    allChatMuted: boolean;
    tagPrefix: string;
    tagColorR: number;
    tagColorG: number;
    tagColorB: number;
    displayName: string;
    showTag: boolean;
    factionPvp: boolean;
    /** worldVersion >= 239 */
    autoDrink: boolean | null;
    /** `IsoPlayer.getExtraInfoFlags()` bitfield (god mode, ghost, invisible, ...). */
    extraInfoFlags: number;
    vehicle: VehicleData | null;
    mechanicsItem: Array<{ key: bigint; value: bigint }>;
    fitness: FitnessData;
    /** WorldDictionary registry ids of books already read. */
    alreadyReadBook: number[];
    knownMediaLines: string[];
    /** worldVersion >= 203 */
    voiceType: number | null;
    /** worldVersion >= 228 */
    craftHistory: CraftHistoryData | null;

    /**
     * Bytes after the last field this parser understands. Should always be
     * empty for a supported version; anything here is preserved verbatim.
     */
    trailingBytes: Uint8Array;
}

export interface ParseResult {
    /** Populated when the BLOB parsed all the way to the end. */
    player: PlayerBlob | null;
    /** Non-null when parsing aborted. */
    error: Error | null;
    /** Offset at which parsing stopped when it failed. */
    errorOffset: number | null;
    /** Total BLOB length. */
    length: number;
}

export class PlayerBlobParseError extends Error {
    readonly offset: number;

    constructor(message: string, offset: number, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'PlayerBlobParseError';
        this.offset = offset;
    }
}

/**
 * Parses a player BLOB. Throws `PlayerBlobParseError` when the layout does not
 * match; use `tryParsePlayerBlob` for the non-throwing variant.
 */
export function parsePlayerBlob(blob: Uint8Array, worldVersion: number): PlayerBlob {
    const reader = new BinaryReader(blob);
    try {
        return readPlayer(reader, worldVersion);
    } catch (error) {
        const offset = error instanceof BinaryReadError ? error.offset : reader.position;
        throw new PlayerBlobParseError(
            `Failed to parse player BLOB at offset ${offset} (0x${offset.toString(16)}): ` +
                `${(error as Error).message}`,
            offset,
            { cause: error },
        );
    }
}

export function tryParsePlayerBlob(blob: Uint8Array, worldVersion: number): ParseResult {
    try {
        return {
            player: parsePlayerBlob(blob, worldVersion),
            error: null,
            errorOffset: null,
            length: blob.length,
        };
    } catch (error) {
        return {
            player: null,
            error: error as Error,
            errorOffset: error instanceof PlayerBlobParseError ? error.offset : null,
            length: blob.length,
        };
    }
}

function readPlayer(reader: BinaryReader, worldVersion: number): PlayerBlob {
    /* IsoPlayer.load reads these two before delegating to super.load. */
    const serialize = reader.int8();
    const objectId = reader.int8();

    /* IsoMovingObject.load — zombie/iso/IsoMovingObject.java:646 */
    const offsetX = reader.float32();
    const offsetY = reader.float32();
    const x = reader.float32();
    const y = reader.float32();
    const z = reader.float32();
    const direction = reader.int32();
    const modData = reader.bool() ? readLuaTable(reader) : null;

    const movingObject: MovingObjectData = {
        serialize,
        objectId,
        offsetX,
        offsetY,
        x,
        y,
        z,
        direction,
        modData,
    };

    /* IsoGameCharacter.load — zombie/characters/IsoGameCharacter.java:5886 */
    const hasDescriptor = reader.bool();
    const descriptor = hasDescriptor ? readSurvivorDesc(reader, worldVersion) : null;
    const visual = readHumanVisual(reader);
    const inventory = readItemContainer(reader);
    const asleep = reader.bool();
    const forceWakeUpTime = reader.float32();

    // The `!isZombie()` branch is always taken for IsoPlayer.
    const stats = readStats(reader);
    const bodyDamage = readBodyDamage(reader, worldVersion);
    const xp = readXp(reader);
    const leftHandItemIndex = reader.int32();
    const rightHandItemIndex = reader.int32();

    const onFire = reader.bool();
    const depressEffect = reader.float32();
    const depressFirstTakeTime = reader.float32();
    const betaEffect = reader.float32();
    const betaDelta = reader.float32();
    const painEffect = reader.float32();
    const painDelta = reader.float32();
    const sleepingTabletEffect = reader.float32();
    const sleepingTabletDelta = reader.float32();

    const numBooks = reader.int32();
    const readBooks: ReadBookData[] = [];
    for (let i = 0; i < numBooks; i++) {
        readBooks.push({ fullType: reader.string(), alreadyReadPages: reader.int32() });
    }

    const reduceInfectionPower = reader.float32();

    const numRecipes = reader.int32();
    const knownRecipes: string[] = [];
    for (let i = 0; i < numRecipes; i++) {
        knownRecipes.push(reader.string());
    }

    const lastHourSleeped = reader.int32();
    const timeSinceLastSmoke = reader.float32();
    const beardGrowTiming = reader.float32();
    const hairGrowTiming = reader.float32();

    const flags: CharacterFlags = {
        unlimitedCarry: reader.bool(),
        buildCheat: reader.bool(),
        healthCheat: reader.bool(),
        mechanicsCheat: reader.bool(),
        movablesCheat: reader.bool(),
        farmingCheat: reader.bool(),
        fishingCheat: null,
        canUseBrushTool: null,
        fastMoveCheat: null,
        timedActionInstantCheat: false,
        unlimitedEndurance: false,
        unlimitedAmmo: null,
        knowAllRecipes: null,
        sneaking: false,
        deathDragDown: false,
    };
    if (worldVersion >= VERSION_GATES.fishingCheat) {
        flags.fishingCheat = reader.bool();
    }
    if (worldVersion >= VERSION_GATES.brushToolAndFastMove) {
        flags.canUseBrushTool = reader.bool();
        flags.fastMoveCheat = reader.bool();
    }
    flags.timedActionInstantCheat = reader.bool();
    flags.unlimitedEndurance = reader.bool();
    if (worldVersion >= VERSION_GATES.unlimitedAmmoAndRecipes) {
        flags.unlimitedAmmo = reader.bool();
        flags.knowAllRecipes = reader.bool();
    }
    flags.sneaking = reader.bool();
    flags.deathDragDown = reader.bool();

    const literatureCount = reader.int32();
    const readLiterature: ReadLiteratureData[] = [];
    for (let i = 0; i < literatureCount; i++) {
        readLiterature.push({ title: reader.string(), day: reader.int32() });
    }

    let readPrintMedia: string[] | null = null;
    if (worldVersion >= VERSION_GATES.readPrintMedia) {
        const count = reader.int32();
        readPrintMedia = [];
        for (let i = 0; i < count; i++) {
            readPrintMedia.push(reader.string());
        }
    }

    const lastAnimalPet = reader.int64();
    const playerCheats =
        worldVersion >= VERSION_GATES.playerCheats ? readPlayerCheats(reader) : null;

    /* IsoPlayer.load continues — zombie/characters/IsoPlayer.java:1241 */
    const hoursSurvived = reader.float64();
    const zombieKills = reader.int32();

    const wornItemCount = reader.int8();
    const wornItems: WornItemData[] = [];
    for (let i = 0; i < wornItemCount; i++) {
        wornItems.push({ location: reader.string(), itemIndex: reader.int16() });
    }

    const primaryHandIndex = reader.int16();
    const secondaryHandIndex = reader.int16();
    const survivorKills = reader.int32();
    const nutrition = readNutrition(reader);
    const allChatMuted = reader.bool();
    const tagPrefix = reader.string();
    const tagColorR = reader.float32();
    const tagColorG = reader.float32();
    const tagColorB = reader.float32();
    const displayName = reader.string();
    const showTag = reader.bool();
    const factionPvp = reader.bool();
    const autoDrink = worldVersion >= VERSION_GATES.autoDrink ? reader.bool() : null;
    const extraInfoFlags = reader.int8();

    const vehicle = reader.bool()
        ? {
              x: reader.float32(),
              y: reader.float32(),
              seat: reader.int8(),
              engineRunning: reader.bool(),
          }
        : null;

    const mechanicsCount = reader.int32();
    const mechanicsItem: Array<{ key: bigint; value: bigint }> = [];
    for (let i = 0; i < mechanicsCount; i++) {
        mechanicsItem.push({ key: reader.int64(), value: reader.int64() });
    }

    const fitness = readFitness(reader);

    const alreadyReadBookCount = reader.int16();
    const alreadyReadBook: number[] = [];
    for (let i = 0; i < alreadyReadBookCount; i++) {
        alreadyReadBook.push(reader.int16());
    }

    const knownMediaCount = reader.int16();
    const knownMediaLines: string[] = [];
    for (let i = 0; i < knownMediaCount; i++) {
        knownMediaLines.push(reader.string());
    }

    const voiceType = worldVersion >= VERSION_GATES.voiceType ? reader.int8() : null;
    const craftHistory = worldVersion >= VERSION_GATES.craftHistory ? readCraftHistory(reader) : null;

    const trailingBytes = reader.bytesOf(reader.remaining);

    return {
        worldVersion,
        movingObject,
        hasDescriptor,
        descriptor,
        visual,
        inventory,
        asleep,
        forceWakeUpTime,
        stats,
        bodyDamage,
        xp,
        leftHandItemIndex,
        rightHandItemIndex,
        onFire,
        depressEffect,
        depressFirstTakeTime,
        betaEffect,
        betaDelta,
        painEffect,
        painDelta,
        sleepingTabletEffect,
        sleepingTabletDelta,
        readBooks,
        reduceInfectionPower,
        knownRecipes,
        lastHourSleeped,
        timeSinceLastSmoke,
        beardGrowTiming,
        hairGrowTiming,
        flags,
        readLiterature,
        readPrintMedia,
        lastAnimalPet,
        playerCheats,
        hoursSurvived,
        zombieKills,
        wornItems,
        primaryHandIndex,
        secondaryHandIndex,
        survivorKills,
        nutrition,
        allChatMuted,
        tagPrefix,
        tagColorR,
        tagColorG,
        tagColorB,
        displayName,
        showTag,
        factionPvp,
        autoDrink,
        extraInfoFlags,
        vehicle,
        mechanicsItem,
        fitness,
        alreadyReadBook,
        knownMediaLines,
        voiceType,
        craftHistory,
        trailingBytes,
    };
}

/** Inverse of `parsePlayerBlob`. */
export function serializePlayerBlob(
    player: PlayerBlob,
    worldVersion?: number,
    tracer?: TraceCollector,
): Uint8Array {
    const version = worldVersion ?? player.worldVersion;
    const writer = new BinaryWriter(64 * 1024);
    if (tracer) writer.setTracer(tracer);

    const MO = 'IsoMovingObject.save / iso/IsoMovingObject.java:686';
    const GC = 'IsoGameCharacter.save / characters/IsoGameCharacter.java:6024';
    const PL = 'IsoPlayer.save / characters/IsoPlayer.java:1456';

    writer.beginScope('IsoMovingObject', MO);
    writer.label('serialize', 'IsoObject.Serialize()').int8(player.movingObject.serialize);
    writer.label('objectID', 'IsoObject.factoryGetClassID(getObjectName())').int8(player.movingObject.objectId);
    writer.label('offsetX', MO).float32(player.movingObject.offsetX);
    writer.label('offsetY', MO).float32(player.movingObject.offsetY);
    writer.label('x', MO).float32(player.movingObject.x);
    writer.label('y', MO).float32(player.movingObject.y);
    writer.label('z', MO).float32(player.movingObject.z);
    writer.label('direction (IsoDirections ordinal)', MO).int32(player.movingObject.direction);
    if (player.movingObject.modData) {
        writer.label('hasModData', MO).bool(true);
        writer.beginScope('modData (KahluaTable)', 'KahluaTableImpl.save / se.krka.kahlua');
        writeLuaTable(writer, player.movingObject.modData);
        writer.endScope();
    } else {
        writer.label('hasModData', MO).bool(false);
    }
    writer.endScope();

    writer.beginScope('IsoGameCharacter', GC);
    writer.label('hasDescriptor', GC).bool(player.hasDescriptor);
    if (player.hasDescriptor && player.descriptor) {
        writer.beginScope('descriptor (SurvivorDesc)', 'SurvivorDesc.save / characters/SurvivorDesc.java');
        writeSurvivorDesc(writer, player.descriptor, version);
        writer.endScope();
    }
    writer.beginScope('visual (HumanVisual)', 'HumanVisual.save / characters/HumanVisual.java');
    writeHumanVisual(writer, player.visual);
    writer.endScope();
    writer.beginScope('inventory (ItemContainer)', 'ItemContainer.save / inventory/ItemContainer.java:2409');
    writeItemContainer(writer, player.inventory);
    writer.endScope();
    writer.label('asleep', GC).bool(player.asleep);
    writer.label('forceWakeUpTime', GC).float32(player.forceWakeUpTime);

    writer.beginScope('stats (Stats)', 'Stats.save / characters/Stats.java');
    writeStats(writer, player.stats);
    writer.endScope();
    writer.beginScope('bodyDamage (BodyDamage)', 'BodyDamage.save / characters/BodyDamage/BodyDamage.java:243');
    writeBodyDamage(writer, player.bodyDamage, version);
    writer.endScope();
    writer.beginScope('xp (IsoGameCharacter.XP)', 'XP.save / characters/IsoGameCharacter.java:18349');
    writeXp(writer, player.xp);
    writer.endScope();
    writer.label('leftHandItem (inventory index)', GC).int32(player.leftHandItemIndex);
    writer.label('rightHandItem (inventory index)', GC).int32(player.rightHandItemIndex);

    writer.label('onFire', GC).bool(player.onFire);
    writer.label('depressEffect', GC).float32(player.depressEffect);
    writer.label('depressFirstTakeTime', GC).float32(player.depressFirstTakeTime);
    writer.label('betaEffect', GC).float32(player.betaEffect);
    writer.label('betaDelta', GC).float32(player.betaDelta);
    writer.label('painEffect', GC).float32(player.painEffect);
    writer.label('painDelta', GC).float32(player.painDelta);
    writer.label('sleepingTabletEffect', GC).float32(player.sleepingTabletEffect);
    writer.label('sleepingTabletDelta', GC).float32(player.sleepingTabletDelta);

    writer.beginScope('readBooks', GC);
    writer.label('count', GC).int32(player.readBooks.length);
    for (const book of player.readBooks) {
        writer.label('fullType', GC).string(book.fullType);
        writer.label('alreadyReadPages', GC).int32(book.alreadyReadPages);
    }
    writer.endScope();

    writer.label('reduceInfectionPower', GC).float32(player.reduceInfectionPower);

    writer.beginScope('knownRecipes', GC);
    writer.label('count', GC).int32(player.knownRecipes.length);
    for (const recipe of player.knownRecipes) {
        writer.label('recipe', GC).string(recipe);
    }
    writer.endScope();

    writer.label('lastHourSleeped', GC).int32(player.lastHourSleeped);
    writer.label('timeSinceLastSmoke', GC).float32(player.timeSinceLastSmoke);
    writer.label('beardGrowTiming', GC).float32(player.beardGrowTiming);
    writer.label('hairGrowTiming', GC).float32(player.hairGrowTiming);

    writer.beginScope('cheat flags', GC);
    writer.label('unlimitedCarry', GC).bool(player.flags.unlimitedCarry);
    writer.label('buildCheat', GC).bool(player.flags.buildCheat);
    writer.label('healthCheat', GC).bool(player.flags.healthCheat);
    writer.label('mechanicsCheat', GC).bool(player.flags.mechanicsCheat);
    writer.label('movablesCheat', GC).bool(player.flags.movablesCheat);
    writer.label('farmingCheat', GC).bool(player.flags.farmingCheat);
    if (version >= VERSION_GATES.fishingCheat) {
        writer.label('fishingCheat', GC, `worldVersion >= ${VERSION_GATES.fishingCheat}`).bool(player.flags.fishingCheat ?? false);
    }
    if (version >= VERSION_GATES.brushToolAndFastMove) {
        writer.label('canUseBrushTool', GC, `worldVersion >= ${VERSION_GATES.brushToolAndFastMove}`).bool(player.flags.canUseBrushTool ?? false);
        writer.label('fastMoveCheat', GC, `worldVersion >= ${VERSION_GATES.brushToolAndFastMove}`).bool(player.flags.fastMoveCheat ?? false);
    }
    writer.label('timedActionInstantCheat', GC).bool(player.flags.timedActionInstantCheat);
    writer.label('unlimitedEndurance', GC).bool(player.flags.unlimitedEndurance);
    if (version >= VERSION_GATES.unlimitedAmmoAndRecipes) {
        writer.label('unlimitedAmmo', GC, `worldVersion >= ${VERSION_GATES.unlimitedAmmoAndRecipes}`).bool(player.flags.unlimitedAmmo ?? false);
        writer.label('knowAllRecipes', GC, `worldVersion >= ${VERSION_GATES.unlimitedAmmoAndRecipes}`).bool(player.flags.knowAllRecipes ?? false);
    }
    writer.label('sneaking', GC).bool(player.flags.sneaking);
    writer.label('deathDragDown', GC).bool(player.flags.deathDragDown);
    writer.endScope();

    writer.beginScope('readLiterature', GC);
    writer.label('count', GC).int32(player.readLiterature.length);
    for (const entry of player.readLiterature) {
        writer.label('title', GC).string(entry.title);
        writer.label('day', GC).int32(entry.day);
    }
    writer.endScope();

    if (version >= VERSION_GATES.readPrintMedia) {
        const media = player.readPrintMedia ?? [];
        writer.beginScope('readPrintMedia', GC, `worldVersion >= ${VERSION_GATES.readPrintMedia}`);
        writer.label('count', GC).int32(media.length);
        for (const id of media) {
            writer.label('mediaId', GC).string(id);
        }
        writer.endScope();
    }

    writer.label('lastAnimalPet', GC).int64(player.lastAnimalPet);
    if (version >= VERSION_GATES.playerCheats) {
        writer.beginScope('playerCheats', 'PlayerCheats.save', `worldVersion >= ${VERSION_GATES.playerCheats}`);
        writePlayerCheats(writer, player.playerCheats ?? { cheats: [] });
        writer.endScope();
    }
    writer.endScope();

    writer.beginScope('IsoPlayer', PL);
    writer.label('hoursSurvived', PL).float64(player.hoursSurvived);
    writer.label('zombieKills', PL).int32(player.zombieKills);

    writer.beginScope('wornItems', PL);
    writer.label('count', PL).int8(player.wornItems.length);
    for (const worn of player.wornItems) {
        writer.label('bodyLocation', PL).string(worn.location);
        writer.label('itemIndex', PL).int16(worn.itemIndex);
    }
    writer.endScope();

    writer.label('primaryHandItem (index)', PL).int16(player.primaryHandIndex);
    writer.label('secondaryHandItem (index)', PL).int16(player.secondaryHandIndex);
    writer.label('survivorKills', PL).int32(player.survivorKills);
    writer.beginScope('nutrition (Nutrition)', 'Nutrition.save / characters/BodyDamage/Nutrition.java');
    writeNutrition(writer, player.nutrition);
    writer.endScope();
    writer.label('allChatMuted', PL).bool(player.allChatMuted);
    writer.label('tagPrefix', PL).string(player.tagPrefix);
    writer.label('tagColor.r', PL).float32(player.tagColorR);
    writer.label('tagColor.g', PL).float32(player.tagColorG);
    writer.label('tagColor.b', PL).float32(player.tagColorB);
    writer.label('displayName', PL).string(player.displayName);
    writer.label('showTag', PL).bool(player.showTag);
    writer.label('factionPvp', PL).bool(player.factionPvp);
    if (version >= VERSION_GATES.autoDrink) {
        writer.label('autoDrink', PL, `worldVersion >= ${VERSION_GATES.autoDrink}`).bool(player.autoDrink ?? false);
    }
    writer.label('extraInfoFlags', PL).int8(player.extraInfoFlags);

    if (player.vehicle) {
        writer.label('hasVehicle', PL).bool(true);
        writer.beginScope('vehicle', PL);
        writer.label('x', PL).float32(player.vehicle.x);
        writer.label('y', PL).float32(player.vehicle.y);
        writer.label('seat', PL).int8(player.vehicle.seat);
        writer.label('engineRunning', PL).bool(player.vehicle.engineRunning);
        writer.endScope();
    } else {
        writer.label('hasVehicle', PL).bool(false);
    }

    writer.beginScope('mechanicsItem', PL);
    writer.label('count', PL).int32(player.mechanicsItem.length);
    for (const entry of player.mechanicsItem) {
        writer.label('key', PL).int64(entry.key);
        writer.label('value', PL).int64(entry.value);
    }
    writer.endScope();

    writer.beginScope('fitness (Fitness)', 'Fitness.save / characters/Fitness.java');
    writeFitness(writer, player.fitness);
    writer.endScope();

    writer.beginScope('alreadyReadBook', PL);
    writer.label('count', PL).int16(player.alreadyReadBook.length);
    for (const id of player.alreadyReadBook) {
        writer.label('registryID', PL).int16(id);
    }
    writer.endScope();

    writer.beginScope('knownMediaLines', PL);
    writer.label('count', PL).int16(player.knownMediaLines.length);
    for (const line of player.knownMediaLines) {
        writer.label('line', PL).string(line);
    }
    writer.endScope();

    if (version >= VERSION_GATES.voiceType) {
        writer.label('voiceType', PL, `worldVersion >= ${VERSION_GATES.voiceType}`).int8(player.voiceType ?? 0);
    }
    if (version >= VERSION_GATES.craftHistory) {
        writer.beginScope('craftHistory (PlayerCraftHistory)', 'PlayerCraftHistory.save', `worldVersion >= ${VERSION_GATES.craftHistory}`);
        writeCraftHistory(writer, player.craftHistory ?? []);
        writer.endScope();
    }
    writer.endScope();

    if (player.trailingBytes.length > 0) {
        writer.label('unparsed trailing bytes').bytes(player.trailingBytes);
    }

    tracer?.finish(writer.position);
    return writer.toUint8Array();
}

/** Serializes into a nested field trace for the advanced BLOB view. */
export function tracePlayerBlob(player: PlayerBlob, worldVersion?: number): TraceNode {
    const tracer = new TraceCollector();
    serializePlayerBlob(player, worldVersion, tracer);
    return tracer.root;
}
