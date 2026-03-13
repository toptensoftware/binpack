import { test } from "node:test";
import assert from "node:assert/strict";
import { pack, unpack, registerType, findType, formatTypes, enable64BitMode } from "./index.js";

// ---------------------------------------------------------------------------
// Primitive round-trips
// ---------------------------------------------------------------------------

test("int round-trip", () => {
    let { binary } = pack("int", 42);
    assert.equal(unpack("int", binary), 42);
});

test("int negative round-trip", () => {
    let { binary } = pack("int", -1000);
    assert.equal(unpack("int", binary), -1000);
});

test("uint round-trip", () => {
    let { binary } = pack("uint", 0xDEADBEEF);
    assert.equal(unpack("uint", binary), 0xDEADBEEF);
});

test("short round-trip", () => {
    let { binary } = pack("short", -32768);
    assert.equal(unpack("short", binary), -32768);
});

test("ushort round-trip", () => {
    let { binary } = pack("ushort", 65535);
    assert.equal(unpack("ushort", binary), 65535);
});

test("bool true round-trip", () => {
    let { binary } = pack("bool", true);
    assert.equal(unpack("bool", binary), true);
});

test("bool false round-trip", () => {
    let { binary } = pack("bool", false);
    assert.equal(unpack("bool", binary), false);
});

test("byte round-trip", () => {
    let { binary } = pack("byte", 255);
    assert.equal(unpack("byte", binary), 255);
});

test("sbyte round-trip", () => {
    let { binary } = pack("sbyte", -128);
    assert.equal(unpack("sbyte", binary), -128);
});

test("double round-trip", () => {
    let { binary } = pack("double", 3.141592653589793);
    assert.ok(Math.abs(unpack("double", binary) - 3.141592653589793) < 1e-15);
});

// ---------------------------------------------------------------------------
// String
// ---------------------------------------------------------------------------

test("string round-trip", () => {
    registerType({
        name: "StringTest",
        pack: 4,
        fields: [
            { name: "value", type: "length" },
            { name: "value", type: "string" },
        ]
    });
    let { binary } = pack("StringTest", { value: "Hello, World!" });
    let result = unpack("StringTest", binary);
    assert.equal(result.value, "Hello, World!");
});

test("string deduplication", () => {
    registerType({
        name: "DupStrings",
        pack: 4,
        fields: [
            { name: "a", type: "length" },
            { name: "a", type: "string" },
            { name: "b", type: "length" },
            { name: "b", type: "string" },
        ]
    });
    let sameStr = "shared";
    let { binary } = pack("DupStrings", { a: sameStr, b: sameStr });
    let result = unpack("DupStrings", binary);
    assert.equal(result.a, sameStr);
    assert.equal(result.b, sameStr);
    // Same string stored once: both pointers should be equal
    assert.equal(binary.readUInt32LE(4), binary.readUInt32LE(12));
});

// ---------------------------------------------------------------------------
// Buffer support for byte/sbyte arrays
// ---------------------------------------------------------------------------

test("fixed byte[4] pack from Buffer, unpack returns Buffer", () => {
    registerType({
        name: "ByteFixed",
        pack: 4,
        fields: [{ name: "data", type: "byte[4]" }]
    });
    let input = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
    let { binary } = pack("ByteFixed", { data: input });
    let result = unpack("ByteFixed", binary);
    assert.ok(Buffer.isBuffer(result.data));
    assert.deepEqual(result.data, input);
});


test("dynamic byte* (with length) pack from Buffer, unpack returns Buffer", () => {
    registerType({
        name: "ByteDyn",
        pack: 4,
        fields: [
            { name: "data", type: "length" },
            { name: "data", type: "byte*" },
        ]
    });
    let input = Buffer.from([1, 2, 3, 4, 5]);
    let { binary } = pack("ByteDyn", { data: input });
    let result = unpack("ByteDyn", binary);
    assert.ok(Buffer.isBuffer(result.data));
    assert.deepEqual(result.data, input);
});

test("Buffer pack produces identical binary to array pack for byte[]", () => {
    let fromArray = pack("ByteFixed", { data: [0xDE, 0xAD, 0xBE, 0xEF] });
    let fromBuffer = pack("ByteFixed", { data: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]) });
    assert.deepEqual(fromBuffer.binary, fromArray.binary);
});

