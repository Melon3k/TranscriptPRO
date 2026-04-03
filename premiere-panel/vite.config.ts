import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // UXP requires a single HTML entrypoint — inline assets
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "index.js",
        assetFileNames: "index.[ext]",
      },
    },
  },
});
