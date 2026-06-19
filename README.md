# Multi-Agent Orchestrator

An orchestrator AI agent decomposes a command into a task graph (DAG) and
dispatches subtasks to specialized worker agents — each able to run on a
different Claude model — then a browser renders the whole thing live as a
side-view space scene (an orchestrator "sun" with worker "planets").

Built phase-by-phase from [ai-workspace/BUILD_PROMPTS.md](ai-workspace/BUILD_PROMPTS.md).
Findings from the de-risking PoC: [ai-workspace/PHASE1_FINDINGS.md](ai-workspace/PHASE1_FINDINGS.md).
AI working notes & progress: [ai-workspace/PROGRESS.md](ai-workspace/PROGRESS.md).

## Stack

- **TypeScript / Node.js** end to end
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) driving Claude Code
  headless — not raw `/v1/messages`
- **SQLite** (better-sqlite3) single-file persistence — the authoritative board
- **WebSocket** (ws) pushing the engine's event stream to the browser
- **React + Vite** front end (`web/`), pure view layer over the event stream

## Architecture rules (enforced)

- Workers **never** talk to each other. Everything routes through the board
  (the task graph in SQLite). 1 task = 1 worker = writes only its own output.
- If two tasks need the same artifact, the planner must serialize them with a
  dependency — never run them in parallel.
- Per-worker auth: `auth_mode` is `max` | `apiKey`. `max` runs with no
  `ANTHROPIC_API_KEY` (uses `claude login`). The `apiKey` path reads the key
  from `settings` and scopes it to that one invocation. The key is never logged
  and never sent to the frontend.
- 8 task states: `idle, queued, running, blocked, waiting-human, failed,
  retrying, done` — all transitions validated by a single state machine
  (`src/db/states.ts`).

## Run it

Prereq: `claude login` (Max subscription). No API key required.

```bash
npm install

# Phase 1 — PoC probe (proves Max auth, model-per-worker, dependency wiring)
npm run poc

# Phase 2 — seed the DB and eyeball the tables
npm run seed

# Phase 3 — run the engine headless (JSON-lines event stream to stdout)
npm run engine -- "Research three sea creatures and write trivia about them"

# Phase 4 — engine + HTTP/WebSocket server on :4000 (has a minimal test client)
npm run server        # then open http://localhost:4000/

# Phase 5 — the space UI (proxies API+WS to :4000)
cd web && npm install && npm run dev   # then open http://localhost:5173/
```

Run the server (`npm run server`) and the web dev server together for the full
experience.

## Layout

```
src/
  probe.ts            one-off SDK event-shape probe (Phase 1)
  poc.ts              throwaway PoC (Phase 1)
  db/
    schema.ts         SQLite schema (floors, workers, tasks, task_events, settings)
    states.ts         8-state machine + validated transitions
    dao.ts            typed data-access layer (status changes go through here)
  seed.ts             seed script (Phase 2)
  engine/
    events.ts         the consolidated EngineEvent contract (Phases 4/5 consume it)
    worker-runner.ts  runs ONE task via the SDK, persists + emits events
    planner.ts        orchestrator decomposes a command into a DAG (PLAN phase)
    scheduler.ts      supervise loop: deps, concurrency, injection, retries
    run.ts            reusable driver (CLI + server share it)
    index.ts          CLI entry point
  server.ts           Express + ws (Phase 4)
public/index.html     minimal test client (Phase 4)
web/                  React + Vite space UI (Phase 5)
ai-workspace/         build prompts, Phase 1 findings, progress notes, screenshots
```

## Human-in-the-loop (Phase 6)

The planner flags the final/irreversible task `requires_approval`. The scheduler
pauses it in `waiting-human` until a human decides via `POST /approve`
(approve → runs, reject → fails). The UI shows an approval banner, inspector
buttons, and the gated planet's own `waiting-human` state.

## Deferred on purpose

Per-worker API-key billing (wire exists, untested until a key is available),
replay (task_events already logs everything), nicer planet sprites (swap seam is in
`web/src/Planet.tsx`).
