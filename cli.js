#!/usr/bin/env node

import { clargs, showArgs, showPackageVersion } from "@toptensoftware/clargs";
import { pack, unpack, registerType, formatTypes, enable64BitMode, disableUnpackMappers } from "./index.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Combined file signatures as uint32 LE
const SIGNATURE     = 0x4B415042;   // "BPAK" - 32-bit mode
const SIGNATURE_64  = 0x34365042;   // "BP64" - 64-bit mode
const VERSION       = 1;
const HEADER_SIZE   = 32;

async function loadFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".js") {
        const mod = await import(pathToFileURL(path.resolve(filePath)).href);
        return mod.default;
    } else if (ext === ".json") {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else {
        throw new Error(`Unsupported file extension: ${ext} (expected .js or .json)`);
    }
}

async function loadTypeDefs(typeFile) {
    if (!typeFile) {
        if (fs.existsSync("binpack.js")) {
            typeFile = "binpack.js";
        } else if (fs.existsSync("binpack.json")) {
            typeFile = "binpack.json";
        } else {
            console.error("Error: no type definition file specified and binpack.js/binpack.json not found");
            process.exit(1);
        }
    }

    const typeDefs = await loadFile(typeFile);
    if (!Array.isArray(typeDefs) || typeDefs.length === 0) {
        console.error("Error: type definition file must export a non-empty array of type definitions");
        process.exit(1);
    }

    for (const def of typeDefs) {
        registerType(def);
    }

    return typeDefs;
}

// Relocate all pointer fields in buf by adding delta.
// relocations: array of byte offsets (uint32) of pointer fields.
// is64bit: if true, pointer fields are 8 bytes wide; otherwise 4 bytes.
function relocateBuf(buf, relocations, delta, is64bit) {
    for (const relOffset of relocations) {
        if (is64bit) {
            const lo = buf.readUInt32LE(relOffset);
            const hi = buf.readUInt32LE(relOffset + 4);
            const ptr = BigInt(lo) | (BigInt(hi) << 32n);
            const result = ptr + delta;
            buf.writeUInt32LE(Number(result & 0xFFFFFFFFn), relOffset);
            buf.writeUInt32LE(Number((result >> 32n) & 0xFFFFFFFFn), relOffset + 4);
        } else {
            const ptr = BigInt(buf.readUInt32LE(relOffset));
            buf.writeUInt32LE(Number((ptr + delta) & 0xFFFFFFFFn), relOffset);
        }
    }
}

