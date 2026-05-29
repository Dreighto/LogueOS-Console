// `heic-convert` ships no type declarations. The uploads route casts the
// dynamic import to its own HeicConvertFn signature, so an ambient module
// stub is enough to clear the implicit-any error.
declare module 'heic-convert';
