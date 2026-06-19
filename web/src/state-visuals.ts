// State -> visual mapping. State is shown by COLOR + ANIMATION, never by shape.
// blocked vs waiting-human vs failed are each given a distinct treatment so the
// same "amber wobble" never means three things.
import type { TaskStatus } from "./types";

export interface StateVisual {
  /** planet fill */
  color: string;
  /** glow/halo color */
  glow: string;
  /** CSS animation class applied to the planet group */
  anim:
    | "still"
    | "pulse-faint" // queued
    | "waves" // running (signal-wave rings, handled separately too)
    | "pulse-amber" // blocked
    | "blink-needs-you" // waiting-human
    | "shake" // failed
    | "spin" // retrying
    | "settled"; // done
  label: string;
  /** show expanding signal-wave rings */
  rings?: boolean;
  /** show a blinking "needs you" marker */
  needsYou?: boolean;
}

export const STATE_VISUALS: Record<TaskStatus, StateVisual> = {
  idle: { color: "#3a4150", glow: "transparent", anim: "still", label: "idle" },
  queued: { color: "#5566aa", glow: "#7d8fd6", anim: "pulse-faint", label: "queued" },
  running: { color: "#39c0ff", glow: "#39c0ff", anim: "waves", label: "running", rings: true },
  blocked: { color: "#e0a32e", glow: "#e0a32e", anim: "pulse-amber", label: "blocked" },
  "waiting-human": {
    color: "#b06cff",
    glow: "#d8b3ff",
    anim: "blink-needs-you",
    label: "waiting · needs you",
    needsYou: true,
  },
  failed: { color: "#ff4d4d", glow: "#ff4d4d", anim: "shake", label: "failed" },
  retrying: { color: "#ff8a5c", glow: "#ffb38a", anim: "spin", label: "retrying" },
  done: { color: "#3fcf6a", glow: "#3fcf6a", anim: "settled", label: "done" },
};

export const ALL_STATES: TaskStatus[] = [
  "idle",
  "queued",
  "running",
  "blocked",
  "waiting-human",
  "failed",
  "retrying",
  "done",
];
