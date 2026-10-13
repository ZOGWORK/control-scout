import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
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
