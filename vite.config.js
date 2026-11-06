import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "assets",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        editor: "index.html",
        studio: "studio.html",
      },
    },
  },
});
