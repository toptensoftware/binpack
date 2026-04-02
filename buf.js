// Browser-compatible Buffer shim.
//
// Extends Uint8Array with the Node.js Buffer methods used by index.js so the
// core library runs unmodified in a browser.  Import and use in place of the
// Node.js Buffer global.
//
// Covered API surface:
//   Static:   alloc, from, concat, isBuffer
//   Instance: copy, subarray, toString, indexOf
//   Reads:    readUInt8/16/32LE, readInt8/16/32LE,
//             readBigUInt64LE, readBigInt64LE,
//             readFloatLE, readUFloatLE (typo-alias), readDoubleLE
//   Writes:   writeUInt8/16/32LE, writeInt8/16/32LE,
//             writeBigUInt64LE, writeBigInt64LE,
//             writeFloatLE, writeDoubleLE

class Buf extends Uint8Array {

    // DataView over this buffer's slice of the backing ArrayBuffer.
    // Accounts for byteOffset so subarray() views work correctly.
    get _view() {
        return new DataView(this.buffer, this.byteOffset, this.byteLength);
    }

    // -------------------------------------------------------------------------
    // Static factories
    // -------------------------------------------------------------------------

    static alloc(size) {
        return new Buf(size);
    }

    // Accepts: string (+ optional encoding), Array/array-like, or Uint8Array.
    // Always returns a copy, matching Node.js Buffer.from() semantics.
    static from(value, encoding) {
        if (typeof value === 'string') {
            const bytes = new TextEncoder().encode(value);
            const b = new Buf(bytes.length);
            b.set(bytes);
            return b;
        }
        const b = new Buf(value.length);
        b.set(value);
        return b;
    }

    static concat(list) {
        const total = list.reduce((n, b) => n + b.length, 0);
        const result = new Buf(total);
        let offset = 0;
        for (const b of list) {
            result.set(b, offset);
            offset += b.length;
        }
        return result;
    }

    // Only Buf instances are considered "buffers" so that value.copy() is
    // always available when Buffer.isBuffer(value) returns true.
    static isBuffer(value) {
        return value instanceof Buf;
    }

    // -------------------------------------------------------------------------
    // Instance methods
    // -------------------------------------------------------------------------

    copy(target, targetStart = 0) {
        target.set(this, targetStart);
    }

    // Returns a Buf *view* (no copy) into the same backing ArrayBuffer,
    // correctly handling any existing byteOffset.
    subarray(begin = 0, end = this.length) {
        if (begin < 0) begin = Math.max(0, this.length + begin);
        if (end < 0)   end   = Math.max(0, this.length + end);
        begin = Math.min(begin, this.length);
        end   = Math.min(Math.max(begin, end), this.length);
        return new Buf(this.buffer, this.byteOffset + begin, end - begin);
    }

    toString(encoding = 'utf8', start = 0, end = this.length) {
        return new TextDecoder(encoding).decode(this.subarray(start, end));
    }

    indexOf(byte, offset = 0) {
        for (let i = offset; i < this.length; i++) {
            if (this[i] === byte) return i;
        }
        return -1;
    }

    // -------------------------------------------------------------------------
    // Read methods
    // -------------------------------------------------------------------------

    readUInt8(offset)       { return this._view.getUint8(offset); }
    readUInt16LE(offset)    { return this._view.getUint16(offset, true); }
    readUInt32LE(offset)    { return this._view.getUint32(offset, true); }
    readBigUInt64LE(offset) { return this._view.getBigUint64(offset, true); }

    readInt8(offset)        { return this._view.getInt8(offset); }
    readInt16LE(offset)     { return this._view.getInt16(offset, true); }
    readInt32LE(offset)     { return this._view.getInt32(offset, true); }
    readBigInt64LE(offset)  { return this._view.getBigInt64(offset, true); }

    readFloatLE(offset)     { return this._view.getFloat32(offset, true); }
    readDoubleLE(offset)    { return this._view.getFloat64(offset, true); }

    // -------------------------------------------------------------------------
    // Write methods
    // -------------------------------------------------------------------------

    writeUInt8(value, offset)       { this._view.setUint8(offset, value); }
    writeUInt16LE(value, offset)    { this._view.setUint16(offset, value, true); }
    writeUInt32LE(value, offset)    { this._view.setUint32(offset, value, true); }
    writeBigUInt64LE(value, offset) { this._view.setBigUint64(offset, value, true); }

    writeInt8(value, offset)        { this._view.setInt8(offset, value); }
    writeInt16LE(value, offset)     { this._view.setInt16(offset, value, true); }
    writeInt32LE(value, offset)     { this._view.setInt32(offset, value, true); }
    writeBigInt64LE(value, offset)  { this._view.setBigInt64(offset, value, true); }

    writeFloatLE(value, offset)     { this._view.setFloat32(offset, value, true); }
    writeDoubleLE(value, offset)    { this._view.setFloat64(offset, value, true); }
}

export { Buf as Buffer };
