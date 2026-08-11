import { BinaryReader } from '../BinaryReader';
import type { BinaryWriter } from '../BinaryWriter';
import { readLuaTable } from '../LuaTable';
import { readItemVisual } from './HumanVisual';

/**
 * `ItemContainer` / `CompressIdenticalItems` / `InventoryItem` serialization.
 *
 * Mirrors ItemContainer.save(ByteBuffer, IsoGameCharacter) / load(ByteBuffer, int)
 * zombie/inventory/ItemContainer.java:2409 and :2422
 *
 *   GameWindow.WriteString(output, this.type);
 *   output.put((byte)(this.explored ? 1 : 0));
 *   CompressIdenticalItems.save(output, this.items, null);
 *   output.put((byte)(this.isHasBeenLooted() ? 1 : 0));
 *   output.putInt(this.capacity);
 *
 * and CompressIdenticalItems.save/load
 * zombie/inventory/CompressIdenticalItems.java:135 and :194
 *
 *   output.putShort((short)groupCount);
 *   per group:
 *     output.putInt(identical);          // run length of byte-identical items
 *     item.saveWithSize(output, false);
 *     if (identical > 1) output.putInt(id) * (identical - 1);
 *
 * Identical items are run-length compressed: one serialized copy plus the
 * distinct `id` of each additional copy.
 *
 * ITEM BODIES ARE TREATED AS OPAQUE BYTE SLICES.
 *
 * `InventoryItem.saveWithSize` (InventoryItem.java:3658) writes an int32 byte
 * length before the item body, and `InventoryItem.loadItem`
 * (InventoryItem.java:1888) uses it to skip items it cannot construct. That
 * length prefix lets this editor step over every item without understanding the
 * (very large, subclass-dependent, bit-header driven) item format, and to write
 * the exact original bytes back. Only the small fixed prefix common to every
 * item is decoded:
 *
 *   int16 registryID   // WorldDictionary item id, InventoryItem.java:1664
 *   int8  saveType     // always -1, InventoryItem.java:1665
 *   int32 id           // InventoryItem.java:1666
 *
 * The registryID -> "Base.Axe" mapping lives in `WorldDictionary.bin` in the
 * save folder, NOT in players.db, so item names cannot be resolved from this
 * file alone.
 */

/** Byte length of the decoded prefix (registryID + saveType + id). */
const ITEM_PREFIX_BYTES = 2 + 1 + 4;

export interface InventoryItemData {
    /** `dataLen` written by `saveWithSize`: number of bytes after the length itself. */
    dataLength: number;
    /** WorldDictionary registry id of the item type. */
    registryId: number;
    /** Always -1 in current builds. */
    saveType: number;
    /** Per-item unique id. */
    id: number;
    /**
     * Everything after the decoded prefix, kept verbatim. This is what makes
     * byte-exact round-tripping possible without decoding every item subclass.
     */
    body: Uint8Array;
}

export interface ItemGroupData {
    /** Run length: how many byte-identical items this group represents. */
    identical: number;
    item: InventoryItemData;
    /** `identical - 1` extra ids, one per duplicate. */
    duplicateIds: number[];
}

export interface ItemContainerData {
    type: string;
    explored: boolean;
    groups: ItemGroupData[];
    hasBeenLooted: boolean;
    capacity: number;
}

function readItem(reader: BinaryReader): InventoryItemData {
    const dataLength = reader.int32();
    if (dataLength <= 0) {
        // Matches the IOException thrown by InventoryItem.loadItem.
        throw new Error(`invalid item data length ${dataLength} at offset ${reader.position - 4}`);
    }
    if (dataLength < ITEM_PREFIX_BYTES) {
        throw new Error(`item data length ${dataLength} is too small to contain an item header`);
    }
    const registryId = reader.int16();
    const saveType = reader.int8();
    const id = reader.int32();
    const body = reader.bytesOf(dataLength - ITEM_PREFIX_BYTES);
    return { dataLength, registryId, saveType, id, body };
}

function writeItem(writer: BinaryWriter, item: InventoryItemData): void {
    writer.int32(ITEM_PREFIX_BYTES + item.body.length);
    writer.int16(item.registryId);
    writer.int8(item.saveType);
    writer.int32(item.id);
    writer.bytes(item.body);
}

export function readItemContainer(reader: BinaryReader): ItemContainerData {
    const type = reader.string();
    const explored = reader.bool();

    const groupCount = reader.int16();
    const groups: ItemGroupData[] = [];
    for (let i = 0; i < groupCount; i++) {
        const identical = reader.int32();
        const item = readItem(reader);
        const duplicateIds: number[] = [];
        for (let d = 1; d < identical; d++) {
            duplicateIds.push(reader.int32());
        }
        groups.push({ identical, item, duplicateIds });
    }

    const hasBeenLooted = reader.bool();
    const capacity = reader.int32();
    return { type, explored, groups, hasBeenLooted, capacity };
}

export function writeItemContainer(writer: BinaryWriter, data: ItemContainerData): void {
    writer.string(data.type);
    writer.bool(data.explored);

    writer.int16(data.groups.length);
    for (const group of data.groups) {
        writer.int32(group.identical);
        writeItem(writer, group.item);
        for (const id of group.duplicateIds) {
            writer.int32(id);
        }
    }

    writer.bool(data.hasBeenLooted);
    writer.int32(data.capacity);
}

