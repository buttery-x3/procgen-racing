import { clamp } from "../core/math";
import type { VehicleTelemetry, WheelTelemetry } from "../vehicle/types";

export const diagramMarkup = `
  <article class="diagram-card"><header><span><i class="axis-dot amber"></i>ROLL <small>FRONT AXLE</small></span><strong id="roll-value">0.0<span>°</span></strong></header>
    <svg id="roll-diagram" class="rig-diagram" viewBox="0 0 260 100" role="img" aria-label="Live front view of body roll and suspension">
      <path class="diagram-grid" d="M30 82H230M130 10v79M65 20v65M195 20v65"/>
      <path id="roll-road" class="road-line" d="M22 82H238"/>
      <path id="roll-spring-left" class="spring-line"/><path id="roll-spring-right" class="spring-line"/>
      <path id="roll-body" class="chassis-line" d="M66 38h128l-9 20H75Z"/>
      <rect id="roll-wheel-left" class="tire-shape" x="53" y="66" width="20" height="17" rx="3"/>
      <rect id="roll-wheel-right" class="tire-shape" x="187" y="66" width="20" height="17" rx="3"/>
      <circle class="com-point" cx="130" cy="48" r="3"/><text x="18" y="97">FL</text><text x="229" y="97">FR</text>
    </svg><footer><span>LEFT <b id="roll-left-load">—</b></span><span>RIGHT <b id="roll-right-load">—</b></span></footer>
  </article>
  <article class="diagram-card"><header><span><i class="axis-dot blue"></i>PITCH <small>SIDE VIEW</small></span><strong id="pitch-value">0.0<span>°</span></strong></header>
    <svg id="pitch-diagram" class="rig-diagram" viewBox="0 0 260 100" role="img" aria-label="Live side view of body pitch and suspension">
      <path class="diagram-grid" d="M30 82H230M130 10v79M65 20v65M195 20v65"/><path id="pitch-road" class="road-line" d="M22 82H238"/>
      <path id="pitch-spring-left" class="spring-line"/><path id="pitch-spring-right" class="spring-line"/>
      <path id="pitch-body" class="chassis-line" d="M44 50 75 42 94 24h65l20 19 34 7v12H44Z"/>
      <circle id="pitch-wheel-left" class="tire-shape" cx="71" cy="73" r="12"/><circle id="pitch-wheel-right" class="tire-shape" cx="191" cy="73" r="12"/>
      <circle class="com-point" cx="130" cy="48" r="3"/><text x="18" y="97">REAR</text><text x="216" y="97">FRONT</text>
    </svg><footer><span>REAR <b id="pitch-rear-travel">—</b></span><span>FRONT <b id="pitch-front-travel">—</b></span></footer>
  </article>
  <article class="diagram-card contact-diagram"><header><span><i class="axis-dot lime"></i>CONTACT <small>TOP VIEW</small></span><strong id="contact-count">4<span>/4</span></strong></header>
    <svg class="rig-diagram" viewBox="0 0 260 100" role="img" aria-label="Four independent tire contact and wheel load indicators">
      <path class="diagram-grid" d="M130 7v85M73 16h114M73 82h114"/>
      <path class="plan-body" d="M105 13h50l8 12v51l-8 11h-50l-8-11V25Z"/>
      <path class="plan-window" d="m107 36 3-12h40l3 12Zm0 29 3 12h40l3-12Z"/>
      <path class="drive-axle" id="drive-front" d="M84 28h92"/><path class="drive-axle" id="drive-rear" d="M84 72h92"/>
      <rect id="contact-fl" x="78" y="17" width="12" height="22" rx="3"/><rect id="contact-fr" x="170" y="17" width="12" height="22" rx="3"/>
      <rect id="contact-rl" x="78" y="61" width="12" height="22" rx="3"/><rect id="contact-rr" x="170" y="61" width="12" height="22" rx="3"/>
      <text id="load-fl" x="20" y="32">—</text><text id="load-fr" x="199" y="32">—</text><text id="load-rl" x="20" y="77">—</text><text id="load-rr" x="199" y="77">—</text>
      <circle class="com-point" cx="130" cy="48" r="3"/>
    </svg><footer><span id="contact-reference">ROAD REFERENCE</span><span id="contact-state">GROUNDED</span></footer>
  </article>`;

function spring(x: number, start: number, end: number) {
  let d = `M${x} ${start}v4`;
  for (let i = 0; i < 6; i++)
    d += `L${x + (i % 2 ? 4 : -4)} ${start + 4 + ((end - start - 8) * (i + 1)) / 7}`;
  return `${d}L${x} ${end - 3}v3`;
}

