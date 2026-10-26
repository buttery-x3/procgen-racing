import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

import { localAudioReference } from "../../scripts/audio-reference.mjs";
const readFile = vi.fn();

function request(url, method = "GET") {
  const headers = new Map();
  let handler;
  localAudioReference(readFile).configureServer({
    config: { root: process.cwd() },
    middlewares: { use: (_route, value) => { handler = value; } },
  });
  const response = { statusCode: 200, setHeader: (key, value) => headers.set(key, value) };
  return new Promise((done) => {
    response.end = (body) => done({ status: response.statusCode, body, headers });
    void handler({ url, method }, response);
  });
}

describe("local reference audition files", () => {
  beforeEach(() => { readFile.mockReset(); });

  it("serves the fixed audition file with no cache, including HEAD", async () => {
    const data = Buffer.from("prepared WAV"); readFile.mockResolvedValue(data);
    const result = await request("/reconstruction.wav?fresh=1");
    expect(readFile).toHaveBeenCalledWith(resolve(process.cwd(), "artifacts/tyre-reference/reconstruction.wav"));
    expect(result.status).toBe(200); expect(result.body).toBe(data);
    expect(result.headers.get("Content-Type")).toBe("audio/wav");
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect((await request("/reference.wav", "HEAD")).body).toBeUndefined();
  });

  it("never reads arbitrary files or traversal paths", async () => {
    for (const path of ["/../package.json", "/%2e%2e/package.json", "/private.wav", "/reference.wav/extra"]) {
      expect((await request(path)).status).toBe(404);
    }
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects writes and handles a not-yet-prepared local comparison", async () => {
    expect((await request("/reference.wav", "POST")).status).toBe(405);
    expect(readFile).not.toHaveBeenCalled();
    readFile.mockRejectedValue(new Error("ENOENT private path"));
    const missing = await request("/manifest.json");
    expect(missing.status).toBe(404);
    expect(missing.body).toBe("Local reference audition has not been prepared");
  });
});
