import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "../src/input/Input";

function fixture() {
  const listeners = new Map<string, EventListener>();
  vi.stubGlobal("window", { addEventListener: (name: string, fn: EventListener) => listeners.set(name, fn), removeEventListener: vi.fn() });
  for (const name of ["HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLButtonElement", "HTMLElement"]) vi.stubGlobal(name, class {});
  const doc = { activeElement: null as unknown, querySelector: () => null };
  vi.stubGlobal("document", doc);
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  vi.stubGlobal("navigator", { getGamepads: () => [{ id: "fixture", mapping: "standard", connected: true, buttons, axes: [0] }] });
  const action = vi.fn(), input = new Input(action);
  return { input, action, doc, buttons, listeners };
}
afterEach(() => vi.unstubAllGlobals());
describe("input boundaries around nonmodal workbench controls", () => {
  it("does not turn Space on a summary into a simulation pause", () => {
    const { input, doc, action, listeners } = fixture();
    doc.activeElement = { tagName: "SUMMARY" };
    listeners.get("keydown")!({ code: "Space", repeat: false, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(action).not.toHaveBeenCalled();
    input.dispose();
  });
  it("requires release of held gamepad controls after a UI boundary", () => {
    const { input, buttons } = fixture();
    buttons[7] = { pressed: true, value: 1 };
    expect(input.read(1 / 60).throttle).toBe(1);
    input.clear();
    expect(input.read(1 / 60).throttle).toBe(0);
    buttons[7] = { pressed: false, value: 0 };
    expect(input.read(1 / 60).throttle).toBe(0);
    buttons[7] = { pressed: true, value: 1 };
    expect(input.read(1 / 60).throttle).toBe(1);
    input.dispose();
  });
});
