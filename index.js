let buildInTypes = 
[
    {
        name: "length",
        cname: "uint32_t",
        length: 4,
        meta: true,
        cfieldprefix: "len_",
        pack: (ctx, v) => ctx.buf.writeUInt32LE(v.length, ctx.offset),
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
        length: 4,
        pack: (ctx, v) => {
            let id = ctx.allocateString(v);
            ctx.buf.writeUInt32LE(id, ctx.offset),
            ctx.registerVarLenRef(ctx.offset)
        },
        unpack: (ctx) => ctx.readString(ctx.buf.readInt32LE(ctx.offset), ctx.length),
    }
];

// Map of type name to type
let typeMap = new Map();

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
                length: 4,
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
        else
        {
            type = typeMap.get(type);
            if (!type)
                throw new Error(`Unknown type '${name}'`);
        }
    }

    // Struct?
    if (type.fields && type.length === undefined)
    {
        if (!typeMap.has(type.name))
            typeMap.set(type.name, type);

        // Layout structure
        let offset = 0;
        let pack = type.pack ?? 4;
        for (let field of type.fields)
        {
            field.offset = offset;
            field.type = findType(field.type);
            offset += field.type.length + (field.padding ?? 0);
            offset = align(offset, pack);
        }

        // Store size
        type.length = offset;
    }

    // Return it
    return type;
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

    #varLenBuffers = [];
    appendVarLenBuffer(buf)
    {
        // Make sure buffer is aligned
        if (buf.length % 4 != 0)
        {
            let newBuf = Buffer.alloc(buf.length + 4 - buf.length % 4);
            buf.copy(newBuf, 0);
            buf = newBuf;
        }
        this.#varLenBuffers.push(buf);
        return this.#varLenBuffers.length - 1;
    }

    allocateString(string)
    {
        return this.appendVarLenBuffer(Buffer.from(string + "\0", "utf8"));
    }

    #varLenRefs = [];
    registerVarLenRef(offset)
    {
        this.#varLenRefs.push(offset);
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
                this.buf.writeUInt32LE(dataOffset, ro);

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
            this.registerPendingRef(this.offset, type.reference, value);
            this.offset += 4;
            return;
        }

        // Array?
        if (Array.isArray(value) && type.array)
        {
            for (let v of value)
            {
                this.pack(type.array, v);
            }
            return;
        }

        // Structure?
        if (type.fields)
        {
            // Capture base offset of this field
            let baseOffset = this.offset;
            for (let f of type.fields)
            {
                // Pack to field position
                this.offset = baseOffset + f.offset;
                this.pack(f.type, value[f.name]);
            }

            // Update offset to end of structu
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
        let varLenOffset = this.offset;
        let varLenLength = this.#varLenBuffers.reduce((a, b) => a + b.length, 0);

        var totalSize = varLenOffset + varLenLength;


        // Allocate buffer
        let buf = Buffer.alloc(totalSize);

        // Copy fixed size data
        this.buf.copy(buf, 0);

        // Copy variable length data
        let o = varLenOffset;
        let varLenOffsets = [];
        for (let i=0; i<this.#varLenBuffers.length; i++)
        {
            varLenOffsets.push(o);
            this.#varLenBuffers[i].copy(buf, o);
            o += this.#varLenBuffers[i].length;
        }

        // Setup var len offset
        for (let vlr of this.#varLenRefs)
        {
            let index = buf.readUInt32LE(vlr);
            buf.writeUInt32LE(varLenOffsets[index], vlr);
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
            if (length === undefined || length === null)
                throw new Error("Length required to deserialize array");

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
            let refoff = buf.readUInt32LE(offset);
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
            let meta = {};

            // Read meta values (ie: array lengths)
            for (let field of type.fields)
            {
                if (field.type.meta)
                {
                    meta[field.name] = helper(field.type, offset + field.offset);
                }
            }

            // Read actual values
            for (let field of type.fields)
            {
                if (!field.type.meta)
                {
                    r[field.name] = helper(field.type, offset + field.offset, meta[field.name]);
                }
            }
            return r;
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

        buf += `typedef struct __attribute__((packed)) \n`;
        buf += `{\n`

        let o = 0;
        let padIndex = 1;
        for (let field of t.fields)
        {
            if (field.offset != o)
            {
                buf += `\tuint8_t _pad${padIndex++}[${field.offset - o}];\n`;
            }

            buf += `\t`;
            buf += `/* ${field.offset.toString().padStart(4)} */\t`
            buf += field.type.cname ?? field.type.name;
            buf += ' ';
            if (field.type.cfieldprefix)
                buf += field.type.cfieldprefix;
            buf += field.name;
            buf += `,\n`;
            o = field.offset + field.type.length;
        }

        buf += `} ${t.name};\n\n`;
    }

    return buf;

}