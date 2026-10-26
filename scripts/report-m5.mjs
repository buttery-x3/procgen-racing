import { readFile, writeFile } from "node:fs/promises";
const { summary, records } = JSON.parse(
  await readFile("artifacts/m5/qualification.json", "utf8"),
);
if (summary.attempted < 128)
  throw new Error(
    "Run the complete 128-case M5 campaign before publishing its report.",
  );
const good = records.filter((r) => r.ok);
const extreme = (key) => [...good].sort((a, b) => key(b) - key(a))[0];
const report = {
  ...summary,
  node: process.version,
  coverage: {
    families: [...new Set(records.map((r) => r.recipe.family))],
    terrain: [...new Set(records.map((r) => r.recipe.relief))],
    rhythms: [...new Set(records.map((r) => r.recipe.character))],
    kerbs: [...new Set(records.map((r) => r.settings.kerb))],
    pitsEnabled: records.filter((r) => r.settings.pits).length,
    pitsDisabled: records.filter((r) => !r.settings.pits).length,
    denseScenery: records.filter((r) => r.settings.scenery === "dense").length,
  },
  extremes: {
    slowest: extreme((r) => r.ms),
    largestMesh: extreme((r) => r.triangles),
    mostProps: extreme((r) => r.props),
    mostAdvisories: extreme((r) => r.report.spaceLimited),
  },
  records,
};
await writeFile(
  "docs/research/m5-qualification.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    sourceHash: report.sourceHash,
    attempted: report.attempted,
    passed: report.passed,
    failed: report.failed,
    report: "docs/research/m5-qualification.json",
  }),
);
