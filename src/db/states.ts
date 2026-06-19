/**
 * Phase 2 — the 8-state task state machine.
 *
 * Single source of truth for legal status transitions. All status changes MUST
 * go through `assertTransition` (the data-access layer enforces this).
 */

export const TASK_STATES = [
  "idle",
  "queued",
  "running",
  "blocked",
  "waiting-human",
  "failed",
  "retrying",
  "done",
] as const;

export type TaskStatus = (typeof TASK_STATES)[number];

/**
 * Legal transitions. Key = from-state, value = set of allowed to-states.
 * Anything not listed is rejected by `assertTransition`.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  idle: ["queued"], //                       scheduler picks it up
  queued: ["running", "blocked"], //          slot opens, or a dep isn't done
  blocked: ["queued"], //                     dependency completed
  running: ["waiting-human", "done", "failed"],
  "waiting-human": ["running", "failed"], //  human approved (->running) or rejected (->failed)
  failed: ["retrying"], //                    retry policy kicks in
  retrying: ["queued"], //                    re-queued for another attempt
  done: [], //                                terminal
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(
      `Illegal task transition: ${from} -> ${to}. ` +
        `Allowed from '${from}': [${TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
    );
    this.name = "IllegalTransitionError";
  }
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATES as readonly string[]).includes(value)
  );
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws IllegalTransitionError if the transition is not in the table. */
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!isTaskStatus(from)) throw new Error(`Unknown from-state: ${String(from)}`);
  if (!isTaskStatus(to)) throw new Error(`Unknown to-state: ${String(to)}`);
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
