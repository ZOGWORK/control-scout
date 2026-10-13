import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import type { Plugin } from "vite";

/** Lists every built file (+ fonts, icons, the shell) for the service worker to
 *  precache, with a version that changes whenever any of them does. */
function swPrecache(): Plugin {
  return {
    name: "cs-sw-precache",
    apply: "build",
    generateBundle(_options, bundle) {
      const pub = (dir: string) => readdirSync(fileURLToPath(new URL(`./public/${dir}`, import.meta.url))).map((f) => `/${dir}/${f}`);
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".map")).map((f) => `/${f}`);
      const files = [...new Set(["/", "/index.html", ...built, ...pub("fonts"), "/manifest.webmanifest"])].filter((f) => f !== "/sw-precache.json");
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw-precache.json", source: JSON.stringify({ version, files }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), swPrecache()],
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
          if (/recharts|d3-|victory/.test(id)) return "vendor-charts";
          if (/radix-ui|@radix-ui|cmdk|sonner/.test(id)) return "vendor-ui";
          if (/motion|framer/.test(id)) return "vendor-motion";
          if (/lucide/.test(id)) return "vendor-icons";
          return undefined;
        },
      },
    },
  },
});
