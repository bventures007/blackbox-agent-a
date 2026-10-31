import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0 },
  server: { host: "127.0.0.1", port: 19744, strictPort: true },
});
