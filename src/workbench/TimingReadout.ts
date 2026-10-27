import type { SessionSnapshot } from "../race/types";
import { lapTime, deltaTime, splitTime } from "./display";

export class TimingReadout {
  constructor(private root: HTMLElement) {
    root.className = "session-strip compact-timing";
    root.setAttribute("aria-label", "Lap timing and session controls");
    root.innerHTML = `<details class="timing-details" data-ui-menu><summary id="session-mode">PRACTICE / OUT-LAP</summary><div class="context-popup"><strong id="session-message">Cross the chequered line.</strong><p id="session-sectors"></p><small id="session-best">No personal best yet</small><button class="button subtle" data-action="session:practice">Start practice</button></div></details><div class="session-clock"><span id="session-lap">LAP 1</span><strong id="session-time">0:00.000</strong></div><div class="session-delta"><span>DELTA</span><strong id="session-delta">—</strong></div>`;
  }
  update(s: SessionSnapshot, circuit: boolean) {
    this.root.hidden = !circuit;
    this.root.dataset.flag = s.state === "invalid" ? "invalid" : s.flag;
    const node = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    node("session-mode").textContent = s.flag === "pit" ? (s.message.includes("overspeed") ? "PIT OVERSPEED" : "PIT LANE") : s.flag === "yellow" ? (s.message.includes("Wrong way") ? "WRONG WAY" : "OFF CIRCUIT") : s.state === "invalid" ? "INVALID" : s.mode === "practice" ? "PRACTICE" : "TIME TRIAL";
    node("session-mode").title = s.message;
    node("session-mode").setAttribute("aria-label", `${s.mode} / ${s.state}: ${s.message}`);
    node("session-message").textContent = s.message;
    node("session-lap").textContent = `LAP ${Math.max(1, s.lap)} · S${s.nextSector}`;
    node("session-time").textContent = lapTime(s.elapsed);
    node("session-delta").textContent = deltaTime(s.delta);
    node("session-delta").dataset.sign = s.delta !== null && s.delta < 0 ? "ahead" : "behind";
    node("session-best").textContent = s.best ? `PB ${lapTime(s.best.duration)}` : "No personal best for this setup";
    const shown = s.sectors.length ? s.sectors : (s.recent[0]?.sectors ?? []);
    node("session-sectors").textContent = [0, 1, 2].map((i) => `S${i + 1} ${splitTime(shown[i], s.best?.sectors[i])}`).join(" · ");
  }
}