test("fixed array length mismatch still throws for Buffer input", () => {
    assert.throws(
        () => pack("ByteFixed", { data: Buffer.from([1, 2]) }),
        /Fixed length array mismatch/
    );
});

// ---------------------------------------------------------------------------
// Fixed-length arrays
// ---------------------------------------------------------------------------

test("fixed array sbyte[3] round-trip", () => {
    registerType({
        name: "FixedArrayTest",
        pack: 4,
        fields: [
            { name: "vals", type: "sbyte[3]" },
        ]
    });
    let { binary } = pack("FixedArrayTest", { vals: [10, -5, 127] });
    let result = unpack("FixedArrayTest", binary);
    assert.deepEqual(result.vals, [10, -5, 127]);
});

test("fixed array length mismatch throws", () => {
    assert.throws(
        () => pack("FixedArrayTest", { vals: [1, 2] }),
        /Fixed length array mismatch/
    );
});

// ---------------------------------------------------------------------------
// Dynamic arrays with length prefix
// ---------------------------------------------------------------------------

test("dynamic int array round-trip", () => {
    registerType({
        name: "DynArrayTest",
        pack: 4,
        fields: [
            { name: "items", type: "length", cname: "items_count" },
            { name: "items", type: "int[]*" },
        ]
    });
    let { binary } = pack("DynArrayTest", { items: [1, 2, 3, 100, -50] });
    let result = unpack("DynArrayTest", binary);
    assert.deepEqual(result.items, [1, 2, 3, 100, -50]);
});

test("implicit array pointer shorthand: int* with length field same as int[]*", () => {
    registerType({
        name: "ShorthandArray",
        pack: 4,
        fields: [
            { name: "items", type: "length", cname: "items_count" },
            { name: "items", type: "int*" },       // shorthand — no [] needed
        ]
    });
    let { binary } = pack("ShorthandArray", { items: [7, 14, 21] });
    let result = unpack("ShorthandArray", binary);
    assert.deepEqual(result.items, [7, 14, 21]);
});

test("implicit array pointer shorthand produces identical binary to explicit int[]*", () => {
    registerType({
        name: "ExplicitArray",
        pack: 4,
        fields: [
            { name: "items", type: "length", cname: "items_count" },
            { name: "items", type: "int[]*" },     // explicit — original syntax
        ]
    });
    let explicit = pack("ExplicitArray", { items: [7, 14, 21] });
    let shorthand = pack("ShorthandArray", { items: [7, 14, 21] });
    assert.deepEqual(shorthand.binary, explicit.binary);
    assert.deepEqual(shorthand.relocations, explicit.relocations);
});

test("implicit array pointer shorthand with null", () => {
    let { binary, relocations } = pack("ShorthandArray", { items: null });
    assert.equal(relocations.length, 0);
    assert.equal(unpack("ShorthandArray", binary).items, null);
});

test("empty dynamic array round-trip", () => {
    registerType({
        name: "EmptyDynArray",
        pack: 4,
        fields: [
            { name: "items", type: "length", cname: "items_count" },
            { name: "items", type: "int[]*" },
        ]
    });
    let { binary } = pack("EmptyDynArray", { items: [] });
    let result = unpack("EmptyDynArray", binary);
    assert.deepEqual(result.items, []);
});

// ---------------------------------------------------------------------------
// Relocations
// ---------------------------------------------------------------------------

test("relocations allow offset header insertion", () => {
    registerType({
        name: "RelocTest",
        pack: 4,
        fields: [
            { name: "value", type: "length" },
            { name: "value", type: "string" },
        ]
    });
    let bin = pack("RelocTest", { value: "reloc me" });
    let headerLen = 16;
    let bin2 = Buffer.concat([Buffer.alloc(headerLen), bin.binary]);
    for (let relocAddr of bin.relocations) {
        bin2.writeUInt32LE(bin.binary.readUInt32LE(relocAddr) + headerLen, relocAddr + headerLen);
    }
    let result = unpack("RelocTest", bin2, headerLen);
    assert.equal(result.value, "reloc me");
});

test("relocations list is sorted and non-empty for structs with pointers", () => {
    registerType({
        name: "RelocCheck",
        pack: 4,
        fields: [
            { name: "s", type: "length" },
            { name: "s", type: "string" },
        ]
    });
    let { relocations } = pack("RelocCheck", { s: "test" });
    assert.ok(relocations.length > 0);
    for (let i = 1; i < relocations.length; i++) {
        assert.ok(relocations[i] > relocations[i - 1], "relocations should be sorted");
    }
});

