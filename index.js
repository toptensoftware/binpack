let buildInTypes = 
[
    {
        name: "length",
        cname: "uint32_t",
        length: 4,
        meta: true,
        cfieldprefix: "len_",
        pack: (ctx, v) => ctx.buf.writeUInt32LE(v?.length ?? 0, ctx.offset),
        unpack: (ctx) => ctx.buf.readUInt32LE(ctx.offset),
    },

    { 
        name: "bool",
        length: 1,
        pack: (ctx, v) => ctx.buf.writeInt8(v ? 1 : 0, ctx.offset),
        unpack: (ctx) => ctx.buf.readInt8(ctx.offset) != 0,
    },
    {
        name: "sbyte",
        cname: "int8_t",
        length: 1,
        pack: (ctx, v) => ctx.buf.writeInt8(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readInt8(ctx.offset),
    },
    {
        name: "byte",
        cname: "uint8_t",
        length: 1,
        pack: (ctx, v) => ctx.buf.writeUInt8(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readUInt8(ctx.offset),
    },
    {
        name: "short",
        cname: "int16_t",
        length: 2,
        pack: (ctx, v) => ctx.buf.writeInt16LE(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readInt16LE(ctx.offset),
    },
    {
        name: "ushort",
        cname: "uint16_t",
        length: 2,
        pack: (ctx, v) => ctx.buf.writeUInt16LE(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readUInt16LE(ctx.offset),
    },
    {
        name: "int",
        cname: "int32_t",
        length: 4,
        pack: (ctx, v) => ctx.buf.writeInt32LE(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readInt32LE(ctx.offset),
    },
    {
        name: "uint",
        cname: "uint32_t",
        length: 4,
        pack: (ctx, v) => ctx.buf.writeUInt32LE(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readUInt32LE(ctx.offset),
    },
    {
        name: "long",
        cname: "int64_t",
        length: 8,
        pack: (ctx, v) => ctx.buf.writeBigInt64LE(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readBigInt64LE(ctx.offset),
    },
    {
        name: "ulong", 
        cname: "uint64_t",
        length: 8,
        pack: (ctx, v) => ctx.buf.writeUBigInt64LE(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readBigUInt64LE(ctx.offset),
    },
    {
        name: "float",
        cname: "float",
        length: 4,
        pack: (ctx, v) => ctx.buf.writeFloatLE(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readUFloatLE(ctx.offset),
    },
    {
        name: "double",
        cname: "double",
        length: 8,
        pack: (ctx, v) => ctx.buf.writeDoubleLE(v, ctx.offset),
        unpack: (ctx) => ctx.buf.readDoubleLE(ctx.offset),
    },
    {
        name: "string",
        cname: "const char*",
        length: 4,  // updated by enable64BitMode()
        pack: (ctx, v) => {
            if (v === null || v === undefined) {
                writePointer(ctx.buf, 0, ctx.offset);
                return;
            }
            let id = ctx.allocateString(v);
            writePointer(ctx.buf, id, ctx.offset);
            ctx.registerBlobRef(ctx.offset);
        },
        unpack: (ctx) => {
            let ptr = readPointer(ctx.buf, ctx.offset);
            if (ptr === 0) return null;
            return ctx.readString(ptr, ctx.length);
        },
    }
];

// Map of type name to type
let typeMap = new Map();

// Current pointer size in bytes (4 for 32-bit targets, 8 for 64-bit targets).
// Change via enable64BitMode().
let ptrSize = 4;

// Write a pointer value into buf at offset.  The value is always a 32-bit
// offset (we don't need > 4 GB address spaces), but in 64-bit mode the field
// is 8 bytes wide so we zero-fill the upper half.
function writePointer(buf, value, offset)
{
    buf.writeUInt32LE(value, offset);
    if (ptrSize === 8)
        buf.writeUInt32LE(0, offset + 4);
}

// Read a pointer field.  The value always fits in 32 bits; we only read the
// lower half regardless of ptrSize.
function readPointer(buf, offset)
{
    return buf.readUInt32LE(offset);
}

// Register build in types
for (let t of buildInTypes)
    registerType(t);

// Register custom types
export function registerType(def)
{
    if (typeMap.has(def.name))
        throw new Error(`Type '${def.name}' already registered`)
    typeMap.set(def.name, def);
}

// Switch between 32-bit (default) and 64-bit pointer mode.
// Pointers and string-pointer fields occupy 4 bytes in 32-bit mode and
// 8 bytes in 64-bit mode.  Values are always ≤ 32-bit offsets; the upper
// half is zeroed in 64-bit mode.
// Calling this function invalidates all cached struct layouts so they are
// recomputed with the new pointer size on next use.
export function enable64BitMode(enabled)
{
    let newPtrSize = enabled ? 8 : 4;
    if (newPtrSize === ptrSize) return;
    ptrSize = newPtrSize;

    // Update the string built-in's field width
    typeMap.get('string').length = ptrSize;

    // Invalidate all cached struct layouts
    for (let t of typeMap.values())
    {
        if (!t.fields) continue;
        delete t.length;
        delete t.baseType;
        delete t._computing;
        for (let field of t.fields)
        {
            delete field.offset;
            if (field._type !== undefined)
                field.type = field._type;
        }
    }
}

function align(value, align)
{
    if ((value % align) != 0)
        value += (align - value % align);
    return value;
}

// Find a type definition
export function findType(type)
{
    if (typeof(type) === 'string')
    {
        let name = type;
        if (type.endsWith("*"))
        {
            let t = findType(type.substring(0, type.length - 1));
            return {
                reference: t,
                length: ptrSize,
                cname: t.cname + "*",
            }
        }

        if (type.endsWith("[]"))
        {
            let t = findType(type.substring(0, type.length - 2));
            return {
                array: t,
                cname: t.cname,
            }
        }

        let m = type.match(/(.*)\[(\d+)\]$/);
        if (m)
        {
            let t = findType(m[1]);
            let fixedLength = parseInt(m[2]);
            return {
                array: t,
                fixedLength,
                length: fixedLength * t.length,
                cname: t.cname,
            }
        }


        type = typeMap.get(type);
        if (!type)
            throw new Error(`Unknown type '${name}'`);
    }

    // Struct?
    if (type.fields && type.length === undefined)
    {
        // Guard against self-referential types: if we encounter this type
        // again while laying it out (via a pointer field), return the
        // partially-constructed object — pointer wrappers hardcode length:4
        // so they don't need the struct's length to be set yet.
        if (type._computing) return type;
        type._computing = true;

        // Pre-pass: collect field names that have a "length" meta-type so that
        // a plain pointer "T*" on the same field name can be treated as "T[]*".
        let hasLengthMeta = new Set();
        for (let field of type.fields)
        {
            let rawType = typeof field.type === 'string' ? field.type : (field.type?.name ?? '');
            if (rawType === 'length')
                hasLengthMeta.add(field.name);
        }

        // Derived types: lay out own fields after the base type
        let startOffset = 0;
        if (type.extends)
        {
            type.baseType = findType(type.extends);
            startOffset = type.baseType.length;
        }

        // Layout own fields
        let offset = startOffset;
        let pack = type.pack ?? type.baseType?.pack ?? 4;
        for (let field of type.fields)
        {
            field.offset = offset;
            // Save original type string/object so enable64BitMode() can
            // restore it when invalidating cached layouts.
            if (field._type === undefined) field._type = field.type;
            field.type = findType(field.type);

            // Upgrade plain pointer to array pointer when a length meta-field
            // with the same name exists (shorthand: "int*" instead of "int[]*").
            if (field.type.reference && !field.type.reference.array && hasLengthMeta.has(field.name))
            {
                field.type = {
                    ...field.type,
                    reference: { array: field.type.reference, cname: field.type.reference.cname },
                };
            }

            offset += field.type.length + (field.padding ?? 0);
            offset = align(offset, pack);
        }

        // Store size
        type.length = offset;
        delete type._computing;

        // Propagate defaults from primary fields to their meta (length) fields.
        // e.g. if "items" has default:[], the preceding length field for "items"
        // should use the same default so v.length resolves correctly.
        for (let field of type.fields)
        {
            if (field.type.meta && field.default === undefined)
            {
                let primary = type.fields.find(f => f.name === field.name && !f.type.meta);
                if (primary?.default !== undefined)
                    field.default = primary.default;
            }
        }
    }

    // Return it
    return type;
}


// Return all fields for a type in inheritance order (root ancestor first).
// Field offsets are pre-computed so the result can be used directly for
// both packing and unpacking without any offset adjustment.
function allFields(type)
{
    if (!type.baseType) return type.fields;
    return [...allFields(type.baseType), ...type.fields];
}

export class BinPack
{
    constructor()
    {
    }

    buf = Buffer.alloc(1024);   // Default size
    offset = 0;

    reserve(size)
    {
        // Big enough?
        if (size < this.buf.length)
            return;

        // Double buffer until big enough
        let newSize = this.buf.length * 2;
        while (newSize < size)
            newSize *= 2;

        // Grow buffer
        let newBuf = Buffer.alloc(newSize);
        this.buf.copy(newBuf, 0);
        this.buf = newBuf;
    }

    #nextBlobOffset = 0;
    #blobBuffers = new Map();
    appendBlobBuffer(buf)
    {
        let existing = this.#blobBuffers.get(buf);
        if (existing)
        {
            return existing.id;
        }

        let id = this.#blobBuffers.size;
        this.#blobBuffers.set(buf, {
            buf,
            id,
            offset: this.#nextBlobOffset,
        });

        this.#nextBlobOffset = align(this.#nextBlobOffset + buf.length, 4);

        return id;
    }

    #stringBufs = new Map();
    allocateString(string)
    {
        let buf = this.#stringBufs.get(string);
        if (!buf)
        {
            buf = Buffer.from(string + "\0", "utf8")
            this.#stringBufs.set(string, buf);
        }
        return this.appendBlobBuffer(buf);
    }

    #blobRefs = [];
    registerBlobRef(offset)
    {
        this.#blobRefs.push(offset);
    }

    #pointers = [];
    registerPointer(offset)
    {
        this.#pointers.push(offset);
    }

    #pendingRefs = new Map();
    registerPendingRef(offset, type, value)
    {
        // Already referenced?
        let prev = this.#pendingRefs.get(value);
        if (prev)
        {
            if (type != prev.type)
                throw new Error("Pending reference to same object with different types");

            prev.offsets.push(offset);
            return;
        }

        // Store it
        this.#pendingRefs.set(value, { 
            type,
            value, 
            offsets: [ offset ]
        })
    }

    packPendingRefs()
    {
        for (let r of this.#pendingRefs.values())
        {
            // 4 byte align
            this.offset = align(this.offset, 4);

            let dataOffset = this.offset;

            // Pack data
            if (r.type)
                this.pack(r.type, r.value);

            // Update all references
            for (let ro of r.offsets)
            {
                // Store reference offset
                writePointer(this.buf, dataOffset, ro);

                // Register it as a pointer
                this.registerPointer(ro);
            }
        }
    }

    pack(type, value)
    {
        type = findType(type);

        // Reference?
        if (type.reference)
        {
            if (value === null || value === undefined) {
                writePointer(this.buf, 0, this.offset);
            } else {
                this.registerPendingRef(this.offset, type.reference, value);
            }
            this.offset += ptrSize;
            return;
        }

        // Array?
        if (type.array && (Array.isArray(value) || Buffer.isBuffer(value)))
        {
            if (type.fixedLength !== undefined && value.length != type.fixedLength)
            {
                throw new Error(`Fixed length array mismatch (expected ${type.fixedLength}, got ${value.length})`);
            }
            // Fast path: Buffer input for byte arrays
            if (Buffer.isBuffer(value) && type.array.name === 'byte')
            {
                this.reserve(this.offset + value.length);
                value.copy(this.buf, this.offset);
                this.offset += value.length;
                return;
            }
            for (let v of value)
            {
                this.pack(type.array, v);
            }
            return;
        }

        // Structure?
        if (type.fields)
        {
            // Virtual dispatch: if this is a virtual base type, resolve to the
            // actual derived type and pack that instead.
            if (type.resolveVirtualType)
            {
                let actualTypeName = type.resolveVirtualType(value);
                this.pack(findType(actualTypeName), value);
                return;
            }

            // Strict mode: reject unrecognized fields in the value object.
            // Checks against all fields in the full inheritance chain.
            // Skips functions, keys starting with '$', and names in type.ignore.
            // Disabled entirely when type.strict === false.
            if (type.strict !== false)
            {
                let knownNames = new Set(allFields(type).map(f => f.name));
                let ignored = new Set(type.ignore ?? []);
                for (let key of Object.keys(value))
                {
                    if (key.startsWith('$')) continue;
                    if (typeof value[key] === 'function') continue;
                    if (knownNames.has(key)) continue;
                    if (ignored.has(key)) continue;
                    throw new Error(`Unrecognized field '${key}' in type '${type.name}'`);
                }
            }

            // Pack all fields in inheritance order (base fields first).
            // allFields() returns root-ancestor fields first with correct offsets.
            let baseOffset = this.offset;
            for (let f of allFields(type))
            {
                this.offset = baseOffset + f.offset;
                let v = value[f.name];
                if (v === undefined)
                {
                    if (f.default !== undefined)
                        v = f.default;
                    else
                        throw new Error(`Missing required field '${f.name}'`);
                }
                this.pack(f.type, v);
            }

            // Update offset to end of struct
            this.offset = baseOffset + type.length;
            return;
        }

        // Ensure space
        this.reserve(this.offset + type.length);
        type.pack(this, value);
        this.offset += type.length;
    }

    finalize()
    {
        // Render pending refs
        this.packPendingRefs();

        // Work out final layout
        let blobBaseOffset = this.offset;
        let blobLength = this.#nextBlobOffset;

        var totalSize = blobBaseOffset + blobLength;

        // Allocate buffer
        let buf = Buffer.alloc(totalSize);

        // Copy fixed size data
        this.buf.copy(buf, 0);

        // Copy variable length data
        let blobIdMap = new Map();
        for (let b of this.#blobBuffers.values())
        {
            b.buf.copy(buf, blobBaseOffset + b.offset);
            blobIdMap.set(b.id, b);
        }

        // Create blob references
        for (let vlr of this.#blobRefs)
        {
            let blobId = readPointer(buf, vlr);
            writePointer(buf, blobBaseOffset + blobIdMap.get(blobId).offset, vlr);
            this.registerPointer(vlr);
        }

        return { 
            binary: buf,
            relocations: this.#pointers.sort((a,b) => a - b),
        }
    }
}

export function pack(type, value)
{
    let bp = new BinPack();
    bp.pack(type, value);
    return bp.finalize();
}

export function unpack(type, buf, offset = 0)
{
    let deserializedRefs = new Map();

    let ctx = {
        buf,
        readString(offset, length)
        {
            if (length !== undefined)
                return buf.toString("utf8", offset, offset+length);

            const end = buf.indexOf(0x00, offset);
            const stop = end === -1 ? buf.length : end;
            return buf.toString('utf8', offset, stop);
        }
    }

    return helper(type, offset);

    function helper(type, offset, length)
    {
        type = findType(type);

        // Array
        if (type.array)
        {
            if (type.fixedLength !== undefined)
            {
                length = type.fixedLength;
            }
            else if (length === undefined || length === null)
                throw new Error("Length required to deserialize array");

            // Return a Buffer for byte arrays
            if (type.array.name === 'byte')
                return buf.subarray(offset, offset + length);

            let r = [];
            for (let i=0; i<length; i++)
            {
                r.push(helper(type.array, offset + i * type.array.length));
            }
            return r;
        }

        // Reference
        if (type.reference)
        {
            // Read offset
            let refoff = readPointer(buf, offset);
            if (refoff === 0) return null;
            let val = deserializedRefs.get(refoff);
            if (val === undefined)
            {
                val = helper(type.reference, refoff, length);
                deserializedRefs.set(refoff, val);
            }
            return val;
        }

        if (type.fields)
        {
            let r = {};

            if (type.resolveVirtualType)
            {
                // --- Virtual base type ---
                // 1. Unpack this type's own fields to get enough data to resolve.
                unpackFields(type.fields, r);

                // 2. Resolve to the concrete derived type.
                let derivedType = findType(type.resolveVirtualType(r));

                // 3. Collect the chain from derivedType up to (not including) this
                //    base type, in base-first order.
                let chain = [];
                for (let t = derivedType; t && t !== type; t = t.baseType)
                    chain.unshift(t);

                // 4. Unpack each level's own fields.
                for (let t of chain)
                    unpackFields(t.fields, r);
            }
            else
            {
                // --- Normal or non-virtual derived type ---
                // allFields() yields base-ancestor fields first with correct offsets.
                unpackFields(allFields(type), r);
            }

            return r;

            function unpackFields(fields, r)
            {
                let meta = {};
                for (let field of fields)
                {
                    if (field.type.meta)
                        meta[field.name] = helper(field.type, offset + field.offset);
                }
                for (let field of fields)
                {
                    if (!field.type.meta)
                        r[field.name] = helper(field.type, offset + field.offset, meta[field.name]);
                }
            }
        }

        ctx.offset = offset;
        ctx.length = length;
        return type.unpack(ctx);
    }
}

export function formatTypes()
{
    let buf = "";

    for (let t of typeMap.values())
    {
        if (!t.fields)
            continue;

        // Ensure the type is fully laid out (may not have been packed yet)
        findType(t);

        buf += `typedef struct __attribute__((packed)) \n`;
        buf += `{\n`

        let o = 0;
        let padIndex = 1;

        // Derived types: embed the base struct as the first member
        if (t.baseType)
        {
            buf += `\t/*    0 */\t${t.baseType.name} base;\n`;
            o = t.baseType.length;
        }

        for (let field of t.fields)
        {
            if (field.offset != o)
            {
                buf += `\tuint8_t _pad${padIndex++}[${field.offset - o}];\n`;
            }

            buf += `\t`;
            buf += `/* ${field.offset.toString().padStart(4)} */\t`
            buf += field.type.cname ?? field.type.name;
            if (field.type.array && field.type.fixedLength)
                buf += `[${field.type.fixedLength}]`;
            buf += ' ';
            if (field.cname)
            {
                buf += field.cname;
            }
            else
            {
                if (field.type.cfieldprefix)
                    buf += field.type.cfieldprefix;
                buf += field.name;
            }
            buf += `;\n`;
            o = field.offset + field.type.length;
        }

        if (t.length != o)
        {
            buf += `\tuint8_t _pad${padIndex++}[${t.length - o}];\n`;
        }

        buf += `} ${t.name};\n\n`;
    }

    return buf;

}