# binpack

Node library for packing and unpacking JSON like objects into binary
format suitable for use from C code.


## Installation

```bash
npm install --save toptensoftware/binpack
```

## Usage

- [Overview](#overview)
- [Registering Types](#registering-types)
- [Packing and Unpacking](#packing-and-unpacking)
- [Primitive Types](#primitive-types)
- [Strings](#strings)
- [Fixed-Length Arrays](#fixed-length-arrays)
- [Dynamic Arrays](#dynamic-arrays)
- [Buffer Support](#buffer-support)
- [Pointers](#pointers)
- [Null Values](#null-values)
- [Default Values](#default-values)
- [Strict Mode](#strict-mode)
- [Inheritance and Virtual Types](#inheritance-and-virtual-types)
- [Relocations](#relocations)
- [C Header Generation](#c-header-generation)


### Overview

binpack serializes JavaScript objects into a flat binary buffer whose
layout exactly matches a C struct, including pointers and variable-length
data appended after the fixed-size header.  The result can be `mmap`-ed
or copied directly into MCU memory and used without any deserialization
step on the C side.

```js
import { pack, unpack, registerType } from "@toptensoftware/binpack";

registerType({
    name: "Point",
    pack: 4,          // alignment (bytes)
    fields: [
        { name: "x", type: "int" },
        { name: "y", type: "int" },
    ]
});

let { binary } = pack("Point", { x: 10, y: 20 });
// binary is a Node Buffer containing 8 bytes

let result = unpack("Point", binary);
// result = { x: 10, y: 20 }
```


### Registering Types

Call `registerType(def)` once per type, before packing or unpacking.

```js
registerType({
    name: "MyStruct",   // required – must be unique
    pack: 4,            // field alignment in bytes (default 4)
    strict: true,       // reject unrecognized fields when packing (default true)
    ignore: [],         // field names to allow through strict checking
    fields: [ ... ],    // field definitions (see below)
});
```

Each field definition:

```js
{ name: "fieldName", type: "typeName", default: <value>, cname: "c_name" }
```

| Property  | Description |
|-----------|-------------|
| `name`    | JavaScript property name used during pack/unpack |
| `type`    | Type name (see [Primitive Types](#primitive-types) and type modifiers) |
| `default` | Value used when the property is absent during packing.  Omit to make the field required. |
| `cname`   | Override the C field name in generated headers |


### Packing and Unpacking

```js
let { binary, relocations } = pack("TypeName", value);
let value = unpack("TypeName", buffer, offset);
```

`pack` returns an object with:
- `binary` — a `Buffer` containing the packed data
- `relocations` — sorted array of byte offsets within `binary` that contain
  absolute pointers (needed if you embed the buffer at a non-zero address)

`unpack` accepts an optional `offset` into the buffer (default `0`), which is
useful when the binary is embedded inside a larger structure.


### Primitive Types

| JS type name | C type        | Size |
|--------------|---------------|------|
| `bool`       | —             | 1    |
| `byte`       | `uint8_t`     | 1    |
| `sbyte`      | `int8_t`      | 1    |
| `short`      | `int16_t`     | 2    |
| `ushort`     | `uint16_t`    | 2    |
| `int`        | `int32_t`     | 4    |
| `uint`       | `uint32_t`    | 4    |
| `long`       | `int64_t`     | 8    |
| `ulong`      | `uint64_t`    | 8    |
| `float`      | `float`       | 4    |
| `double`     | `double`      | 8    |

```js
registerType({
    name: "Primitives",
    fields: [
        { name: "flag",    type: "bool"   },
        { name: "count",   type: "uint"   },
        { name: "score",   type: "double" },
    ]
});
```


### Strings

Strings are stored as null-terminated UTF-8 in variable-length data appended
after the fixed-size struct.  The struct field holds a 32-bit pointer to the
string data.  A `length` meta-field immediately before the string field records
the byte length of the string (used by C code that needs the length without
calling `strlen`).

```js
registerType({
    name: "Named",
    fields: [
        { name: "label", type: "length" },   // uint32_t len_label  — byte count
        { name: "label", type: "string" },   // const char* label   — pointer
    ]
});

let { binary } = pack("Named", { label: "hello" });
let result = unpack("Named", binary);
// result.label === "hello"
```

A `null` value produces a null pointer (`0`) in the binary and unpacks back
to `null`.


### Fixed-Length Arrays

Append `[N]` to any type name for a fixed-length inline array.

```js
registerType({
    name: "Vec3",
    fields: [
        { name: "coords", type: "float[3]" },
    ]
});

pack("Vec3", { coords: [1.0, 2.0, 3.0] });
```

Packing a value with the wrong number of elements throws an error.


### Dynamic Arrays

A dynamic array is a pointer to heap data with a separate length field.
Declare a `length` meta-field and a pointer field with the same name.
You may write `T*` instead of `T[]*` when a `length` meta-field exists —
the `[]` is implicit.

```js
registerType({
    name: "IntList",
    fields: [
        { name: "items", type: "length" },   // uint32_t len_items
        { name: "items", type: "int*"   },   // int32_t* items  (same as int[]*)
    ]
});

pack("IntList", { items: [10, 20, 30] });
// unpacks back to { items: [10, 20, 30] }
```


### Buffer Support

For `byte[]` arrays you may supply a Node `Buffer` as the value instead of a
JavaScript array.  Packing uses a fast bulk copy and unpacking returns a
`Buffer` slice directly.

```js
registerType({
    name: "Blob",
    fields: [
        { name: "data", type: "length" },
        { name: "data", type: "byte*" },
    ]
});

let buf = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
let { binary } = pack("Blob", { data: buf });

let result = unpack("Blob", binary);
// Buffer.isBuffer(result.data) === true
```

`sbyte[]` arrays always use plain JavaScript arrays with signed values.


### Pointers

Append `*` to any type name to make it a pointer to a single instance of that
type stored in the variable-length section.

```js
registerType({ name: "Node", fields: [{ name: "value", type: "int" }] });
registerType({
    name: "Wrapper",
    fields: [{ name: "node", type: "Node*" }]
});

pack("Wrapper", { node: { value: 42 } });
```

Self-referential pointer types (linked lists, trees) are supported:

```js
registerType({
    name: "ListNode",
    fields: [
        { name: "value", type: "int"       },
        { name: "next",  type: "ListNode*" },
    ]
});

pack("ListNode", { value: 1, next: { value: 2, next: null } });
```


### Null Values

A `null` value for any pointer or string field is serialized as a zero pointer
and unpacks back to `null`.  Null pointers are not included in the relocations
list.

```js
pack("ListNode", { value: 1, next: null });
```


### Default Values

Add a `default` property to a field definition to make the field optional.
When the property is absent from the value being packed, the default is used.
Fields without a default are required — packing throws if they are missing.

```js
registerType({
    name: "Config",
    fields: [
        { name: "width",   type: "int",    default: 800  },
        { name: "height",  type: "int",    default: 600  },
        { name: "title",   type: "length"                },
        { name: "title",   type: "string", default: null },
    ]
});

// All fields optional — pack with empty object
pack("Config", {});
pack("Config", { width: 1920, height: 1080 });
```

The `length` meta-field automatically inherits the default of the primary
field with the same name, so you only need to declare it once.


### Strict Mode

By default, packing throws an error if the value object contains properties
that do not correspond to any field in the type.  This catches typos and
schema mismatches early.

Three ways to relax the check:

**1. `$`-prefixed keys** — always silently ignored (useful for metadata):
```js
pack("Point", { x: 1, y: 2, $source: "input.json" });  // ok
```

**2. Function-valued properties** — always silently ignored:
```js
pack("Point", { x: 1, y: 2, toJSON() {} });  // ok
```

**3. Per-type `ignore` list** — whitelist specific field names:
```js
registerType({
    name: "Point",
    ignore: ["_id", "createdAt"],
    fields: [{ name: "x", type: "int" }, { name: "y", type: "int" }],
});
pack("Point", { x: 1, y: 2, _id: "abc", createdAt: 123 });  // ok
```

**4. `strict: false`** — disable the check entirely for a type:
```js
registerType({ name: "Point", strict: false, fields: [ ... ] });
```


### Inheritance and Virtual Types

Types can extend a base type.  Base fields are packed first and appear first
in the binary layout.  When unpacking through a pointer to the base type,
`resolveVirtualType` on the base is called with the already-unpacked base
fields to determine the concrete type.

```js
// Base type — knows how to resolve to a concrete type
registerType({
    name: "Shape",
    fields: [
        { name: "kind", type: "int" },
    ],
    resolveVirtualType(value) {
        if (value.kind === 0) return "Circle";
        if (value.kind === 1) return "Rect";
    }
});

// Derived types — declare which base they extend
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

// Container holds an array of Shape pointers
registerType({
    name: "Scene",
    fields: [
        { name: "shapes", type: "length" },
        { name: "shapes", type: "Shape*" },   // shorthand for Shape[]*
    ]
});

let { binary } = pack("Scene", {
    shapes: [
        { kind: 0, radius: 5  },
        { kind: 1, width: 3, height: 4 },
    ]
});

let result = unpack("Scene", binary);
// result.shapes[0] = { kind: 0, radius: 5 }
// result.shapes[1] = { kind: 1, width: 3, height: 4 }
```

Multi-level inheritance is supported — `resolveVirtualType` can return any
type in the hierarchy and all intermediate fields are packed/unpacked in order.


### Relocations

When you embed the packed binary at a non-zero address (for example, after a
file header), all internal pointers need to be adjusted.  The `relocations`
array from `pack` lists the byte offsets of every pointer field.

```js
let bin = pack("MyStruct", value);
let headerSize = 64;

// Prepend a header
let final = Buffer.concat([header, bin.binary]);

// Adjust every pointer by the header size
for (let offset of bin.relocations) {
    final.writeUInt32LE(
        bin.binary.readUInt32LE(offset) + headerSize,
        offset + headerSize
    );
}

// final can now be mmap-ed at an address where the struct starts at headerSize
unpack("MyStruct", final, headerSize);
```


### C Header Generation

`formatTypes()` returns a string of C `typedef struct` declarations for all
registered types with fields, suitable for inclusion in a C or C++ project.

```js
import { formatTypes } from "@toptensoftware/binpack";
console.log(formatTypes());
```

Derived types embed their base struct as the first member, matching the binary
layout and remaining cast-compatible in both C and C++:

```c
typedef struct __attribute__((packed))
{
    /*    0 */  int32_t kind;
} Shape;

typedef struct __attribute__((packed))
{
    /*    0 */  Shape base;
    /*    4 */  int32_t radius;
} Circle;

typedef struct __attribute__((packed))
{
    /*    0 */  Shape base;
    /*    4 */  int32_t width;
    /*    8 */  int32_t height;
} Rect;
```


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
