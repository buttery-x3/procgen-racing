import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Development-only evidence sink. Fixed local path, bounded JSON, same-origin POST. */
export function localAudioEvidence() {
  return {
    name: "local-audio-evidence",
    configureServer(server) {
      server.middlewares.use("/__audio-evidence", (request, response) => {
        if (request.method !== "POST" || request.headers.origin !== "http://" + request.headers.host) {
          response.statusCode = 403; response.end("Same-origin POST required"); return;
        }
        let body = "", bytes = 0;
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes <= 262144) body += chunk;
        });
        request.on("end", () => {
          if (bytes > 262144) { response.statusCode = 413; response.end("Report too large"); return; }
          try {
            const report = JSON.parse(body);
            if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("Object required");
            const directory = resolve(server.config.root, "artifacts");
            mkdirSync(directory, { recursive: true });
            writeFileSync(resolve(directory, "audio-browser.json"), JSON.stringify(report, null, 2) + "\n");
            response.setHeader("Content-Type", "application/json");
            response.end('{"saved":true}');
          } catch {
            response.statusCode = 400; response.end("Invalid report");
          }
        });
      });
    },
  };
}
