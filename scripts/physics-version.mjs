import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
export function physicsVersion() {
  const hash = createHash("sha256");
  for (const dir of ["src/physics", "src/vehicle", "src/race"])
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .sort())
      hash.update(readFileSync(`${dir}/${file}`));
  for (const file of [
    "src/track/Alignment.ts",
    "src/track/SurfaceCompiler.ts",
    "src/track/types.ts",
    "package-lock.json",
  ])
    hash.update(readFileSync(file));
  return hash.digest("hex").slice(0, 16);
}
