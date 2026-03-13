import { strict as assert } from "node:assert";
import { test } from "node:test";

import { clargs } from "./index.js";

test("none", () => {

    let args = clargs([]);
    
    assert(!args.next());
});

test("unnamed", () => {

    let args = clargs(["apples"]);
    
    assert(args.next());
    assert.equal(args.name, null);
    assert.equal(args.readValue(), "apples");
    assert(!args.next());
});

test("unnamed x2", () => {

    let args = clargs(["apples", "pears"]);
    
    assert(args.next());
    assert.equal(args.name, null);
    assert.equal(args.readValue(), "apples");

    assert(args.next());
    assert.equal(args.name, null);
    assert.equal(args.readValue(), "pears");
    assert(!args.next());
});

test("switch", () => {

    let args = clargs(["--switch"]);
    
    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readValue(), null);
});



test("named value (assigned)", () => {

    let args = clargs(["--name=value"]);
    
    assert(args.next());
    assert.equal(args.name, "name");
    assert.equal(args.readValue(), "value");
});

test("named value (separated)", () => {

    let args = clargs(["--name", "value"]);
    
    assert(args.next());
    assert.equal(args.name, "name");
    assert.equal(args.readValue(), "value");
});

test("empty value (assigned)", () => {

    let args = clargs(["--name:", "value"]);
    
    assert(args.next());
    assert.equal(args.name, "name");
    assert.equal(args.readValue(), "");
});

test("empty value (separated)", () => {

    let args = clargs(["--name", ""]);
    
    assert(args.next());
    assert.equal(args.name, "name");
    assert.equal(args.readValue(), "");
});

test("short switches", () => {

    let args = clargs(["-abc"]);
    
    assert(args.next());
    assert.equal(args.name, "a");
    assert(args.next());
    assert.equal(args.name, "b");
    assert(args.next());
    assert.equal(args.name, "c");
});

test("short switch + short named value", () => {

    let args = clargs(["-abvalue"]);

    assert(args.next());
    assert.equal(args.name, "a");
    
    assert(args.next());
    assert.equal(args.name, "b");
    assert.equal(args.readValue(), "value");
    assert(!args.next());
});

test("short switch + assigned value", () => {

    let args = clargs(["-a=value"]);

    assert(args.next());
    assert.equal(args.name, "a");
    assert.equal(args.readValue(), "value");
    assert(!args.next());
});

test("short switch + short separated value", () => {

    let args = clargs(["-ab", "value"]);

    assert(args.next());
    assert.equal(args.name, "a");
    
    assert(args.next());
    assert.equal(args.name, "b");
    assert.equal(args.readValue(), "value");
    assert(!args.next());
});




test("unexpected value", () => {

    let args = clargs(["-a=value", "b"]);

    assert(args.next());
    assert.equal(args.name, "a");

    assert.throws(() => args.next());
});


test("switch off value", () => {

    let args = clargs(["--switch=off"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), false);
    assert.throws(() => args.next());
});

test("switch on value", () => {

    let args = clargs(["--switch=on"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), true);
    assert.throws(() => args.next());
});

test("switch false value", () => {

    let args = clargs(["--switch=false"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), false);
    assert.throws(() => args.next());
});

test("switch true value", () => {

    let args = clargs(["--switch=true"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), true);
    assert.throws(() => args.next());
});

test("switch no value", () => {

    let args = clargs(["--switch=no"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), false);
    assert.throws(() => args.next());
});

test("switch yes value", () => {

    let args = clargs(["--switch=yes"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), true);
    assert.throws(() => args.next());
});

test("switch zero value", () => {

    let args = clargs(["--switch=0"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), false);
    assert.throws(() => args.next());
});

test("switch non-zero value", () => {

    let args = clargs(["--switch=10"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), true);
    assert.throws(() => args.next());
});


test("switch value doesn't use separated", () => {

    let args = clargs(["--switch", "off"]);

    assert(args.next());
    assert.equal(args.name, "switch");
    assert.equal(args.readBoolValue(), true);

    assert(args.next());
    assert.equal(args.readValue(), "off");
});



test("integer value", () => {

    let args = clargs(["--val=23"]);

    assert(args.next());
    assert.equal(args.name, "val");
    assert.equal(args.readIntValue(), 23);
    assert(!args.next());
});

test("hex value", () => {

    let args = clargs(["--val=0x23"]);

    assert(args.next());
    assert.equal(args.name, "val");
    assert.equal(args.readIntValue(), 35);
    assert(!args.next());
});


test("integer value throws", () => {

    let args = clargs(["--val=abc"]);

    assert(args.next());
    assert.equal(args.name, "val");
    assert.throws(() => args.readIntValue());
});


test("one-of", () => {

    let args = clargs(["--val=apples"]);

    assert(args.next());
    assert.equal(args.name, "val");
    assert.equal(args.readEnumValue("apples,pears,bananas"), "apples");
});

test("one-of throws", () => {

    let args = clargs(["--val=berries"]);

    assert(args.next());
    assert.equal(args.name, "val");
    assert.throws(() => args.readEnumValue("apples,pears,bananas"));
});


test("terminator", () => {

    let args = clargs(["--"]);

    assert(args.next());
    assert.equal(args.name, "--");
    assert(!args.next());
});

test("command tail", () => {

    let args = clargs(["command", "a", "b", "c"]);

    assert(args.next());
    assert.equal(args.name, null);
    assert.equal(args.readValue(), "command");
    assert.deepStrictEqual(args.readTail(), [ "a", "b", "c" ]);
    assert(!args.next());
});


test("delimited tail", () => {

    let args = clargs(["--", "a", "b", "c"]);

    assert(args.next());
    assert.equal(args.name, "--");
    assert.deepStrictEqual(args.readTail(), [ "a", "b", "c" ]);
    assert(!args.next());
});

