// Bundlers replace `process.env.NODE_ENV` statically, so the library reads it
// directly. This is the only part of `process` the source relies on; it is
// declared here rather than pulling in @types/node, which would also change
// the typing of timers and other DOM globals. Drop this file if @types/node is
// ever added to the project.
declare const process: { readonly env: { readonly NODE_ENV?: string } };