// ---------------------------------------------------------------------------
// Full struct (similar to sandbox example)
// ---------------------------------------------------------------------------

test("complex struct round-trip", () => {
    registerType({
        name: "FullStruct",
        pack: 4,
        fields: [
            { name: "id",      type: "int" },
            { name: "label",   type: "length" },
            { name: "label",   type: "string" },
            { name: "count",   type: "short" },
            { name: "active",  type: "bool" },
            { name: "nums",    type: "length", cname: "nums_count" },
            { name: "nums",    type: "int[]*" },
            { name: "coords",  type: "sbyte[3]" },
        ]
    });
    let input = {
        id: 7,
        label: "Test Label",
        count: 42,
        active: true,
        nums: [10, 20, 30],
        coords: [-1, 0, 1],
    };
    let { binary } = pack("FullStruct", input);
    let result = unpack("FullStruct", binary);
    assert.equal(result.id, 7);
    assert.equal(result.label, "Test Label");
    assert.equal(result.count, 42);
    assert.equal(result.active, true);
    assert.deepEqual(result.nums, [10, 20, 30]);
    assert.deepEqual(result.coords, [-1, 0, 1]);
});

// ---------------------------------------------------------------------------
// Null strings
// ---------------------------------------------------------------------------

test("null string packs as null pointer", () => {
    registerType({
        name: "NullString",
        pack: 4,
        fields: [
            { name: "str", type: "length" },
            { name: "str", type: "string" },
        ]
    });
    let { binary, relocations } = pack("NullString", { str: null });
    let result = unpack("NullString", binary);
    assert.equal(result.str, null);
    // Null pointer should not appear in relocations
    assert.equal(relocations.length, 0);
});

test("struct with mix of null and non-null strings", () => {
    registerType({
        name: "MixedStrings",
        pack: 4,
        fields: [
            { name: "a", type: "length" },
            { name: "a", type: "string" },
            { name: "b", type: "length" },
            { name: "b", type: "string" },
        ]
    });
    let { binary } = pack("MixedStrings", { a: "hello", b: null });
    let result = unpack("MixedStrings", binary);
    assert.equal(result.a, "hello");
    assert.equal(result.b, null);
});

// ---------------------------------------------------------------------------
// Null pointer types
// ---------------------------------------------------------------------------

test("null pointer packs as zero and unpacks as null", () => {
    registerType({ name: "NullInner", pack: 4, fields: [{ name: "x", type: "int" }] });
    registerType({ name: "NullOuter", pack: 4, fields: [{ name: "ptr", type: "NullInner*" }] });
    let { binary, relocations } = pack("NullOuter", { ptr: null });
    // Pointer field should be zero
    assert.equal(binary.readUInt32LE(0), 0);
    // Null pointer should not appear in relocations
    assert.equal(relocations.length, 0);
    let result = unpack("NullOuter", binary);
    assert.equal(result.ptr, null);
});

test("non-null and null pointers in same struct", () => {
    registerType({ name: "Node", pack: 4, fields: [{ name: "val", type: "int" }] });
    registerType({
        name: "Container",
        pack: 4,
        fields: [
            { name: "present", type: "Node*" },
            { name: "absent",  type: "Node*" },
        ]
    });
    let { binary } = pack("Container", { present: { val: 99 }, absent: null });
    let result = unpack("Container", binary);
    assert.deepEqual(result.present, { val: 99 });
    assert.equal(result.absent, null);
});

// ---------------------------------------------------------------------------
// Self-referential pointer types
// ---------------------------------------------------------------------------

test("self-referential pointer type with null terminator", () => {
    registerType({
        name: "ListNode",
        pack: 4,
        fields: [
            { name: "value", type: "int" },
            { name: "next",  type: "ListNode*" },
        ]
    });
    let { binary } = pack("ListNode", { value: 42, next: null });
    let result = unpack("ListNode", binary);
    assert.equal(result.value, 42);
    assert.equal(result.next, null);
});

test("self-referential pointer type with two nodes", () => {
    let { binary } = pack("ListNode", {
        value: 1,
        next: { value: 2, next: null },
    });
    let result = unpack("ListNode", binary);
    assert.equal(result.value, 1);
    assert.equal(result.next.value, 2);
    assert.equal(result.next.next, null);
});

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

