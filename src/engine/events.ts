/**
 * Phase 3 — the consolidated event stream.
 *
 * Every status transition AND every agent event flows through here, tagged
 * uniformly. This JSON-lines stream is the CONTRACT the future WebSocket + UI
 * (Phases 4–5) consume, so keep the shape stable.
 */

export interface EngineEvent {
  taskId: string;
  floorId: string;
  workerId: string | null;
  /** normalized agent event (start|thinking|...) OR "status-change" */
  type: string;
  /** the task's status at emit time (handy for the UI) */
  status: string | null;
  payload: unknown;
  ts: string;
}

export type EventSink = (ev: EngineEvent) => void;

/** Default sink: one JSON line per event to stdout. */
export const stdoutSink: EventSink = (ev) => {
  process.stdout.write(JSON.stringify(ev) + "\n");
};

export function makeEmitter(sink: EventSink) {
  return (
    e: Omit<EngineEvent, "ts"> & { ts?: string },
  ): EngineEvent => {
    const ev: EngineEvent = { ...e, ts: e.ts ?? new Date().toISOString() };
    sink(ev);
    return ev;
  };
}
