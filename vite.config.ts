import { defineConfig } from "vite";
import { localAudioEvidence } from "./scripts/audio-evidence.mjs";
import { physicsVersion } from "./scripts/physics-version.mjs";
import { audioVersion } from "./scripts/audio-version.mjs";

export default defineConfig({
  define: {
    __PHYSICS_VERSION__: JSON.stringify(physicsVersion()),
    __AUDIO_VERSION__: JSON.stringify(audioVersion()),
  },
  // Isolated worktrees can share dependencies without sharing Vite's mutable cache.
  cacheDir: ".vite",
  plugins: [localAudioEvidence()],
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
        audioLab: "audio-lab.html",
        audioDriving: "audio-driving.html",
      },
    },
  },
});
