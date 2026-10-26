import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { DEFAULT_PRESET, fixtureControls, REFERENCE_MODEL_ID } from "../src/audio/playground-model.ts";
import { referenceTyreRenderer } from "./reference-tyre-render.mjs";

const modelBytes = readFileSync("artifacts/tyre-reference/control-model.json");
const model = JSON.parse(modelBytes);
if (model.id !== REFERENCE_MODEL_ID) throw new Error("Prepare the expected local model first");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const rms = (pcm) => Math.sqrt(pcm.reduce((sum, n) => sum+n*n, 0)/pcm.length);
function writeWav(path, pcm, rate) {
  const data = Buffer.alloc(44+pcm.length*2);
  data.write("RIFF",0); data.writeUInt32LE(data.length-8,4); data.write("WAVEfmt ",8);
  data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22);
  data.writeUInt32LE(rate,24); data.writeUInt32LE(rate*2,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34);
  data.write("data",36); data.writeUInt32LE(pcm.length*2,40);
  for (let i=0;i<pcm.length;i++) data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,pcm[i]))*32767),44+i*2);
  writeFileSync(path,data);
}
const renders=[];
mkdirSync("artifacts/controlled-tyre",{recursive:true});
for (const rate of [44100,48000]) for (const fixture of ["tyre-cycle","tyre-slide"]) {
  const duration=fixture==="tyre-cycle"?10.5:7;
  const renderer=referenceTyreRenderer(model,rate,DEFAULT_PRESET.tuning);
  const pcm=new Float32Array(Math.round(rate*duration)), timings=[];
  for (let offset=0;offset<pcm.length;offset+=128) {
    const start=performance.now();
    const block=renderer.block(fixtureControls(fixture,offset/rate).tyre);
    timings.push(performance.now()-start);
    pcm.set(block.subarray(0,Math.min(128,pcm.length-offset)),offset);
  }
  if (!pcm.every(n=>Number.isFinite(n)&&Math.abs(n)<.9)) throw new Error("Nonfinite or clipped live render");
  const late=rms(pcm.slice(Math.round(rate*(fixture==="tyre-cycle"?8:5)),Math.round(rate*(fixture==="tyre-cycle"?9:6))));
  if (late<.005) throw new Error("Sustained/re-entered slide lost its signal");
  const filename=`${fixture}-${rate}.wav`;
  writeWav(`artifacts/controlled-tyre/${filename}`,pcm,rate);
  timings.sort((a,b)=>a-b);
  renders.push({fixture,sampleRate:rate,durationSeconds:duration,file:filename,
    rms:rms(pcm),peak:pcm.reduce((max,n)=>Math.max(max,Math.abs(n)),0),lateRms:late,
    hostBlockP95Ms:timings[Math.floor(timings.length*.95)],
    states:renderer.messages.filter(message=>message.type==="state").filter((message,i,all)=>i===0||message.state!==all[i-1].state),
    sha256:hash(readFileSync(`artifacts/controlled-tyre/${filename}`))});
}
const report={scope:"Exact-worklet host renders with actual playground fixtures; excludes browser audio rendering, device behavior and listening acceptance.",
  workletSha256:hash(readFileSync("public/audio/reference-tyre.js")),
  controlsSha256:hash(readFileSync("src/audio/playground-model.ts")),modelId:model.id,modelSha256:hash(modelBytes),renders};
writeFileSync("docs/research/controlled-tyre-renders.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
