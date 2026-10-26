import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const hash = createHash("sha256");
for (const f of (await readdir("src", { recursive: true }))
  .filter((f) => /\.(ts|css)$/.test(f))
  .sort())
  hash.update(await readFile(`src/${f}`));
hash.update(await readFile("package-lock.json"));
const sourceHash = hash.digest("hex").slice(0, 16),
  files = ["qualification", "desktop-benchmark", "browser-qa", "stress"];
const reports = await Promise.all(
  files.map(async (name) =>
    JSON.parse(await readFile(`artifacts/m8/${name}.json`, "utf8")),
  ),
);
if (reports.some((r) => r.sourceHash !== sourceHash))
  throw new Error("M8 reports must match the frozen runtime source hash.");
if (
  reports[0].attempted !== 25 ||
  reports[0].failed ||
  reports[1].results?.length !== 3 ||
  reports[2].failed ||
  !reports[3].finite
)
  throw new Error(
    "Complete the M8 qualification, benchmark and browser checks before publishing.",
  );
for (let i = 0; i < files.length; i++)
  await writeFile(
    `docs/research/m8-${files[i]}.json`,
    JSON.stringify(reports[i], null, 2),
  );
console.log(
  JSON.stringify({
    sourceHash,
    laps: reports[0].passed,
    browserCases: reports[1].results.length,
    browserChecks: reports[2].checks.length,
    stressCars: reports[3].cars,
  }),
);
