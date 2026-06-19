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

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export interface Floor {
  id: string;
  name: string;
  team: string | null;
  instruction: string | null;
  model: string | null;
  cwd: string | null;
  permission_mode: PermissionMode | null;
  mode: "auto" | "manual" | null;
}

export interface RosterWorker {
  name: string;
  role: string;
  model: string;
  systemPrompt?: string;
}

export interface NewTeamConfig {
  name: string;
  instruction?: string;
  model?: string;
  cwd?: string;
  permissionMode?: PermissionMode;
  workers?: RosterWorker[];
}

export interface Worker {
  id: string;
  floor_id: string;
  name: string;
  role: string | null;
  model: string;
  auth_mode: "max" | "apiKey";
  system_prompt: string | null;
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
