import { resolve } from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/lib/index.ts"),
      name: "demTiles",
      fileName: (format) => `dem-tiles.${format}.js`,
      formats: ["es", "umd"],
    },
  },
  plugins: [],
});