test("field with default uses default when value is omitted", () => {
    registerType({
        name: "WithDefaults",
        pack: 4,
        fields: [
            { name: "x", type: "int", default: 42 },
            { name: "y", type: "int", default: 0 },
        ]
    });
    let { binary } = pack("WithDefaults", {});
    let result = unpack("WithDefaults", binary);
    assert.equal(result.x, 42);
    assert.equal(result.y, 0);
});

test("provided value overrides default", () => {
    let { binary } = pack("WithDefaults", { x: 99, y: 7 });
    let result = unpack("WithDefaults", binary);
    assert.equal(result.x, 99);
    assert.equal(result.y, 7);
});

test("missing field without default throws", () => {
    registerType({
        name: "Required",
        pack: 4,
        fields: [
            { name: "val", type: "int" },
        ]
    });
    assert.throws(
        () => pack("Required", {}),
        /Missing required field 'val'/
    );
});

test("default: null for optional string pointer", () => {
    registerType({
        name: "OptionalString",
        pack: 4,
        fields: [
            { name: "label", type: "length" },
            { name: "label", type: "string", default: null },
        ]
    });
    let { binary } = pack("OptionalString", {});
    let result = unpack("OptionalString", binary);
    assert.equal(result.label, null);
});

test("default array for optional dynamic array", () => {
    registerType({
        name: "OptionalArray",
        pack: 4,
        fields: [
            { name: "items", type: "length", cname: "items_count" },
            { name: "items", type: "int*", default: [] },
        ]
    });
    // length meta-field inherits the [] default, so packing with no items works
    let { binary } = pack("OptionalArray", {});
    let result = unpack("OptionalArray", binary);
    assert.deepEqual(result.items, []);
});

