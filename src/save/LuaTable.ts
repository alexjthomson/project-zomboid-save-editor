import type { BinaryReader } from './BinaryReader';
import type { BinaryWriter } from './BinaryWriter';

/**
 * Serialization of the Lua `modData` table attached to every `IsoObject`.
 *
 * Mirrors `se.krka.kahlua.j2se.KahluaTableImpl.save(ByteBuffer)` /
 * `KahluaTableImpl.load(ByteBuffer, int)`, decompiled from
 * `projectzomboid.jar` (the class lives in the bundled Kahlua VM rather than
 * the `zombie` package, so it is not present in the decompiled `zombie` tree).
 *
 * Layout (worldVersion >= 25, which covers every build we support):
 *   int32 entryCount
 *   entryCount * { keyTypeByte key ; valueTypeByte value }
 *
 * Type bytes (KahluaTableImpl.getKeyByte / getValueByte):
 *   0 = String  (GameWindow string)
 *   1 = Double  (float64)
 *   2 = Table   (nested, recursive)
 *   3 = Boolean (int8, keys can never be booleans)
 *
 * Entries whose key or value is not one of the supported types are silently
 * dropped by the game when saving (`KahluaTableImpl.canSave`), which is why the
 * count is computed up front rather than taken from the table size.
 */

export const LUA_TYPE_STRING = 0;
export const LUA_TYPE_DOUBLE = 1;
export const LUA_TYPE_TABLE = 2;
export const LUA_TYPE_BOOLEAN = 3;

export type LuaValue = string | number | boolean | LuaTable;

export interface LuaEntry {
    keyType: number;
    key: string | number;
    valueType: number;
    value: LuaValue;
}

export interface LuaTable {
    entries: LuaEntry[];
}

export function readLuaTable(reader: BinaryReader): LuaTable {
    const count = reader.int32();
    if (count < 0) {
        throw new Error(`invalid lua table entry count ${count}`);
    }
    const entries: LuaEntry[] = [];
    for (let i = 0; i < count; i++) {
        const keyType = reader.int8();
        const key = readLuaValue(reader, keyType);
        const valueType = reader.int8();
        const value = readLuaValue(reader, valueType);
        if (typeof key !== 'string' && typeof key !== 'number') {
            throw new Error(`invalid lua table key type ${keyType}`);
        }
        entries.push({ keyType, key, valueType, value });
    }
    return { entries };
}

function readLuaValue(reader: BinaryReader, type: number): LuaValue {
    switch (type) {
        case LUA_TYPE_STRING:
            return reader.string();
        case LUA_TYPE_DOUBLE:
            return reader.float64();
        case LUA_TYPE_BOOLEAN:
            return reader.bool();
        case LUA_TYPE_TABLE:
            return readLuaTable(reader);
        default:
            throw new Error(`invalid lua table type ${type}`);
    }
}

export function writeLuaTable(writer: BinaryWriter, table: LuaTable): void {
    writer.int32(table.entries.length);
    for (const entry of table.entries) {
        writer.int8(entry.keyType);
        writeLuaValue(writer, entry.keyType, entry.key);
        writer.int8(entry.valueType);
        writeLuaValue(writer, entry.valueType, entry.value);
    }
}

function writeLuaValue(writer: BinaryWriter, type: number, value: LuaValue): void {
    switch (type) {
        case LUA_TYPE_STRING:
            writer.string(value as string);
            break;
        case LUA_TYPE_DOUBLE:
            writer.float64(value as number);
            break;
        case LUA_TYPE_BOOLEAN:
            writer.bool(value as boolean);
            break;
        case LUA_TYPE_TABLE:
            writeLuaTable(writer, value as LuaTable);
            break;
        default:
            throw new Error(`invalid lua table type ${type}`);
    }
}

/** Convenience view of a Lua table as a plain JS object, for display only. */
export function luaTableToPlain(table: LuaTable): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const entry of table.entries) {
        const key = String(entry.key);
        result[key] =
            entry.valueType === LUA_TYPE_TABLE ? luaTableToPlain(entry.value as LuaTable) : entry.value;
    }
    return result;
}
