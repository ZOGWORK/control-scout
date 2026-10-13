import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Emits /sw.js from src/sw.template.js with this build's version and the
 *  list of every built file (+ fonts, the shell) to precache. The version is
 *  the build time plus a content hash, so each release changes the worker's
 *  bytes (browsers only reinstall a worker whose bytes changed) and cache names
 *  sort by age. */
function serviceWorker(): Plugin {
  return {
    name: "cs-sw",
    apply: "build",
    generateBundle(_options, bundle) {
      const pub = (dir: string) => readdirSync(fileURLToPath(new URL(`./public/${dir}`, import.meta.url))).map((f) => `/${dir}/${f}`);
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".map")).map((f) => `/${f}`);
      const files = [...new Set(["/", "/index.html", ...built, ...pub("fonts"), "/manifest.webmanifest"])];
      const hash = createHash("sha256");
      for (const f of Object.values(bundle)) hash.update(f.fileName).update(f.type === "chunk" ? f.code : typeof f.source === "string" ? f.source : Buffer.from(f.source));
      const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
      const version = `${stamp}-${hash.digest("hex").slice(0, 10)}`;
      const template = readFileSync(fileURLToPath(new URL("./src/sw.template.js", import.meta.url)), "utf8");
      this.emitFile({ type: "asset", fileName: "sw.js", source: template.replace("__VERSION__", version).replace("__FILES__", JSON.stringify(files)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    // .data holds the database and packs (large, locked while written) — never watch it.
    watch: { ignored: ["**/.data/**", "**/dist/**"] },
    proxy: {
      "/api": `http://localhost:${process.env.PORT || 3000}`,
      "/packs": `http://localhost:${process.env.PORT || 3000}`,
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/react-dom|react-router|scheduler|\/react\//.test(id)) return "vendor-react";
          // No manual chunk for recharts/d3: a named chunk also captured small
          // libraries the main app shares with it, which made every page
          // (home included) preload ~417 KB of charts. Left to Vite, charts
          // load only with the pages that draw them.
          if (/radix-ui|@radix-ui|cmdk|sonner/.test(id)) return "vendor-ui";
          if (/motion|framer/.test(id)) return "vendor-motion";
          if (/lucide/.test(id)) return "vendor-icons";
          return undefined;
        },
      },
    },
  },
});
