import fs from 'node:fs';
import { argv } from 'node:process';

export function clargs(args)
{
    if (!args)
        args = process.argv.slice(2);

    let argIndex = -1;       // Index in args
    let shortArgIndex = -1;  // Character index in current short arg "-abc"
    let argVal = null;
    let argName = null;
    let resolvedVal = undefined;

    function capture()
    {
        return { argIndex, shortArgIndex, argVal, argName, resolvedVal }
    }

    function restore(val)
    {
        ({ argIndex, shortArgIndex, argVal, argName, resolvedVal } = val);
    }

    function next()
    {
        if (shortArgIndex >= 0 && shortArgIndex + 1 < argName.length)
        {
            shortArgIndex++;

            // Last short arg can pick up the : or = value
            if (shortArgIndex == argName.length - 1)
            {
                argName = argName[shortArgIndex];
                shortArgIndex = -1;
            }
            return true;
        }  
        if (argVal != null)
            throw new Error(`unexpected value: '${argVal}'`);

        argIndex++;
        if (argIndex >= args.length)
            return false;

        shortArgIndex = -1;
        argName = null;
        argVal = args[argIndex];
        resolvedVal = undefined;

        if (argVal == "--")
        {
            argName = "--";
            argVal = null;
            return true;
        }

        let m = argVal.match(/^(?:(--?)(.+?)(?:[:=](.*))?)$/)
        if (m)
        {
            argName = m[2];
            argVal = m[3] ?? null;
            if (m[1] == '-')
            {
                if (argName.length > 1)
                    shortArgIndex = 0;
            }
        }


        return true;
    }

    function getName()
    {
        if (shortArgIndex >= 0)
        {
            return argName[shortArgIndex];
        }
        else
        {
            return argName;
        }
    }

    function readValue()
    {
        if (resolvedVal !== undefined)
            return resolvedVal;
        
        if (shortArgIndex >= 0)
        {
            if (shortArgIndex + 1 == argName.length)
            {
                resolvedVal = argVal;
                argVal = null;
            }
            else
            {
                resolvedVal = argName.substring(shortArgIndex + 1);
                shortArgIndex = argName.length;
            }
        }
        else
        {
            if (argVal == null && argIndex + 1 < args.length)
            {
                resolvedVal = args[++argIndex];
            }
            else
            {
                resolvedVal = argVal;
            }
            argVal = null;
        }
        return resolvedVal;
    }

    function readTail()
    {
        if (shortArgIndex >= 0)
            throw new Error(`unconsumed arguments '${argName.substring(shortArgIndex + 1)}' before tail`);
        let val = args.slice(argIndex + 1);
        argIndex = args.length;
        return val;
    }

    function readBoolValue()
    {
        // -abc
        if (shortArgIndex >= 0)
            return true;

        // --switch
        if (argName != null && argVal == null)
            return true;

        // Zero vs non-zero value?
        let num = parseFloat(argVal);
        if (!isNaN(num))
            return num != 0;

        // --switch:value or unnamed value
        switch (argVal.toLowerCase())
        {
            case "true":
            case "on":
            case "yes":
                return true;

            case "false":
            case "off":
            case "no":
                return false;
        }

        throw new Error(`expected a boolean value, not ${argVal}`);
    }

    function readIntValue()
    {
        let val = parseInt(readValue());
        if (isNaN(val))
            throw new Error(`expected integer value, not ${readValue()}`);
        return val;
    }

    function readFloatValue()
    {
        let val = parseFloat(readValue());
        if (isNaN(val))
            throw new Error(`expected numeric value, not ${readValue()}`);
        return val;
    }

    function readEnumValue(values)
    {
        if (!Array.isArray(values))
            values = values.split(/[|,]/);

        values = values.map(x => x.toLowerCase());
        
        let val = readValue();
        if (values.indexOf(val.toLowerCase()) < 0)
            throw new Error(`expected one of ${values.join("|")} not ${val}`);

        return val;
    }

    function peekValue()
    {
        let save = capture();
        let value = readValue();
        restore(save);
        return value;
    }

    return {
        next,
        get name() { return getName() },
        get peekValue() { return peekValue() },
        readValue,
        readBoolValue,
        readIntValue,
        readFloatValue,
        readTail,
        readEnumValue,
        capture,
        restore,
    }
}


// Word break a line
function break_line(str, max_width, indent)
{
    if (!indent)
        indent = '';
    // Does it fit?
    if (str.length <= max_width)
        return str;

    // Find the last space that does fit
    for (let i=max_width-1; i>=0; i--)
    {
        if (str[i] == ' ')
        {
            return str.substring(0, i) + "\n" + break_line(indent + str.substring(i+1), max_width, indent);
        }
    }

    // No break positions
    return str;
}

function format_aligned(items)
{
    // Work out width of first column
    let colWidth = 0;
    for (let i of items)
    {
        if (i[0].length > colWidth)
            colWidth = i[0].length;
    }
    if (colWidth > 40)
        colWidth = 40;

    // Format lines
    let lines = "";
    for (let i of items)
    {
        // Set with the first column text
        let str = i[0];

        // Wrap the second column text
        let help = i[1].split('\n').map(x => break_line(x, process.stdout.columns - 40, ''));

        // Format second column, wrapping over multiple lines if necessary
        let first = true;
        for (let h of help)
        {
            for (let hl of h.split("\n"))
            {
                // First column is wider than the column width, insert a line break
                if (str.length > colWidth)
                {
                    lines += "  " + str + "\n";
                    str = "";
                }

                // Format second column
                lines += "  " + str.padEnd(colWidth + (first ? 4 : 6), ' ') + hl + "\n";
                str = '';
                first = false;
            }
        }
    }
    
    return lines.trimEnd();
}


export function showArgs(args)
{
    let items = [];
    for (let k of Object.keys(args))
    {
        items.push([k, args[k]]);
    }
    console.log(format_aligned(items));
}

export function showPackageVersion(packageFile)
{
    let pkg = JSON.parse(fs.readFileSync(packageFile), "utf8");

    // Display name, version and description
    console.log(`${pkg.name} ${pkg.version} - ${pkg.description}`);

    // Display either copyright message, or author and license
    if (pkg.copyright)
    {
        console.log(pkg.copyright);
    }
    else
    {
        let attrs = [];
        if (typeof(pkg.author) === 'string')
            attrs.push(`By ${pkg.author}`);
        if (typeof(pkg.license) === 'string')
            attrs.push(`License: ${pkg.license}`);
        if (attrs.length > 0)
            console.log(attrs.join(". "));
    }
}