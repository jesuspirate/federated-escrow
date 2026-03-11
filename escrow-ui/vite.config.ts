import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        wasmtest: "wasm-test.html",
      },
      output: {
        manualChunks: undefined,
      },
    },
    target: "esnext",
    minify: "terser",
  },
  optimizeDeps: {
    exclude: ["@fedimint/fedimint-client-wasm-bundler"],
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
