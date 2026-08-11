import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

/**
 * Browser-side access to Project Zomboid's `players.db`.
 *
 * Everything happens in memory via sql.js (SQLite compiled to WebAssembly);
 * the file is never uploaded anywhere.
 *
 * Schema (created by `PlayerDBHelper.create()`,
 * zombie/savefile/PlayerDBHelper.java:38-43):
 *
 *   CREATE TABLE localPlayers (
 *     id INTEGER PRIMARY KEY NOT NULL, name STRING, wx INTEGER, wy INTEGER,
 *     x FLOAT, y FLOAT, z FLOAT, worldversion INTEGER, data BLOB, isDead BOOLEAN);
 *
 *   CREATE TABLE networkPlayers (
 *     id INTEGER PRIMARY KEY NOT NULL, world TEXT, username TEXT,
 *     playerIndex INTEGER, name STRING, steamid STRING, x FLOAT, y FLOAT,
 *     z FLOAT, worldversion INTEGER, data BLOB, isDead BOOLEAN);
 *
 *   CREATE INDEX inpusername ON networkPlayers (username);
 *
 * `localPlayers` holds single-player characters (one row per character slot),
 * `networkPlayers` holds multiplayer characters keyed by world + username or
 * steamid + playerIndex.
 */

export type PlayerTable = 'localPlayers' | 'networkPlayers';

export interface PlayerRecord {
    table: PlayerTable;
    /** `id` primary key of the row. */
    id: number;
    /** Character display name, e.g. "Alex Thomson". */
    name: string | null;
    /** networkPlayers only: the save/world name, e.g. "B42". */
    world: string | null;
    /** networkPlayers only: the multiplayer account username. */
    username: string | null;
    /** networkPlayers only: 0-3, which of the player's character slots this is. */
    playerIndex: number | null;
    /** networkPlayers only. */
    steamid: string | null;
    /** localPlayers only: world cell coordinates (floor(x / 8)). */
    wx: number | null;
    wy: number | null;
    x: number;
    y: number;
    z: number;
    /**
     * The `worldversion` used to serialize `data`. This is what gets passed to
     * `IsoPlayer.load(ByteBuffer, int worldVersion)`; the BLOB has no embedded
     * version of its own.
     */
    worldVersion: number;
    /**
     * THE authoritative persistent death flag. `PlayerDB.loadPlayer` and
     * `ServerPlayerDB.serverLoadNetworkCharacter` both do:
     *
     *   if (isDead) { player.getBodyDamage().setOverallBodyHealth(0); player.setHealth(0); }
     *
     * immediately after `player.load(...)`, so a character with this set will be
     * dead no matter what the BLOB contains.
     * zombie/savefile/PlayerDB.java:244, zombie/savefile/ServerPlayerDB.java:279
     */
    isDead: boolean;
    /** The serialized `IsoPlayer` BLOB. */
    data: Uint8Array;
}

export interface TableInfo {
    name: string;
    sql: string;
    columns: Array<{ name: string; type: string; notNull: boolean; primaryKey: boolean }>;
    rowCount: number;
}

export interface DatabaseInfo {
    tables: TableInfo[];
    indexes: Array<{ name: string; table: string; sql: string | null }>;
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

export type WasmLocator = (file: string) => string;

/** Overridable so tests (node) and the browser build can each find sql-wasm.wasm. */
export function initSqlEngine(locateFile?: WasmLocator): Promise<SqlJsStatic> {
    if (!sqlPromise) {
        sqlPromise = initSqlJs(locateFile ? { locateFile } : undefined);
    }
    return sqlPromise;
}

export class PlayersDatabaseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PlayersDatabaseError';
    }
}

export class PlayersDatabase {
    private readonly db: Database;
    readonly tables: PlayerTable[];

    private constructor(db: Database, tables: PlayerTable[]) {
        this.db = db;
        this.tables = tables;
    }

