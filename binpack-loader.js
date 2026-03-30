// Node.js module hook that resolves the 'binpack:types' specifier to the
// type definition file supplied by the CLI.  Registered at pack time via
// node:module register() so that .js data files can import their type
// definitions with:
//
//   import typeDefs from 'binpack:types';

let typeFileUrl = null;

export function initialize(data) {
    typeFileUrl = data?.typeFileUrl ?? null;
}

export function resolve(specifier, context, nextResolve) {
    if (specifier === 'binpack:types') {
        if (!typeFileUrl) {
            throw new Error("'binpack:types' is not available: no type file was resolved");
        }
        return { shortCircuit: true, url: typeFileUrl };
    }
    return nextResolve(specifier, context);
}