export class Diagrams {
  private nodes = new Map<string, Element>();
  constructor(private root: HTMLElement) {}
  private el(id: string) {
    let el = this.nodes.get(id);
    if (!el) {
      el = this.root.querySelector(`#${id}`)!;
      this.nodes.set(id, el);
    }
    return el;
  }
  private text(id: string, value: string) {
    this.el(id).textContent = value;
  }
  private attr(id: string, name: string, value: string) {
    this.el(id).setAttribute(name, value);
  }
  update(t: VehicleTelemetry, worldDatum: boolean, drive: string) {
    if (t.wheels.length !== 4) return;
    const angle = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}°`;
    const roll = worldDatum ? t.worldRoll : t.roll,
      pitch = worldDatum ? t.worldPitch : t.pitch;
    this.text("roll-value", angle(roll));
    this.text("pitch-value", angle(pitch));
    this.text("contact-count", `${t.groundedCount}/4`);
    this.attr("roll-body", "transform", `rotate(${roll} 130 48)`);
    this.attr("pitch-body", "transform", `rotate(${-pitch} 130 48)`);
    const wheelY = (w: WheelTelemetry) =>
      75 + clamp(w.compressionRatio - 0.32, -0.5, 0.6) * 30;
    const leftY = wheelY(t.wheels[0]),
      rightY = wheelY(t.wheels[1]);
    this.attr("roll-wheel-left", "y", String(leftY - 8));
    this.attr("roll-wheel-right", "y", String(rightY - 8));
    this.attr("roll-spring-left", "d", spring(63, 48 - roll * 0.9, leftY - 7));
    this.attr(
      "roll-spring-right",
      "d",
      spring(197, 48 + roll * 0.9, rightY - 7),
    );
    const rearY = (wheelY(t.wheels[2]) + wheelY(t.wheels[3])) / 2;
    const frontY = (leftY + rightY) / 2;
    this.attr("pitch-wheel-left", "cy", String(rearY));
    this.attr("pitch-wheel-right", "cy", String(frontY));
    this.attr(
      "pitch-spring-left",
      "d",
      spring(71, 48 + pitch * 0.7, rearY - 6),
    );
    this.attr(
      "pitch-spring-right",
      "d",
      spring(191, 48 - pitch * 0.7, frontY - 6),
    );
    this.attr(
      "roll-road",
      "transform",
      `rotate(${worldDatum ? t.roadRoll : 0} 130 82)`,
    );
    this.attr(
      "pitch-road",
      "transform",
      `rotate(${worldDatum ? -t.roadPitch : 0} 130 82)`,
    );
    this.text("roll-left-load", `${(t.wheels[0].load / 1000).toFixed(1)} kN`);
    this.text("roll-right-load", `${(t.wheels[1].load / 1000).toFixed(1)} kN`);
    this.text(
      "pitch-rear-travel",
      `${Math.round((t.wheels[2].compression + t.wheels[3].compression) * 500)} mm`,
    );
    this.text(
      "pitch-front-travel",
      `${Math.round((t.wheels[0].compression + t.wheels[1].compression) * 500)} mm`,
    );
    for (const wheel of t.wheels) {
      this.attr(
        `contact-${wheel.id}`,
        "class",
        !wheel.grounded
          ? "contact-off"
          : wheel.absActive
            ? "contact-abs"
            : Math.abs(wheel.slipRatio) > 0.16 ||
                Math.abs(wheel.slipAngle) > 0.14
              ? "contact-slip"
              : "contact-on",
      );
      this.attr(
        `contact-${wheel.id}`,
        "transform",
        `rotate(${(wheel.steer * 180) / Math.PI} ${wheel.id.endsWith("l") ? 84 : 176} 28)`,
      );
      this.text(
        `load-${wheel.id}`,
        wheel.grounded ? `${(wheel.load / 1000).toFixed(1)} kN` : "AIR",
      );
    }
    this.attr("drive-front", "opacity", drive === "rwd" ? "0.2" : "1");
    this.attr("drive-rear", "opacity", drive === "fwd" ? "0.2" : "1");
    this.text(
      "contact-reference",
      t.roadReferenceValid
        ? worldDatum
          ? "WORLD REFERENCE"
          : "ROAD REFERENCE"
        : "REFERENCE UNAVAILABLE",
    );
    this.text(
      "contact-state",
      t.groundedCount === 4
        ? "GROUNDED"
        : t.groundedCount === 0
          ? "AIRBORNE"
          : "PARTIAL CONTACT",
    );
  }
}
