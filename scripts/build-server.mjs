// Bundle the server ahead of time (npm run build): build/server/index.mjs, plain JavaScript that starts in a few
// seconds. Run through tsx instead, every start compiled the whole server first: about 35 s on a cold cache, and
// the VM's cache never survived (a private /tmp per start, and paths that change with every release), so each
// deploy's requests waited that long in the socket's queue. Dependencies stay outside the bundle (node_modules);
// only our own TypeScript (server/, src/shared/, …) is compiled in.
import { build } from "esbuild";

await build({
  entryPoints: ["server/index.ts"],
  outfile: "build/server/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: "linked",
  logLevel: "warning",
  // Bundled CommonJS helpers expect require; ESM has none of its own.
  banner: { js: 'import { createRequire as __csRequire } from "node:module"; const require = __csRequire(import.meta.url);' },
});
console.log("server bundle: build/server/index.mjs");
