export const CAMERAS = ["chase", "bonnet", "top", "orbit"] as const;
export type CommandEffect = "view" | "reset" | "setup" | "environment" | "session";
export interface CommandDefinition {
  label: string;
  effect: CommandEffect;
  requiresAppliedDraft: boolean;
}
/** One policy for pointer, keyboard and modal entry points. */
export function commandDefinition(action: string): CommandDefinition {
  if (["car-workshop", "garage"].includes(action)) return { label: "Open car tools", effect: "view", requiresAppliedDraft: true };
  if (/^(category:|explore:|experiment:|circuit-start:|generator:(drive|authored)|track:return)/.test(action))
    return { label: "Change test context", effect: "environment", requiresAppliedDraft: true };
  if (/^session:(trial|practice)$/.test(action))
    return { label: "Start session", effect: "session", requiresAppliedDraft: true };
  if (/^(car:|preset:|assists:)/.test(action) || ["save", "compare", "defaults", "load-baseline", "undo", "redo"].includes(action))
    return { label: "Change or save setup", effect: "setup", requiresAppliedDraft: true };
  if (["drop", "roll-pulse", "pitch-pulse"].includes(action))
    return { label: "Run physical test", effect: "reset", requiresAppliedDraft: true };
  if (action === "reset") return { label: "Reset vehicle", effect: "reset", requiresAppliedDraft: false };
  return { label: action, effect: "view", requiresAppliedDraft: false };
}
export function allowCommand(action: string, pending: boolean) {
  return !pending || !commandDefinition(action).requiresAppliedDraft;
}
export function nextCamera(current: string) {
  return CAMERAS[(CAMERAS.findIndex((m) => m === current) + 1) % CAMERAS.length];
}
