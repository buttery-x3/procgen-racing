import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: "index.html",
        study: "circuit-lab.html",
        benchmark: "m7-benchmark.html",
      },
    },
  },
});
