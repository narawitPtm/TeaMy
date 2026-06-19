/**
 * Phase 2 — SQLite schema creation / migration.
 *
 * Single-file DB via better-sqlite3 (synchronous, simple). The schema is the
 * authoritative state for the whole system — a crash must never lose work, so
 * everything that matters lives here, not in process memory.
 *
 * Mirrors the locked spec:
 *   floors      — a "floor" == a team
 *   workers     — agents on a floor; auth_mode is 'max' | 'apiKey'
 *   tasks       — the task graph (DAG); depends_on is a JSON array of task ids;
 *                 session_id is the Agent SDK session for resume
 *   task_events — append-only log of raw SDK events (powers replay)
 *   settings    — key/value store (holds ANTHROPIC_API_KEY)
 */
import Database from "better-sqlite3";

export type DB = Database.Database;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS floors (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  team  TEXT,
  instruction     TEXT,   -- extra orchestrator guidance for this team's plans
  model           TEXT,   -- '' / null = auto (planner picks per task); else forced
  cwd             TEXT,   -- working directory workers operate in (optional)
  permission_mode TEXT    -- 'default' | 'acceptEdits' | 'bypassPermissions'
);

CREATE TABLE IF NOT EXISTS workers (
  id        TEXT PRIMARY KEY,
  floor_id  TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  role      TEXT,
  model     TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'max' CHECK (auth_mode IN ('max','apiKey'))
);
CREATE INDEX IF NOT EXISTS idx_workers_floor ON workers(floor_id);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  floor_id      TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  specialize    TEXT,                       -- the worker role/specialty this task wants
  system_prompt TEXT,
  model         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'idle'
                CHECK (status IN ('idle','queued','running','blocked',
                                  'waiting-human','failed','retrying','done')),
  input         TEXT,
  output        TEXT,
  depends_on    TEXT NOT NULL DEFAULT '[]', -- JSON array of task ids
  session_id    TEXT,                        -- Agent SDK session id (for resume)
  retries       INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 0, -- 1 = gate in 'waiting-human' before running
  approval      TEXT,                        -- null (pending) | 'approved' | 'rejected'
  worker_id     TEXT,                        -- the worker assigned to run this task (set at dispatch)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_floor  ON tasks(floor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type    TEXT NOT NULL,                     -- normalized: start|thinking|... or status-change
  payload TEXT NOT NULL,                     -- raw SDK message JSON (stored verbatim)
  ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

/** Open (creating if needed) the SQLite database and ensure the schema exists. */
export function openDb(path = "orchestrator.sqlite"): DB {
  const db = new Database(path);
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}

/** Idempotent migrations for DBs created before a column existed. */
function migrate(db: DB): void {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  if (!cols.has("requires_approval")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.has("approval")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN approval TEXT`);
  }
  if (!cols.has("worker_id")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN worker_id TEXT`);
  }
  const fcols = new Set(
    (db.prepare(`PRAGMA table_info(floors)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [col, ddl] of [
    ["instruction", "ALTER TABLE floors ADD COLUMN instruction TEXT"],
    ["model", "ALTER TABLE floors ADD COLUMN model TEXT"],
    ["cwd", "ALTER TABLE floors ADD COLUMN cwd TEXT"],
    ["permission_mode", "ALTER TABLE floors ADD COLUMN permission_mode TEXT"],
  ] as const) {
    if (!fcols.has(col)) db.exec(ddl);
  }
}
