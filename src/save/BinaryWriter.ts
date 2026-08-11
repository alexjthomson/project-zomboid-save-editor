/**
 * Big-endian binary writer that mirrors `java.nio.ByteBuffer` writes used by
 * Project Zomboid's save code. See `BinaryReader` for the byte-order rationale.
 */

const UTF8_ENCODER = new TextEncoder();

/**
 * One entry in the structural trace produced while serializing. Because the
 * trace is emitted by the serializer itself (rather than a parallel
 * implementation) and the round-trip is byte exact, these offsets are also the
 * offsets of the corresponding fields in the original BLOB.
 */
export interface TraceNode {
    name: string;
    /** Primitive name (`int32`, `float32`, `string`, ...) or `block` for groups. */
    type: string;
    offset: number;
    size: number;
    value?: unknown;
    /** Decompiled source class/method that justifies the interpretation. */
    source?: string;
    /** e.g. "worldVersion >= 222". */
    condition?: string;
    children?: TraceNode[];
}

interface PendingLabel {
    name: string;
    source?: string;
    condition?: string;
}

/** Collects a nested field trace while the serializer runs. */
export class TraceCollector {
    readonly root: TraceNode = { name: 'players.db BLOB', type: 'block', offset: 0, size: 0, children: [] };
    private stack: TraceNode[] = [this.root];
    private pending: PendingLabel | null = null;
    private anonymous = 0;

    label(name: string, source?: string, condition?: string): void {
        this.pending = { name, source, condition };
    }

    beginScope(name: string, offset: number, source?: string, condition?: string): void {
        const node: TraceNode = { name, type: 'block', offset, size: 0, source, condition, children: [] };
        this.stack[this.stack.length - 1].children!.push(node);
        this.stack.push(node);
        this.pending = null;
    }

    endScope(offset: number): void {
        if (this.stack.length <= 1) return;
        const node = this.stack.pop()!;
        node.size = offset - node.offset;
    }

    record(type: string, offset: number, size: number, value: unknown): void {
        const label = this.pending;
        this.pending = null;
        const parent = this.stack[this.stack.length - 1];
        parent.children!.push({
            name: label?.name ?? `<unnamed ${this.anonymous++}>`,
            type,
            offset,
            size,
            value,
            source: label?.source,
            condition: label?.condition,
        });
    }

    finish(totalSize: number): TraceNode {
        while (this.stack.length > 1) this.endScope(totalSize);
        this.root.size = totalSize;
        return this.root;
    }
}

export class BinaryWriter {
    private buffer: Uint8Array;
    private view: DataView;
    private pos = 0;
    private tracer: TraceCollector | null = null;

    constructor(initialCapacity = 64 * 1024) {
        this.buffer = new Uint8Array(initialCapacity);
        this.view = new DataView(this.buffer.buffer);
    }

    get position(): number {
        return this.pos;
    }

    /** Enables structural tracing. Has no effect on the bytes produced. */
    setTracer(tracer: TraceCollector | null): this {
        this.tracer = tracer;
        return this;
    }

    /** Names the next primitive written. No-op when tracing is disabled. */
    label(name: string, source?: string, condition?: string): this {
        this.tracer?.label(name, source, condition);
        return this;
    }

    beginScope(name: string, source?: string, condition?: string): this {
        this.tracer?.beginScope(name, this.pos, source, condition);
        return this;
    }

    endScope(): this {
        this.tracer?.endScope(this.pos);
        return this;
    }

    private trace(type: string, start: number, value: unknown): void {
        this.tracer?.record(type, start, this.pos - start, value);
    }

    private ensure(count: number): number {
        const required = this.pos + count;
        if (required > this.buffer.length) {
            let capacity = this.buffer.length === 0 ? 1024 : this.buffer.length;
            while (capacity < required) {
                capacity *= 2;
            }
            const next = new Uint8Array(capacity);
            next.set(this.buffer.subarray(0, this.pos));
            this.buffer = next;
            this.view = new DataView(this.buffer.buffer);
        }
        const start = this.pos;
        this.pos += count;
        return start;
    }

    /** `ByteBuffer.put(byte)` — accepts signed or unsigned values. */
    int8(value: number): this {
        const start = this.ensure(1);
        this.view.setInt8(start, value << 24 >> 24);
        this.trace('int8', start, value);
        return this;
    }

    /** `output.put((byte)(flag ? 1 : 0))` */
    bool(value: boolean): this {
        const start = this.ensure(1);
        this.view.setInt8(start, value ? 1 : 0);
        this.trace('boolean', start, value);
        return this;
    }

    /** `ByteBuffer.putShort(short)` */
    int16(value: number): this {
        const start = this.ensure(2);
        this.view.setInt16(start, value << 16 >> 16, false);
        this.trace('int16', start, value);
        return this;
    }

    /** `ByteBuffer.putInt(int)` */
    int32(value: number): this {
        const start = this.ensure(4);
        this.view.setInt32(start, value | 0, false);
        this.trace('int32', start, value);
        return this;
    }

    /** `ByteBuffer.putLong(long)` */
    int64(value: bigint): this {
        const start = this.ensure(8);
        this.view.setBigInt64(start, BigInt.asIntN(64, value), false);
        this.trace('int64', start, value);
        return this;
    }

    /** `ByteBuffer.putFloat(float)` */
    float32(value: number): this {
        const start = this.ensure(4);
        this.view.setFloat32(start, value, false);
        this.trace('float32', start, value);
        return this;
    }

    /** `ByteBuffer.putDouble(double)` */
    float64(value: number): this {
        const start = this.ensure(8);
        this.view.setFloat64(start, value, false);
        this.trace('float64', start, value);
        return this;
    }

    /** `ByteBuffer.putChar(char)` — one big-endian UTF-16 code unit. */
    utf16Char(value: number): this {
        const start = this.ensure(2);
        this.view.setUint16(start, value & 0xffff, false);
        this.trace('char', start, value);
        return this;
    }

    bytes(value: Uint8Array): this {
        const start = this.ensure(value.length);
        this.buffer.set(value, start);
        this.trace('bytes', start, `${value.length} bytes`);
        return this;
    }

    /**
     * Mirrors `GameWindow.WriteString(ByteBuffer, String)`
     * -> `GameWindow.StringUTF.save(ByteBuffer, String)`
     * zombie/GameWindow.java:1111 and zombie/GameWindow.java:1265
     *
     * `null` and empty strings are both written as a zero length with no payload,
     * so they are indistinguishable in the file.
     */
    string(value: string | null | undefined): this {
        const tracer = this.tracer;
        this.tracer = null;
        const start = this.pos;
        if (value === null || value === undefined || value.length === 0) {
            this.int16(0);
        } else {
            const encoded = UTF8_ENCODER.encode(value);
            this.int16(encoded.length);
            this.bytes(encoded);
        }
        this.tracer = tracer;
        this.trace('string', start, value ?? '');
        return this;
    }

    /** Writes each UTF-16 code unit with `putChar`, as `PlayerCraftHistory.save` does. */
    utf16String(value: string): this {
        const tracer = this.tracer;
        this.tracer = null;
        const start = this.pos;
        for (let i = 0; i < value.length; i++) {
            this.utf16Char(value.charCodeAt(i));
        }
        this.tracer = tracer;
        this.trace('utf16String', start, value);
        return this;
    }

    toUint8Array(): Uint8Array {
        return this.buffer.slice(0, this.pos);
    }
}
