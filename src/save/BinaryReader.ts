/**
 * Big-endian binary reader that mirrors the semantics of `java.nio.ByteBuffer`
 * as used throughout Project Zomboid's save code.
 *
 * Java's ByteBuffer defaults to `ByteOrder.BIG_ENDIAN`, and Project Zomboid
 * never calls `order(...)` on the buffers it uses for player serialization,
 * so every multi-byte primitive in the player BLOB is big-endian.
 */

const UTF8_DECODER = new TextDecoder('utf-8');

export class BinaryReadError extends Error {
    readonly offset: number;

    constructor(message: string, offset: number) {
        super(message);
        this.name = 'BinaryReadError';
        this.offset = offset;
    }
}

export class BinaryReader {
    readonly bytes: Uint8Array;
    private readonly view: DataView;
    private pos: number;

    constructor(bytes: Uint8Array, position = 0) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.pos = position;
    }

    get position(): number {
        return this.pos;
    }

    set position(value: number) {
        if (value < 0 || value > this.bytes.length) {
            throw new BinaryReadError(`position ${value} out of bounds`, this.pos);
        }
        this.pos = value;
    }

    get length(): number {
        return this.bytes.length;
    }

    get remaining(): number {
        return this.bytes.length - this.pos;
    }

    get eof(): boolean {
        return this.pos >= this.bytes.length;
    }

    private require(count: number): number {
        if (count < 0 || this.pos + count > this.bytes.length) {
            throw new BinaryReadError(
                `unexpected end of buffer: needed ${count} byte(s) at offset ${this.pos}, only ${this.remaining} remaining`,
                this.pos,
            );
        }
        const start = this.pos;
        this.pos += count;
        return start;
    }

    /** `ByteBuffer.get()` — signed 8-bit. */
    int8(): number {
        return this.view.getInt8(this.require(1));
    }

    /** `ByteBuffer.get()` reinterpreted as unsigned, e.g. `input.get() & 255`. */
    uint8(): number {
        return this.view.getUint8(this.require(1));
    }

    /** `input.get() != 0` */
    bool(): boolean {
        return this.int8() !== 0;
    }

    /** `ByteBuffer.getShort()` — signed 16-bit. */
    int16(): number {
        return this.view.getInt16(this.require(2), false);
    }

    uint16(): number {
        return this.view.getUint16(this.require(2), false);
    }

    /** `ByteBuffer.getInt()` — signed 32-bit. */
    int32(): number {
        return this.view.getInt32(this.require(4), false);
    }

    uint32(): number {
        return this.view.getUint32(this.require(4), false);
    }

    /** `ByteBuffer.getLong()` — signed 64-bit. */
    int64(): bigint {
        return this.view.getBigInt64(this.require(8), false);
    }

    /** `ByteBuffer.getFloat()` — IEEE-754 binary32. */
    float32(): number {
        return this.view.getFloat32(this.require(4), false);
    }

    /** `ByteBuffer.getDouble()` — IEEE-754 binary64. */
    float64(): number {
        return this.view.getFloat64(this.require(8), false);
    }

    /** `ByteBuffer.getChar()` — a single UTF-16 code unit, big-endian. */
    utf16Char(): number {
        return this.view.getUint16(this.require(2), false);
    }

    bytesOf(count: number): Uint8Array {
        const start = this.require(count);
        return this.bytes.subarray(start, start + count);
    }

    /**
     * Mirrors `GameWindow.ReadString(ByteBuffer)`
     * -> `GameWindow.StringUTF.load(ByteBuffer)`
     * zombie/GameWindow.java:1126 and zombie/GameWindow.java:1279
     *
     * Layout: int16 byte-length (<= 0 means empty string) followed by that many
     * UTF-8 bytes. Note the length is the *byte* count, not the character count.
     */
    string(): string {
        const numBytes = this.int16();
        if (numBytes <= 0) {
            return '';
        }
        return UTF8_DECODER.decode(this.bytesOf(numBytes));
    }

    /**
     * Reads `count` UTF-16 code units written with `ByteBuffer.putChar`.
     * Used by `PlayerCraftHistory.save/load`.
     */
    utf16String(count: number): string {
        let result = '';
        for (let i = 0; i < count; i++) {
            result += String.fromCharCode(this.utf16Char());
        }
        return result;
    }
}
