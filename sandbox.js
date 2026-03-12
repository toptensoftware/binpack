import { pack, unpack, formatTypes } from "./index.js"

let type = {
    name: "MyStruct",
    pack: 4,
    fields: [
        { name: "field1", type: "int" },

        { name: "field2", type: "length" },
        { name: "field2", type: "string" },
        { name: "firstName", type: "string" },
        { name: "lastName", type: "string" },
        { name: "field3", type: "short" },

        { name: "field4", type: "length" },
        { name: "field4", type: "int[]*" },
        { name: "blah", type: "bool" },

        { name: "strtest", type: "length" },
        { name: "strtest", type: "string" },
    ]
}

let bin = pack(type, {
    field1: 33,
    field2: "Hello World",
    field3: 19,
    field4: [23, 34, 46],
    firstName: "Joe",
    lastName: "Sixpack",
    strtest: "Jolene Sixpack",
});

console.log(bin);

console.log(unpack(type, bin.binary));

// Test relocations by inserting a header and relocation internal pointers
let headerLen = 30;
let bin2 = Buffer.concat([Buffer.alloc(headerLen), bin.binary]);
for (let i=0; i<bin.relocations.length; i++)
{
    let relocAddr = bin.relocations[i];
    bin2.writeUInt32LE(bin.binary.readUInt32LE(relocAddr) + headerLen, relocAddr + headerLen);
}

console.log(unpack(type, bin2, headerLen));


console.log(formatTypes());
