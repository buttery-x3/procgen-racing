import { defineConfig } from "vite";
import { physicsVersion } from "./scripts/physics-version.mjs";

export default defineConfig({
  define: { __PHYSICS_VERSION__: JSON.stringify(physicsVersion()) },
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: "index.html",
        study: "circuit-lab.html",
        benchmark: "m7-benchmark.html",
        soloQualification: "m8-lap-test.html",
        soloBenchmark: "m8-benchmark.html",
      },
    },
  },
});
