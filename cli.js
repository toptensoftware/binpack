#!/usr/bin/env node

import { clargs, showArgs, showPackageVersion } from "@toptensoftware/clargs";
import { pack, unpack, registerType, formatTypes, enable64BitMode, disableUnpackMappers } from "./index.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Combined file signature: "BPAK" as uint32 LE
const SIGNATURE  = 0x4B415042;
const VERSION    = 1;
const HEADER_SIZE = 16;

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
    // Default type file lookup
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

async function main() {
    const args = clargs();

    let use64bit  = false;
    let headerFile = null;
    let combine   = true;
    let combined  = null;   // null = auto-detect for unpack, true/false = override
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
        } else if (args.name === "no-combine") {
            combine = !args.readBoolValue();
        } else if (args.name === "combined") {
            combined = true;
        } else if (args.name === "separate") {
            combined = false;
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
                "--64bit":           "Use 64-bit pointer mode when packing (default: 32-bit)",
                "--no-combine":      "Write separate .bin and .reloc.bin files instead of a single combined file",
                "--combined":                 "Force combined-format detection when unpacking",
                "--separate":                 "Force separate-format detection when unpacking",
                "--disable-unpack-mappers":   "Skip unpackMapper functions when unpacking (diagnostic)",
                "--out:<file>":               "Output file name (overrides default derived from input file name)",
                "--header:<file>":   "Write C header file with type definitions (pack mode only)",
                "--help":            "Show this help message",
            });
            console.log("\nArguments:");
            showArgs({
                "<datafile>":    ".js or .json file containing the data to pack",
                "<packedfile>":  ".bin file to unpack back to JSON",
                "[<typefile>]":  ".js or .json file with type definitions (default: binpack.js or binpack.json)",
            });
            console.log("\nPack output (combined mode, default):");
            showArgs({
                "<datafile>.bin":  "Combined file: 16-byte header + packed data + relocation table",
            });
            console.log("\nPack output (--no-combine):");
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

    // Unpack mode: input is a .bin file
    if (path.extname(inputFile).toLowerCase() === ".bin") {
        await doUnpack(inputFile, typeFile, outFile, combined, noUnpackMappers);
        return;
    }

    // Pack mode
    await doPack(inputFile, typeFile, outFile, use64bit, combine, headerFile);
}

async function doPack(dataFile, typeFile, outFile, use64bit, combine, headerFile) {
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

    if (combine) {
        // Combined file layout:
        //   [0..3]   signature
        //   [4..7]   version
        //   [8..11]  relocation count
        //   [12..15] relocation table offset (from start of file)
        //   [16..]   packed data (pointers relocated by +HEADER_SIZE)
        //   [16+packed.length..] relocation table (offsets from start of file)

        const relocTableOffset = HEADER_SIZE + result.binary.length;
        const count = result.relocations.length;
        const combined = Buffer.alloc(relocTableOffset + count * 4);

        // Write header
        combined.writeUInt32LE(SIGNATURE,        0);
        combined.writeUInt32LE(VERSION,           4);
        combined.writeUInt32LE(count,             8);
        combined.writeUInt32LE(relocTableOffset, 12);

        // Copy packed data into combined buffer
        result.binary.copy(combined, HEADER_SIZE);

        // Relocate each pointer within the packed data section by +HEADER_SIZE,
        // then write the relocation table with adjusted offsets
        for (let i = 0; i < count; i++) {
            const origOffset = result.relocations[i];
            const fileOffset = origOffset + HEADER_SIZE;

            // Adjust the pointer value stored in the data
            combined.writeUInt32LE(combined.readUInt32LE(fileOffset) + HEADER_SIZE, fileOffset);

            // Write relocation table entry as file-relative offset
            combined.writeUInt32LE(fileOffset, relocTableOffset + i * 4);
        }

        fs.writeFileSync(binFile, combined);
        console.log(`Written: ${binFile} (${combined.length} bytes, ${count} relocations)`);
    } else {
        fs.writeFileSync(binFile, result.binary);
        console.log(`Written: ${binFile} (${result.binary.length} bytes)`);

        const relocFile = baseName + ".reloc.bin";
        const relocBuf  = Buffer.alloc(result.relocations.length * 4);
        for (let i = 0; i < result.relocations.length; i++) {
            relocBuf.writeUInt32LE(result.relocations[i], i * 4);
        }
        fs.writeFileSync(relocFile, relocBuf);
        console.log(`Written: ${relocFile} (${result.relocations.length} relocations)`);
    }

    // Write C header if requested
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

async function doUnpack(binFile, typeFile, outFile, combinedOverride, noUnpackMappers) {
    const typeDefs = await loadTypeDefs(typeFile);
    const rootType = typeDefs[0].name;

    const buf = fs.readFileSync(binFile);

    // Determine whether the file is in combined format
    let isCombined;
    if (combinedOverride !== null) {
        isCombined = combinedOverride;
    } else {
        isCombined = buf.length >= 4 && buf.readUInt32LE(0) === SIGNATURE;
    }

    // Unpack: for combined files the data starts at HEADER_SIZE and pointers
    // are already file-relative, so passing the whole buffer with offset=HEADER_SIZE
    // lets unpack resolve them correctly.
    const offset = isCombined ? HEADER_SIZE : 0;
    if (noUnpackMappers) disableUnpackMappers(true);
    let result;
    try {
        result = unpack(rootType, buf, offset);
    } finally {
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