/**
 * Flattens the run-length encoded groups into the list that
 * `CompressIdenticalItems.load` returns as `savedItems`, which is what
 * `IsoPlayer.savedInventoryItems` holds and what the worn-item / hand-item
 * short indices refer to (IsoPlayer.java:1268-1287).
 *
 * `IsoGameCharacter.load` instead indexes `inventory.includingObsoleteItems`
 * with int32s (IsoGameCharacter.java:5902-5910). Both lists have the same
 * contents and ordering unless an item type has been removed from the game, in
 * which case `savedItems`/`includingObsoleteItems` hold nulls in its place and
 * `ItemContainer.items` does not. Since this editor never drops items, the two
 * are always equivalent here.
 */
export function flattenItems(data: ItemContainerData): InventoryItemData[] {
    const flat: InventoryItemData[] = [];
    for (const group of data.groups) {
        for (let i = 0; i < group.identical; i++) {
            if (i === 0) {
                flat.push(group.item);
            } else {
                flat.push({ ...group.item, id: group.duplicateIds[i - 1] ?? group.item.id });
            }
        }
    }
    return flat;
}

/** Total number of items the player is carrying, expanding run-length groups. */
export function countItems(data: ItemContainerData): number {
    let total = 0;
    for (const group of data.groups) {
        total += group.identical;
    }
    return total;
}

/* ------------------------------------------------------------------------- */
/* Best-effort, display-only item header decoding.                            */
/*                                                                            */
/* Mirrors the start of InventoryItem.load(ByteBuffer, int)                    */
/* zombie/inventory/InventoryItem.java:1952                                    */
/*                                                                            */
/* This decodes ONLY the leading, subclass-independent portion of an item so   */
/* the UI can show something more useful than a registry id. It is never used  */
/* when writing: `writeItemContainer` always emits the original body bytes, so */
/* a wrong or failed decode here cannot corrupt a save.                        */
/* ------------------------------------------------------------------------- */

/** Outer `HeaderSize.Byte` bit header — InventoryItem.java:1666. */
const ITEM_FLAG_CURRENT_USES = 1;
const ITEM_FLAG_LEGACY = 2;
const ITEM_FLAG_CONDITION = 4;
const ITEM_FLAG_VISUAL = 8;
const ITEM_FLAG_CUSTOM_COLOR = 16;
const ITEM_FLAG_ITEM_CAPACITY = 32;
const ITEM_FLAG_EXTENDED = 64;

/** Extended `HeaderSize.Integer` bit header — InventoryItem.java:1699 onward. */
const ITEM_EXT_MOD_DATA = 1;
const ITEM_EXT_ACTIVATED = 2;
const ITEM_EXT_REPAIRED = 4;
const ITEM_EXT_CUSTOM_NAME_STRING = 8;

export interface ItemHeaderInfo {
    /** Set when every decoded field was read without error. */
    ok: boolean;
    currentUses: number;
    /** null when the item is at `conditionMax` (the flag is then absent). */
    condition: number | null;
    itemCapacity: number | null;
    activated: boolean;
    haveBeenRepaired: number;
    /** Custom (renamed) item name, when present. */
    customName: string | null;
    /** Raw outer header byte, useful in the advanced view. */
    headerFlags: number;
    /** Raw extended header int, or 0 when absent. */
    extendedFlags: number;
}

/**
 * Decodes as much of an item's common header as is safely possible.
 * Returns `ok: false` with whatever was decoded when the format diverges
 * (for example an unusual `ItemVisual`), rather than throwing.
 */
export function decodeItemHeader(item: InventoryItemData, worldVersion: number): ItemHeaderInfo {
    const info: ItemHeaderInfo = {
        ok: false,
        currentUses: 1,
        condition: null,
        itemCapacity: null,
        activated: false,
        haveBeenRepaired: 0,
        customName: null,
        headerFlags: 0,
        extendedFlags: 0,
    };

    try {
        const reader = new BinaryReader(item.body);
        const flags = reader.uint8();
        info.headerFlags = flags;

        if (flags & ITEM_FLAG_CURRENT_USES) {
            // Widened from int16 to int32 in worldVersion 220 (InventoryItem.java:1988).
            info.currentUses = worldVersion >= 220 ? reader.int32() : reader.int16();
        }
        if (flags & ITEM_FLAG_LEGACY && worldVersion < 220) {
            reader.int8();
        }
        if (flags & ITEM_FLAG_CONDITION) {
            info.condition = reader.int8();
        }
        if (flags & ITEM_FLAG_VISUAL) {
            readItemVisual(reader);
        }
        if (flags & ITEM_FLAG_CUSTOM_COLOR) {
            reader.bytesOf(4);
        }
        if (flags & ITEM_FLAG_ITEM_CAPACITY) {
            info.itemCapacity = reader.float32();
        }

        if (flags & ITEM_FLAG_EXTENDED) {
            const ext = reader.int32();
            info.extendedFlags = ext;
            info.activated = (ext & ITEM_EXT_ACTIVATED) !== 0;

            if (ext & ITEM_EXT_MOD_DATA) {
                readLuaTable(reader);
            }
            if (ext & ITEM_EXT_REPAIRED) {
                info.haveBeenRepaired = reader.int16();
            }
            if (ext & ITEM_EXT_CUSTOM_NAME_STRING) {
                info.customName = reader.string();
            }
            // Remaining extended fields are subclass/feature specific and are
            // deliberately not decoded; everything needed for display is above.
        }

        info.ok = true;
    } catch {
        info.ok = false;
    }

    return info;
}
