import { PlayersDatabase, type PlayerRecord, type DatabaseInfo } from '../save/PlayersDatabase';
import {
    parsePlayerBlob,
    serializePlayerBlob,
    tryParsePlayerBlob,
    type PlayerBlob,
} from '../save/PlayerBlobCodec';
import { getVersionSupport, type VersionSupport } from '../save/SaveVersion';

/**
 * Editor state. Every player keeps its pristine BLOB and a working copy of the
 * parsed model, so any edit can be undone without re-reading the file.
 */
export interface PlayerSession {
    record: PlayerRecord;
    /** Never mutated — the bytes exactly as they were read from the file. */
    readonly originalBlob: Uint8Array;
    /** Death flag as it was read from the SQL row. */
    readonly originalIsDead: boolean;
    /** Freshly parsed from `originalBlob`; used as the diff baseline. */
    readonly original: PlayerBlob | null;
    /** The editable model, or null when the BLOB could not be parsed. */
    working: PlayerBlob | null;
    /** Working copy of the SQL death flag. */
    isDead: boolean;
    parseError: Error | null;
    parseErrorOffset: number | null;
    /**
     * True when the unmodified BLOB parsed completely and re-serialized to the
     * exact original bytes. Editing is refused otherwise: a layout this parser
     * only partly understands would be rewritten wrongly.
     */
    readonly roundTripOk: boolean;
    versionSupport: VersionSupport;
}

export class EditorState {
    db: PlayersDatabase | null = null;
    info: DatabaseInfo | null = null;
    fileName = '';
    fileSize = 0;
    sessions: PlayerSession[] = [];
    selectedIndex = 0;
    activeTab = 'general';

    get selected(): PlayerSession | null {
        return this.sessions[this.selectedIndex] ?? null;
    }

    async open(bytes: Uint8Array, fileName: string, locateFile: (f: string) => string): Promise<void> {
        const db = await PlayersDatabase.open(bytes, locateFile);
        this.close();
        this.db = db;
        this.info = db.describe();
        this.fileName = fileName;
        this.fileSize = bytes.length;
        this.selectedIndex = 0;

        this.sessions = db.listPlayers().map((record) => {
            const result = tryParsePlayerBlob(record.data, record.worldVersion);
            const roundTripOk =
                result.player !== null &&
                result.player.trailingBytes.length === 0 &&
                bytesEqual(serializePlayerBlob(result.player, record.worldVersion), record.data);
            return {
                record,
                originalBlob: record.data.slice(),
                originalIsDead: record.isDead,
                original: result.player,
                working: result.player ? parsePlayerBlob(record.data, record.worldVersion) : null,
                isDead: record.isDead,
                parseError: result.error,
                parseErrorOffset: result.errorOffset,
                roundTripOk,
                versionSupport: getVersionSupport(record.worldVersion),
            };
        });
    }

    close(): void {
        this.db?.close();
        this.db = null;
        this.info = null;
        this.sessions = [];
        this.fileName = '';
        this.fileSize = 0;
    }

    /** True when this character may be edited and written back. */
    isEditable(session: PlayerSession): boolean {
        return (
            session.working !== null &&
            session.roundTripOk &&
            session.versionSupport.level !== 'unsupported'
        );
    }

    /**
     * Serializes the working model, or returns the untouched original when the
     * BLOB is unparsed or failed round-trip verification.
     */
    currentBlob(session: PlayerSession): Uint8Array {
        if (!session.working || !session.roundTripOk) return session.originalBlob;
        return serializePlayerBlob(session.working, session.record.worldVersion);
    }

    isModified(session: PlayerSession): boolean {
        if (session.isDead !== session.originalIsDead) return true;
        if (!session.working) return false;
        return !bytesEqual(this.currentBlob(session), session.originalBlob);
    }

    get modifiedCount(): number {
        return this.sessions.filter((s) => this.isModified(s)).length;
    }

    resetPlayer(session: PlayerSession): void {
        session.working = session.original
            ? parsePlayerBlob(session.originalBlob, session.record.worldVersion)
            : null;
        session.isDead = session.originalIsDead;
    }

    resetAll(): void {
        for (const session of this.sessions) {
            this.resetPlayer(session);
        }
    }

    /**
     * Writes every modified player back into the in-memory SQLite database and
     * exports it. The original file on disk is never touched.
     */
    export(): Uint8Array {
        if (!this.db) throw new Error('no database is open');
        for (const session of this.sessions) {
            if (!this.isModified(session)) continue;
            const blob = this.currentBlob(session);
            const record: PlayerRecord = {
                ...session.record,
                data: blob,
                isDead: session.isDead,
            };
            if (session.working && session.roundTripOk) {
                // Keep the indexed coordinate and name columns consistent with the
                // BLOB, exactly as ServerPlayerDB.saveNetworkCharacter does.
                record.x = session.working.movingObject.x;
                record.y = session.working.movingObject.y;
                record.z = session.working.movingObject.z;
                if (record.table === 'localPlayers') {
                    // Chunk coordinates, floor(x / 8); stale values would point the
                    // game at the chunk the character used to stand in.
                    record.wx = Math.floor(record.x / 8);
                    record.wy = Math.floor(record.y / 8);
                }
                if (session.working.descriptor) {
                    const { forename, surname } = session.working.descriptor;
                    record.name = `${forename} ${surname}`.trim();
                }
            }
            this.db.updatePlayer(record);
            session.record = record;
        }
        return this.db.export();
    }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
