import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = new Map([
  ["/manifest.json", "application/json"],
  ["/reference.wav", "audio/wav"],
  ["/reconstruction.wav", "audio/wav"],
  ["/frozen.wav", "audio/wav"],
  ["/previous.wav", "audio/wav"],
]);

/** Serve only prepared local audition files. No hook runs during production builds. */
export function localAudioReference(read = readFile) {
  return {
    name: "local-audio-reference",
    apply: "serve",
    configureServer(server) {
      const directory = resolve(server.config.root, "artifacts/tyre-reference");
      server.middlewares.use("/__audio-reference", async (request, response) => {
        const pathname = (request.url ?? "").split("?", 1)[0];
        const contentType = files.get(pathname);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405; response.setHeader("Allow", "GET, HEAD"); response.end(); return;
        }
        if (!contentType) { response.statusCode = 404; response.end("Unknown audition file"); return; }
        try {
          const data = await read(resolve(directory, pathname.slice(1)));
          response.setHeader("Content-Type", contentType);
          response.setHeader("Content-Length", data.length);
          response.end(request.method === "HEAD" ? undefined : data);
        } catch {
          response.statusCode = 404; response.end("Local reference audition has not been prepared");
        }
      });
    },
  };
}