async function main() {
    const args = clargs();

    let use64bit  = false;
    let headerFile = null;
    let raw       = false;
    let strip     = false;
    let base      = null;   // BigInt or null
    let outFile   = null;
    let noUnpackMappers = false;
    let positional = [];

    while (args.next()) {
        if (args.name === null) {
            positional.push(args.readValue());
        } else if (args.name === "64bit") {
            use64bit = args.readBoolValue();
        } else if (args.name === "header") {
            headerFile = args.readValue();
        } else if (args.name === "raw") {
            raw = true;
        } else if (args.name === "strip") {
            strip = true;
        } else if (args.name === "base") {
            base = BigInt(args.readValue());
        } else if (args.name === "out") {
            outFile = args.readValue();
        } else if (args.name === "disable-unpack-mappers") {
            noUnpackMappers = true;
        } else if (args.name === "help" || args.name === "h") {
            showPackageVersion(new URL("./package.json", import.meta.url).pathname.replace(/^\//, ''));
            console.log("\nUsage: binpack [options] <datafile> [<typefile>]");
            console.log("       binpack [options] <packedfile.bin> [<typefile>]");
            console.log("\nOptions:");
            showArgs({
                "--64bit":                    "Use 64-bit pointer mode when packing (default: 32-bit)",
                "--raw":                      "Pack: write separate .bin/.reloc.bin files; Unpack: treat input as raw binary (no header)",
                "--strip":                    "Omit the relocation table from the combined output (pack only)",
                "--base:0xNNNN":              "Relocate packed data to the given base address; for --raw unpack, required to unrelocate",
                "--disable-unpack-mappers":   "Skip unpackMapper functions when unpacking (diagnostic)",
                "--out:<file>":               "Output file name (overrides default derived from input file name)",
                "--header:<file>":            "Write C header file with type definitions (pack mode only)",
                "--help":                     "Show this help message",
            });
            console.log("\nArguments:");
            showArgs({
                "<datafile>":    ".js or .json file containing the data to pack",
                "<packedfile>":  ".bin file to unpack back to JSON",
                "[<typefile>]":  ".js or .json file with type definitions (default: binpack.js or binpack.json)",
            });
            console.log("\nPack output (default):");
            showArgs({
                "<datafile>.bin":  "Combined file: 32-byte header + packed data + relocation table",
            });
            console.log("\nPack output (--raw):");
            showArgs({
                "<datafile>.bin":       "Packed binary data",
                "<datafile>.reloc.bin": "Relocation offsets as uint32 LE values",
            });
            console.log("\nUnpack output:");
            showArgs({
                "<packedfile>.unpack.json": "Unpacked JSON data",
            });
            process.exit(0);
        } else {
            throw new Error(`Unknown option: --${args.name}`);
        }
    }

    if (positional.length === 0) {
        console.error("Error: input file is required");
        process.exit(1);
    }
    if (positional.length > 2) {
        console.error("Error: too many arguments");
        process.exit(1);
    }

    const inputFile = positional[0];
    const typeFile  = positional[1];

    if (path.extname(inputFile).toLowerCase() === ".bin") {
        await doUnpack(inputFile, typeFile, outFile, raw, base, use64bit, noUnpackMappers);
        return;
    }

    await doPack(inputFile, typeFile, outFile, use64bit, raw, strip, base, headerFile);
}

async function doPack(dataFile, typeFile, outFile, use64bit, raw, strip, base, headerFile) {
    const typeDefs = await loadTypeDefs(typeFile);
    const rootType = typeDefs[0].name;
    const data     = await loadFile(dataFile);

    if (use64bit) enable64BitMode(true);
    let result;
    try {
        result = pack(rootType, data);
    } finally {
        if (use64bit) enable64BitMode(false);
    }

    const baseName = outFile
        ? outFile.replace(/\.(bin|reloc\.bin)$/i, "")
        : dataFile.replace(/\.(js|json)$/i, "");

    const binFile = outFile ?? (baseName + ".bin");

    if (!raw) {
        // Combined file layout:
        //   [0..3]   signature (BPAK or BP64)
        //   [4..7]   version
        //   [8..11]  relocation count
        //   [12..15] relocation table offset (from start of file)
        //   [16..23] relocated pointer to start of data (base + HEADER_SIZE); 0 if not relocated
        //            in 64-bit mode occupies all 8 bytes; in 32-bit mode only 4 bytes
        //   [24..31] reserved (zero)
        //   [32..]   packed data (pointers adjusted by HEADER_SIZE, and optionally base)
        //   [reloc..] relocation table (uint32 file-relative offsets)

        const relocTableOffset = strip ? 0 : HEADER_SIZE + result.binary.length;
        const count = strip ? 0 : result.relocations.length;
        const combined = Buffer.alloc(HEADER_SIZE + result.binary.length + count * 4);

        // Write header
        combined.writeUInt32LE(use64bit ? SIGNATURE_64 : SIGNATURE, 0);
        combined.writeUInt32LE(VERSION, 4);
        combined.writeUInt32LE(count, 8);
        combined.writeUInt32LE(relocTableOffset, 12);
        // bytes 16-31: zero (data pointer + reserved); filled below if base is set

        // Copy packed data
        result.binary.copy(combined, HEADER_SIZE);

        // Adjust all pointers: always add HEADER_SIZE, plus base if specified.
        // Both are combined into a single delta so each pointer is written once.
        const delta = BigInt(HEADER_SIZE) + (base ?? 0n);

        for (let i = 0; i < result.relocations.length; i++) {
            const origOffset = result.relocations[i];
            const fileOffset = origOffset + HEADER_SIZE;

            // Always adjust pointer values (HEADER_SIZE + optional base)
            if (use64bit) {
                const lo = combined.readUInt32LE(fileOffset);
                const hi = combined.readUInt32LE(fileOffset + 4);
                const ptr = BigInt(lo) | (BigInt(hi) << 32n);
                const relocated = ptr + delta;
                combined.writeUInt32LE(Number(relocated & 0xFFFFFFFFn), fileOffset);
                combined.writeUInt32LE(Number((relocated >> 32n) & 0xFFFFFFFFn), fileOffset + 4);
            } else {
                const ptr = BigInt(combined.readUInt32LE(fileOffset));
                combined.writeUInt32LE(Number((ptr + delta) & 0xFFFFFFFFn), fileOffset);
            }

            // Only record reloc table entry when not stripping
            if (!strip) {
                combined.writeUInt32LE(fileOffset, relocTableOffset + i * 4);
            }
        }

        // Store relocated pointer to start of data at header offset 0x10
        if (base !== null) {
            const dataPtr = base + BigInt(HEADER_SIZE);
            combined.writeUInt32LE(Number(dataPtr & 0xFFFFFFFFn), 0x10);
            if (use64bit) {
                combined.writeUInt32LE(Number((dataPtr >> 32n) & 0xFFFFFFFFn), 0x14);
            }
        }

        fs.writeFileSync(binFile, combined);
        console.log(`Written: ${binFile} (${combined.length} bytes, ${count} relocations)`);
    } else {
        // Raw mode: write plain binary + separate reloc file.
        // Relocate in-place if --base was specified.
        const rawBuf = Buffer.from(result.binary);

        if (base !== null) {
            relocateBuf(rawBuf, result.relocations, base, use64bit);
        }

        fs.writeFileSync(binFile, rawBuf);
        console.log(`Written: ${binFile} (${rawBuf.length} bytes)`);

        const relocFile = baseName + ".reloc.bin";
        const relocBuf  = Buffer.alloc(result.relocations.length * 4);
        for (let i = 0; i < result.relocations.length; i++) {
            relocBuf.writeUInt32LE(result.relocations[i], i * 4);
        }
        fs.writeFileSync(relocFile, relocBuf);
        console.log(`Written: ${relocFile} (${result.relocations.length} relocations)`);
    }

    if (headerFile) {
        if (use64bit) enable64BitMode(true);
        let header;
        try {
            header = formatTypes();
        } finally {
            if (use64bit) enable64BitMode(false);
        }
        fs.writeFileSync(headerFile, header);
        console.log(`Written: ${headerFile}`);
    }
}

async function doUnpack(binFile, typeFile, outFile, raw, base, use64bit, noUnpackMappers) {
    const typeDefs = await loadTypeDefs(typeFile);
    const rootType = typeDefs[0].name;

    // Work on a mutable copy so we can unrelocate in place
    const buf = Buffer.from(fs.readFileSync(binFile));

    // Detect format and 64-bit mode
    let isCombined = false;
    let is64bit = use64bit;

    if (!raw && buf.length >= 4) {
        const sig = buf.readUInt32LE(0);
        if (sig === SIGNATURE)    { isCombined = true; is64bit = false; }
        if (sig === SIGNATURE_64) { isCombined = true; is64bit = true;  }
    }

    const dataOffset = isCombined ? HEADER_SIZE : 0;

    if (isCombined) {
        // Read the stored data pointer at header offset 0x10.
        // Non-zero means the image was relocated and must be unrelocated first.
        let storedPtr;
        if (is64bit) {
            storedPtr = BigInt(buf.readUInt32LE(0x10)) | (BigInt(buf.readUInt32LE(0x14)) << 32n);
        } else {
            storedPtr = BigInt(buf.readUInt32LE(0x10));
        }

        if (storedPtr !== 0n) {
            const relocOffset = buf.readUInt32LE(12);
            if (relocOffset === 0) {
                console.error("Error: cannot unrelocate — relocation table was stripped from this file");
                process.exit(1);
            }
            const relocBase   = storedPtr - BigInt(HEADER_SIZE);
            const relocCount  = buf.readUInt32LE(8);
            const relocations = [];
            for (let i = 0; i < relocCount; i++) {
                relocations.push(buf.readUInt32LE(relocOffset + i * 4));
            }
            relocateBuf(buf, relocations, -relocBase, is64bit);
        }
    } else {
        // Raw mode: unrelocate if --base is given (requires .reloc.bin)
        if (base !== null) {
            const relocFile = binFile.replace(/\.bin$/i, ".reloc.bin");
            if (!fs.existsSync(relocFile)) {
                console.error(`Error: relocation file not found: ${relocFile}`);
                process.exit(1);
            }
            const relocBuf = fs.readFileSync(relocFile);
            const relocations = [];
            for (let i = 0; i < relocBuf.length; i += 4) {
                relocations.push(relocBuf.readUInt32LE(i));
            }
            relocateBuf(buf, relocations, -base, is64bit);
        }
    }

    if (is64bit) enable64BitMode(true);
    if (noUnpackMappers) disableUnpackMappers(true);
    let result;
    try {
        result = unpack(rootType, buf, dataOffset);
    } finally {
        if (is64bit) enable64BitMode(false);
        if (noUnpackMappers) disableUnpackMappers(false);
    }

    const jsonOut = JSON.stringify(result, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v, 2);

    const defaultOut = binFile.replace(/\.bin$/i, "") + ".unpack.json";
    const destFile   = outFile ?? defaultOut;

    fs.writeFileSync(destFile, jsonOut + "\n");
    console.log(`Written: ${destFile}`);
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
