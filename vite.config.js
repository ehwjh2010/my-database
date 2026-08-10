import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        workbench: resolve(__dirname, "panel/index.html"),
        connections: resolve(__dirname, "panel/connections.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@codemirror/") || id.includes("/node_modules/@lezer/"))
            return "codemirror";
          if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/") || id.includes("/node_modules/scheduler/"))
            return "react";
        },
      },
    },
  },
});
