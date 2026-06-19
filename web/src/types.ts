// Mirrors the engine's contract (src/db + src/engine/events.ts). The UI is a
// pure view layer over these — it owns NO orchestration logic.

export type TaskStatus =
  | "idle"
  | "queued"
  | "running"
  | "blocked"
  | "waiting-human"
  | "failed"
  | "retrying"
  | "done";

export interface Floor {
  id: string;
  name: string;
  team: string | null;
}

export interface Worker {
  id: string;
  floor_id: string;
  name: string;
  role: string | null;
  model: string;
  auth_mode: "max" | "apiKey";
}

export interface Task {
  id: string;
  floor_id: string;
  parent_id: string | null;
  specialize: string | null;
  model: string;
  status: TaskStatus;
  input: string | null;
  output: string | null;
  depends_on: string[];
  session_id: string | null;
  retries: number;
  requires_approval: number; // 0 | 1
  approval: "approved" | "rejected" | null;
  worker_id: string | null;
}

export interface Snapshot {
  floors: Floor[];
  workers: Worker[];
  tasks: Task[];
}

export interface EngineEvent {
  taskId: string;
  floorId: string;
  workerId: string | null;
  type: string; // start | thinking | assistant_text | tool_use | finish | error | status-change | run-*
  status: TaskStatus | null;
  payload: unknown;
  ts: string;
}

export interface HistoryEvent {
  id: number;
  taskId: string;
  type: string;
  status: TaskStatus | null;
  ts: string;
}

export interface History {
  floor: Floor;
  floors: Floor[];
  workers: Worker[];
  tasks: Task[];
  events: HistoryEvent[];
}

export type WsMessage =
  | { kind: "snapshot"; data: Snapshot }
  | { kind: "event"; data: EngineEvent };
