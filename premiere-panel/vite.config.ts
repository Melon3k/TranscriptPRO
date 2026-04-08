import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: ".",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      formats: ["iife"],
      name: "TranscriptPRO",
      fileName: () => "index.js",
    },
    rollupOptions: {
      // Bundle everything into a single IIFE
      output: {
        inlineDynamicImports: true,
      },
    },
    target: "es2020",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
