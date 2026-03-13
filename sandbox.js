import { pack, unpack, registerType, formatTypes } from "./index.js"
import fs from "node:fs";

registerType({
    name: "MyStruct",
    pack: 4,
    fields: [
        { name: "field1", type: "int" },

        { name: "field2", type: "length" },
        { name: "field2", type: "string" },
        { name: "firstName", type: "string" },
        { name: "lastName", type: "string" },
        { name: "field3", type: "short" },

        { name: "field4", type: "length", cname: "field4_count" },
        { name: "field4", type: "int[]*" },
        { name: "blah", type: "bool" },

        { name: "strtest", type: "length" },
        { name: "strtest", type: "string" },

        { name: "fa", type: "sbyte[3]" },
    ]
});

let bin = pack("MyStruct", {
    field1: 33,
    field2: "Hello World",
    field3: 19,
    field4: [23, 34, 46],
    firstName: "Hello World",
    lastName: "Hello World",
    strtest: "Jolene Sixpack",
    fa: [1,2,3],
});

console.log(bin);

fs.writeFileSync("sandbox.bin", bin.binary);


console.log(unpack("MyStruct", bin.binary));

// Test relocations by inserting a header and relocating internal offsets
let headerLen = 30;
let bin2 = Buffer.concat([Buffer.alloc(headerLen), bin.binary]);
for (let i=0; i<bin.relocations.length; i++)
{
    let relocAddr = bin.relocations[i];
    bin2.writeUInt32LE(bin.binary.readUInt32LE(relocAddr) + headerLen, relocAddr + headerLen);
}

console.log(unpack("MyStruct", bin2, headerLen));


console.log(formatTypes());