test("length meta-field inherits primary field default", () => {
    // If we had to provide a separate default on the length field it would
    // be awkward — verify it's copied automatically from the primary field.
    registerType({
        name: "DefaultInherit",
        pack: 4,
        fields: [
            { name: "tags", type: "length" },          // no explicit default here
            { name: "tags", type: "int*", default: [1, 2, 3] },
        ]
    });
    let { binary } = pack("DefaultInherit", {});
    let result = unpack("DefaultInherit", binary);
    assert.deepEqual(result.tags, [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Strict mode (unrecognized fields)
// ---------------------------------------------------------------------------

test("strict mode throws on unrecognized field", () => {
    registerType({
        name: "StrictType",
        pack: 4,
        fields: [{ name: "x", type: "int" }],
    });
    assert.throws(
        () => pack("StrictType", { x: 1, unknown: 99 }),
        /Unrecognized field 'unknown'/
    );
});

test("strict mode ignores keys starting with $", () => {
    let { binary } = pack("StrictType", { x: 1, $meta: "ignored" });
    assert.equal(unpack("StrictType", binary).x, 1);
});

test("strict mode ignores function-valued keys", () => {
    let { binary } = pack("StrictType", { x: 1, toJSON: () => {} });
    assert.equal(unpack("StrictType", binary).x, 1);
});

test("strict: false disables unrecognized field check", () => {
    registerType({
        name: "LaxType",
        strict: false,
        pack: 4,
        fields: [{ name: "x", type: "int" }],
    });
    let { binary } = pack("LaxType", { x: 1, anything: "goes" });
    assert.equal(unpack("LaxType", binary).x, 1);
});

test("ignore list suppresses specific unrecognized fields", () => {
    registerType({
        name: "IgnoreFields",
        pack: 4,
        ignore: ["timestamp", "version"],
        fields: [{ name: "x", type: "int" }],
    });
    let { binary } = pack("IgnoreFields", { x: 5, timestamp: 12345, version: 2 });
    assert.equal(unpack("IgnoreFields", binary).x, 5);
});

test("ignore list still rejects fields not in the list", () => {
    assert.throws(
        () => pack("IgnoreFields", { x: 5, notIgnored: true }),
        /Unrecognized field 'notIgnored'/
    );
});

// ---------------------------------------------------------------------------
// Virtual types
// ---------------------------------------------------------------------------

// Base type with two concrete derived types
registerType({
    name: "Shape",
    pack: 4,
    resolveVirtualType(value) {
        if (value.kind === 0) return "Circle";
        if (value.kind === 1) return "Rect";
        throw new Error(`Unknown shape kind ${value.kind}`);
    },
    fields: [
        { name: "kind", type: "int" },
    ]
});
registerType({
    name: "Circle",
    extends: "Shape",
    fields: [
        { name: "radius", type: "int" },
    ]
});
registerType({
    name: "Rect",
    extends: "Shape",
    fields: [
        { name: "width",  type: "int" },
        { name: "height", type: "int" },
    ]
});

test("virtual type: pack and unpack Circle through Shape*", () => {
    registerType({
        name: "ShapeHolder",
        pack: 4,
        fields: [{ name: "shape", type: "Shape*" }]
    });
    let { binary } = pack("ShapeHolder", { shape: { kind: 0, radius: 7 } });
    let result = unpack("ShapeHolder", binary);
    assert.equal(result.shape.kind, 0);
    assert.equal(result.shape.radius, 7);
});

test("virtual type: pack and unpack Rect through Shape*", () => {
    let { binary } = pack("ShapeHolder", { shape: { kind: 1, width: 10, height: 5 } });
    let result = unpack("ShapeHolder", binary);
    assert.equal(result.shape.kind, 1);
    assert.equal(result.shape.width, 10);
    assert.equal(result.shape.height, 5);
});

test("virtual type: array of Shape* pointers with mixed types", () => {
    registerType({
        name: "ShapeArray",
        pack: 4,
        fields: [
            { name: "shapes", type: "length" },
            { name: "shapes", type: "Shape**" },
        ]
    });
    let input = [
        { kind: 0, radius: 3 },
        { kind: 1, width: 4, height: 6 },
        { kind: 0, radius: 9 },
    ];
    let { binary } = pack("ShapeArray", { shapes: input });
    let result = unpack("ShapeArray", binary);
    assert.equal(result.shapes.length, 3);
    assert.deepEqual(result.shapes[0], { kind: 0, radius: 3 });
    assert.deepEqual(result.shapes[1], { kind: 1, width: 4, height: 6 });
    assert.deepEqual(result.shapes[2], { kind: 0, radius: 9 });
});

test("virtual type: null pointer in Shape* array", () => {
    let { binary } = pack("ShapeArray", {
        shapes: [{ kind: 0, radius: 1 }, null, { kind: 1, width: 2, height: 3 }]
    });
    let result = unpack("ShapeArray", binary);
    assert.deepEqual(result.shapes[0], { kind: 0, radius: 1 });
    assert.equal(result.shapes[1], null);
    assert.deepEqual(result.shapes[2], { kind: 1, width: 2, height: 3 });
});

test("virtual type: derived type binary layout has base fields first", () => {
    // Circle memory: [kind(4)] [radius(4)] = 8 bytes total
    let { binary } = pack("ShapeHolder", { shape: { kind: 0, radius: 42 } });
    // Find where the Circle data is (after the ShapeHolder's 4-byte pointer)
    let shapeOffset = binary.readUInt32LE(0);
    assert.equal(binary.readInt32LE(shapeOffset),     0);  // kind = 0
    assert.equal(binary.readInt32LE(shapeOffset + 4), 42); // radius = 42
});

test("virtual type: strict mode rejects unrecognized fields on derived type", () => {
    assert.throws(
        () => pack("Circle", { kind: 0, radius: 5, extra: 99 }),
        /Unrecognized field 'extra'/
    );
});

test("virtual type: direct pack/unpack of derived type", () => {
    let { binary } = pack("Circle", { kind: 0, radius: 55 });
    let result = unpack("Circle", binary);
    assert.equal(result.kind, 0);
    assert.equal(result.radius, 55);
});

test("virtual type: multi-level inheritance", () => {
    registerType({
        name: "Animal",
        pack: 4,
        resolveVirtualType(value) {
            return value.species === 0 ? "Dog" : "Cat";
        },
        fields: [{ name: "species", type: "int" }]
    });
    registerType({
        name: "Pet",
        extends: "Animal",
        fields: [{ name: "age", type: "int" }]
    });
    registerType({
        name: "Dog",
        extends: "Pet",
        fields: [{ name: "breed", type: "int" }]
    });
    registerType({
        name: "Cat",
        extends: "Pet",
        fields: [{ name: "indoor", type: "bool" }]
    });
    registerType({
        name: "AnimalHolder",
        pack: 4,
        fields: [{ name: "animal", type: "Animal*" }]
    });
    let { binary } = pack("AnimalHolder", { animal: { species: 0, age: 3, breed: 7 } });
    let result = unpack("AnimalHolder", binary);
    assert.equal(result.animal.species, 0);
    assert.equal(result.animal.age, 3);
    assert.equal(result.animal.breed, 7);
});

// ---------------------------------------------------------------------------
// 64-bit pointer mode
// ---------------------------------------------------------------------------

// Helper: run fn in 64-bit mode, always restore 32-bit afterwards
function with64Bit(fn) {
    try {
        enable64BitMode(true);
        return fn();
    } finally {
        enable64BitMode(false);
    }
}

test("64-bit: pointer field is 8 bytes wide", () => with64Bit(() => {
    registerType({
        name: "PtrSize64",
        pack: 4,
        fields: [{ name: "val", type: "int" }, { name: "next", type: "PtrSize64*" }]
    });
    let { binary } = pack("PtrSize64", { val: 1, next: null });
    // int(4) + pointer(8) = 12 bytes
    assert.equal(binary.length, 12);
}));

test("64-bit: string field is 8 bytes wide", () => with64Bit(() => {
    registerType({
        name: "StrSize64",
        pack: 4,
        fields: [
            { name: "label", type: "length" },
            { name: "label", type: "string" },
        ]
    });
    // length(4) + string-pointer(8) = 12 bytes header
    let { binary } = pack("StrSize64", { label: "hi" });
    assert.equal(binary.readUInt32LE(0), 2);   // length field = 2 bytes
    assert.equal(binary.readUInt32LE(4), 12);  // pointer to string data (starts at offset 12)
    assert.equal(binary.readUInt32LE(8), 0);   // upper 4 bytes of pointer = 0
}));

test("64-bit: pack/unpack round-trip with string", () => with64Bit(() => {
    let { binary } = pack("StrSize64", { label: "hello" });
    let result = unpack("StrSize64", binary);
    assert.equal(result.label, "hello");
}));

test("64-bit: pack/unpack round-trip with pointer", () => with64Bit(() => {
    let { binary } = pack("PtrSize64", { val: 42, next: { val: 99, next: null } });
    let result = unpack("PtrSize64", binary);
    assert.equal(result.val, 42);
    assert.equal(result.next.val, 99);
    assert.equal(result.next.next, null);
}));

test("64-bit: dynamic array pointer is 8 bytes wide", () => with64Bit(() => {
    registerType({
        name: "ArrSize64",
        pack: 4,
        fields: [
            { name: "items", type: "length" },
            { name: "items", type: "int*"   },
        ]
    });
    // length(4) + pointer(8) = 12 bytes header
    let { binary } = pack("ArrSize64", { items: [1, 2, 3] });
    assert.equal(binary.readUInt32LE(0), 3);   // count
    assert.equal(binary.readUInt32LE(8), 0);   // upper 4 bytes of pointer = 0
    let result = unpack("ArrSize64", binary);
    assert.deepEqual(result.items, [1, 2, 3]);
}));

test("64-bit: null pointer upper bytes are zero", () => with64Bit(() => {
    let { binary } = pack("PtrSize64", { val: 7, next: null });
    assert.equal(binary.readUInt32LE(4), 0);  // lower 4 bytes
    assert.equal(binary.readUInt32LE(8), 0);  // upper 4 bytes
}));

test("64-bit: relocations list entries are correct offsets", () => with64Bit(() => {
    let { binary, relocations } = pack("StrSize64", { label: "x" });
    assert.equal(relocations.length, 1);
    assert.equal(relocations[0], 4);  // pointer field is at byte 4 (after 4-byte length)
}));

test("64-bit: switching back to 32-bit restores original layout", () => {
    // Pack 64-bit, then switch back, verify 32-bit sizes are restored
    with64Bit(() => pack("StrSize64", { label: "test" }));
    // Now in 32-bit mode: length(4) + pointer(4) = 8 bytes header
    let { binary } = pack("StrSize64", { label: "test" });
    assert.equal(binary.readUInt32LE(0), 4);  // length = 4 bytes
    assert.equal(binary.readUInt32LE(4), 8);  // pointer to string at offset 8
});

test("64-bit: enable64BitMode is idempotent", () => {
    try {
        enable64BitMode(true);
        enable64BitMode(true);  // second call is a no-op
        let { binary } = pack("StrSize64", { label: "x" });
        assert.equal(binary.length, 16); // 12-byte header + 2-byte string "x\0" padded to 4
    } finally {
        enable64BitMode(false);
    }
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

test("registerType throws on duplicate name", () => {
    assert.throws(
        () => registerType({ name: "int", length: 4 }),
        /already registered/
    );
});

test("findType throws on unknown type", () => {
    assert.throws(
        () => findType("NoSuchType"),
        /Unknown type/
    );
});

// ---------------------------------------------------------------------------
// formatTypes
// ---------------------------------------------------------------------------

test("formatTypes includes registered struct", () => {
    let output = formatTypes();
    assert.ok(output.includes("FullStruct"), "formatTypes should include FullStruct");
    assert.ok(output.includes("typedef struct"), "should emit typedef struct");
});

test("formatTypes does not include primitive types", () => {
    let output = formatTypes();
    // Primitives like "int" have no fields, so they should not appear as struct defs
    assert.ok(!output.includes("typedef struct\n{\n} int"), "should not emit struct for int");
});

// ---------------------------------------------------------------------------
// packMapper / unpackMapper
// ---------------------------------------------------------------------------

const COLOUR_MAP = ["red", "green", "blue"];

registerType({
    name: "ColourIndex",
    fields: [{ name: "index", type: "int" }],
    packMapper(value, root) {
        // Convert colour name string → { index: N }
        const i = COLOUR_MAP.indexOf(value);
        if (i === -1) throw new Error(`Unknown colour: ${value}`);
        return { index: i };
    },
    unpackMapper(value, containingObj) {
        // Convert { index: N } → colour name string
        return COLOUR_MAP[value.index];
    },
});

registerType({
    name: "Palette",
    fields: [
        { name: "primary",   type: "ColourIndex" },
        { name: "secondary", type: "ColourIndex" },
    ],
});

test("packMapper transforms value before packing", () => {
    const { binary } = pack("Palette", { primary: "blue", secondary: "red" });
    // Without mapper, packing a string would fail — success means mapper fired
    // primary index = 2, secondary index = 0
    assert.equal(binary.readInt32LE(0), 2);
    assert.equal(binary.readInt32LE(4), 0);
});

test("unpackMapper transforms value after unpacking", () => {
    const { binary } = pack("Palette", { primary: "green", secondary: "blue" });
    const result = unpack("Palette", binary);
    assert.equal(result.primary,   "green");
    assert.equal(result.secondary, "blue");
});

test("packMapper receives root object as second argument", () => {
    const ITEMS = ["sword", "shield", "potion"];
    registerType({
        name: "Inventory",
        fields: [
            { name: "count", type: "int" },
            { name: "item",  type: "ItemSlot" },
        ],
    });
    registerType({
        name: "ItemSlot",
        fields: [{ name: "id", type: "int" }],
        packMapper(value, root) {
            // root.count is not the lookup table; use a captured closure table here
            // but verify root is the top-level object
            assert.ok("count" in root, "root should be the top-level Inventory object");
            return { id: ITEMS.indexOf(value) };
        },
        unpackMapper(value, containingObj) {
            return ITEMS[value.id];
        },
    });

    const { binary } = pack("Inventory", { count: 3, item: "shield" });
    const result = unpack("Inventory", binary);
    assert.equal(result.item, "shield");
});

test("packMapper on pointer type applies to pointed-to value", () => {
    registerType({
        name: "MappedPtrHost",
        fields: [{ name: "colour", type: "ColourIndex*" }],
    });

    const { binary } = pack("MappedPtrHost", { colour: "green" });
    const result = unpack("MappedPtrHost", binary);
    assert.equal(result.colour, "green");
});

test("packMapper on array element type applies to each element", () => {
    registerType({
        name: "PaletteList",
        fields: [
            { name: "colours", type: "length" },
            { name: "colours", type: "ColourIndex*" },
        ],
    });

    const { binary } = pack("PaletteList", { colours: ["red", "blue", "green"] });
    const result = unpack("PaletteList", binary);
    assert.deepEqual(result.colours, ["red", "blue", "green"]);
});