    static async open(bytes: Uint8Array, locateFile?: WasmLocator): Promise<PlayersDatabase> {
        const SQL = await initSqlEngine(locateFile);
        let db: Database;
        try {
            db = new SQL.Database(bytes);
        } catch (error) {
            throw new PlayersDatabaseError(
                `This file is not a valid SQLite database (${(error as Error).message}).`,
            );
        }

        let names: string[];
        try {
            names = queryStrings(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
        } catch (error) {
            db.close();
            throw new PlayersDatabaseError(
                `This file is not a valid SQLite database (${(error as Error).message}).`,
            );
        }

        const tables: PlayerTable[] = [];
        if (names.includes('localPlayers')) tables.push('localPlayers');
        if (names.includes('networkPlayers')) tables.push('networkPlayers');
        if (tables.length === 0) {
            db.close();
            throw new PlayersDatabaseError(
                'This SQLite database has no localPlayers or networkPlayers table, so it is not a ' +
                    'Project Zomboid players.db file.',
            );
        }
        return new PlayersDatabase(db, tables);
    }

    close(): void {
        this.db.close();
    }

    /** Full schema dump, used by the database inspector view. */
    describe(): DatabaseInfo {
        const tables: TableInfo[] = [];
        const master = this.db.exec(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name",
        );
        if (master.length > 0) {
            for (const row of master[0].values) {
                const name = String(row[0]);
                const sql = String(row[1] ?? '');
                const columns: TableInfo['columns'] = [];
                const info = this.db.exec(`PRAGMA table_info("${name.replace(/"/g, '""')}")`);
                if (info.length > 0) {
                    for (const col of info[0].values) {
                        columns.push({
                            name: String(col[1]),
                            type: String(col[2] ?? ''),
                            notNull: Number(col[3]) !== 0,
                            primaryKey: Number(col[5]) !== 0,
                        });
                    }
                }
                let rowCount = 0;
                const count = this.db.exec(`SELECT COUNT(*) FROM "${name.replace(/"/g, '""')}"`);
                if (count.length > 0) {
                    rowCount = Number(count[0].values[0][0]);
                }
                tables.push({ name, sql, columns, rowCount });
            }
        }

        const indexes: DatabaseInfo['indexes'] = [];
        const idx = this.db.exec(
            "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name",
        );
        if (idx.length > 0) {
            for (const row of idx[0].values) {
                indexes.push({
                    name: String(row[0]),
                    table: String(row[1]),
                    sql: row[2] === null ? null : String(row[2]),
                });
            }
        }
        return { tables, indexes };
    }

    listPlayers(): PlayerRecord[] {
        const records: PlayerRecord[] = [];
        for (const table of this.tables) {
            const isNetwork = table === 'networkPlayers';
            const columns = isNetwork
                ? 'id, world, username, playerIndex, name, steamid, x, y, z, worldversion, data, isDead'
                : 'id, name, wx, wy, x, y, z, worldversion, data, isDead';
            const stmt = this.db.prepare(`SELECT ${columns} FROM ${table} ORDER BY id`);
            try {
                while (stmt.step()) {
                    const row = stmt.getAsObject();
                    records.push({
                        table,
                        id: Number(row.id),
                        name: asStringOrNull(row.name),
                        world: isNetwork ? asStringOrNull(row.world) : null,
                        username: isNetwork ? asStringOrNull(row.username) : null,
                        playerIndex: isNetwork ? asNumberOrNull(row.playerIndex) : null,
                        steamid: isNetwork ? asStringOrNull(row.steamid) : null,
                        wx: isNetwork ? null : asNumberOrNull(row.wx),
                        wy: isNetwork ? null : asNumberOrNull(row.wy),
                        x: Number(row.x ?? 0),
                        y: Number(row.y ?? 0),
                        z: Number(row.z ?? 0),
                        worldVersion: Number(row.worldversion ?? 0),
                        isDead: Number(row.isDead ?? 0) !== 0,
                        data: asBytes(row.data),
                    });
                }
            } finally {
                stmt.free();
            }
        }
        return records;
    }

    /**
     * Writes a modified player row back. Mirrors the columns the game itself
     * updates in `PlayerDB.SQLPlayerStore.update` (localPlayers) and
     * `ServerPlayerDB.serverUpdateNetworkCharacterInt` (networkPlayers), so the
     * denormalised x/y/z/isDead columns stay consistent with the BLOB.
     */
    updatePlayer(record: PlayerRecord): void {
        if (record.table === 'networkPlayers') {
            const stmt = this.db.prepare(
                'UPDATE networkPlayers SET x = ?, y = ?, z = ?, worldversion = ?, isDead = ?, data = ?, name = ? WHERE id = ?',
            );
            try {
                stmt.run([
                    record.x,
                    record.y,
                    record.z,
                    record.worldVersion,
                    record.isDead ? 1 : 0,
                    record.data,
                    record.name,
                    record.id,
                ]);
            } finally {
                stmt.free();
            }
        } else {
            const stmt = this.db.prepare(
                'UPDATE localPlayers SET wx = ?, wy = ?, x = ?, y = ?, z = ?, worldversion = ?, data = ?, isDead = ?, name = ? WHERE id = ?',
            );
            try {
                stmt.run([
                    record.wx ?? Math.floor(record.x / 8),
                    record.wy ?? Math.floor(record.y / 8),
                    record.x,
                    record.y,
                    record.z,
                    record.worldVersion,
                    record.data,
                    record.isDead ? 1 : 0,
                    record.name,
                    record.id,
                ]);
            } finally {
                stmt.free();
            }
        }
    }

    /** Serializes the in-memory database back to a `players.db` file image. */
    export(): Uint8Array {
        return this.db.export();
    }
}

function queryStrings(db: Database, sql: string): string[] {
    const result = db.exec(sql);
    if (result.length === 0) return [];
    return result[0].values.map((row) => String(row[0]));
}

function asStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return String(value);
}

function asNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    return Number(value);
}

function asBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value;
    if (value === null || value === undefined) return new Uint8Array(0);
    if (Array.isArray(value)) return Uint8Array.from(value as number[]);
    throw new PlayersDatabaseError('player data column is not a BLOB');
}
