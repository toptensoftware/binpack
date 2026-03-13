# clargs

A tiny, flexible, easy to use library for 
processing command line arguments.

## Why?

There are already quite a few command line processing libraries for Node so why another?

Well over the years I've tried them all (a lot of them anyway) and 
they're all ok but there's always something annoying or not supported. They're 
either 

* too big, too cumbersome and trying to do everything all at once, or
* too minimal and too quiet about mistyped arguments.  
* some have no support for help output, 
* some don't support sub-commands or it's complicated to setup
* many require an up-front definition or configuration of arguments which 
  is fine when what you need fits, but breaks hard when it doesn't.
* some don't support, or require special up-front configuration to support
  order-sensitive or multiple value arguments.

`clargs` tries to sit somewhere in the middle by:

* Not requiring an upfront definition of arguments.
* Leaving argument iteration and processing to you.
* Keeping argument processing separate from help display.



## Features

Argument processing:

* Positional arguments eg: `file.txt`
* Long switches: `--switch`
* Short switches: `-a`
* Run-on switches: `-abc` (same as `-a -b -c`)
* Long named values: `--name=value` or `--name:value` or `--name value`
* Short named values: `-avalue` or `-a value`
* Run-on short switches with one named value: `-abcvalue` => `-a -b -c:value`
* Negative switches: `--switch:no` 
* Delimiter argument: `--`
* Tail arguments (all remaining argument)
* Support for string, boolean, integer, floating point and one-of 
  (enum) values.  Other types you can just parse yourself as you process the arguments.
* Look ahead and rewind current position.


Although not technically features of the library, due to the way arguments
are processed it also supports:

* Multiple arguments: `-Ipath1 -Ipath2 -Ipath3`
* Ordered arguments: `--dothis --thenthat --finallythis`
* Sub-command processing: just break out of current argument iteration
  loop and start a new one for the sub-command using the tail arguments

Also included are helper functions for displaying version and help information:

* Helper for displaying version info from `package.json`
* Helper for formatting argument help into two aligned and wrapped
  columns.

## Installation

```
npm install --save toptensoftware/clargs
```

*Note: installs from GitHub, not NPM hence no `@` on the package name
when installing*

## Parsing Arguments

Import `clargs` function.

```js
import { clargs } from "@toptensoftware/clargs";
```

Create an instance, by calling the `clargs()` function.  With no arguments
it uses `process.argv`:

```js
// Uses process.argv.slice(2)
let args = clargs();     
```

or, supply your own args to be processed:

```js
let args = clargs(["arg1", "arg2"]);
```

Then iterate the arguments:

```js
let port = 3000;
let verbose = false;
let theRest;
while (args.next())
{
    switch (args.name)
    {
        case "h": 
        case "help":
            // -h or --help
            showHelp();
            process.exit(0);
            break;

        case "verbose": 
            // --verbose (same as yes)
            // --verbose:yes 
            // --verbose:no
            verbose = args.readBoolValue();
            break;

        case "port":    
            // eg: --port:4000
            port = args.readIntValue();
            break;

        case "--":
            // eg: -- tail1 tail2
            // tail = [ "tail1", "tail2" ]
            theRest = args.readTail();
            break;

        case null:
            // unnamed arg eg: file.txt
            file = args.readValue();
            break;

        default:
            throw new Error(`unknown arg: ${args.name}`);
    }
}
```

The `args` object supports the following:

* `next()` - moves to the next argument, returning `true` if one is available
  otherwise `false`.

* `name` - the name of the current argument or `null` for unnamed (aka positional) arguments, or `"--"` if the argument is `"--"`.

* `readValue()` - the value of the argument.

  For unnamed arguments this is the value as specified.

  For named values these are delimited with `:` or `=`.  (eg: `--name:value`) or spearated as the next argument (eg: `--name value`)

  For short named values these are either delimited, separated, or the rest of 
  the short value string.  eg: `-avalue` gives name "a" and value "value"

  `readValue` (and typed variations below) will always return the same value
  until `next()` is called to move to the next argument.  The reason these
  are methods and not property accessors is because the first call to `readValue`
  may affect the internal state.  
  
  For example, when reading the value of short name arguments or argument with
  separated values the current position may be internally advanced after reading 
  the value.

  In other words, a call `readValue()` (and variants) indicates the value has 
  been consumed and used.

* `peekValue` - gets the value of the argument without disrupting the 
  internal state.

* `readTail()` - returns all arguments after the current one as an array and
  causes the next call to `next()` to return `false`.

* `readBoolValue()` - the boolean value of the current arguments.  

  For switches with no value this returns `true`.  Otherwise the value 
  must be one of `yes`, `true`, `on`, `1` (or any non-zero number) or 
  `no`, `false`, `off`, `0`.

  `readBoolValue` never reads from the next argument ie: `--switch false` won't negate a switch.

* `readIntValue()` - the current value parsed with `parseInt`.  Throws an error
  if `parseInt` return `NaN`

* `readFloatValue()` - the current value parsed with `parseFloat`.  Throws an 
  error if `parseFloat` return `NaN`

* `readEnumValue(allowed)` - returns one of the allowed values, or throws an
  error.  
  
  `allowed` can be an array of strings, or a string with values
  separated by commas (`,`) or vertical bars (`|`).  eg: `"apples|pears|bananas"`.

* `capture()` - returns an object that captures the current state of the 
  iteration loop

* `restore(state)` - restores a previously capture state



## Displaying Version Info

The `showPackageVersion` function can be used to show a version banner using information from a `package.json` file.

eg: 

```js
import { showPackageVersion } from "@toptensoftware/clargs";

showPackageVersion(path.join(__dirname, "package.json"));
```

writes to console a message similar to:

```
${pkg.name} ${pkg.version} - ${pkg.description}
${pkg.copyright}
```

If the package doesn't contain a `copyright` field it instead displays `author` and `license`.


## Displaying Argument Help

The `showArgs` function displays aligned and wrapped
text help for command arguments:

```js
import { showArgs } from "@toptensoftware/clargs";

showArgs({
    "--arg2": "arg 1 description"
    "--arg2": "arg 2 description"
});
```

The `showArgs` function aligns the arguments and descriptions into two columns, wrapping the right description column at the terminal width (if output is being sent to a console terminal).

## License

See LICENSE file
