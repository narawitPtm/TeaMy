# Multi-Agent Orchestrator — Build Prompts (All Phases)

## How to use this file

These are sequential build prompts for Claude Code. Run them one phase at a time, in order.

Phases 2–5 are **DRAFTS**. They are written before Phase 1 has run, so they encode assumptions about the Claude Agent SDK (event schema, auth behavior, model selection) that may turn out wrong. After each phase runs, take what you learned (especially the real event-stream shape) and edit the next phase's prompt to match reality before running it. **Do not fire all five blindly.**

### Locked spec (applies to every phase)

- **Stack:** TypeScript / Node.js, end to end
- **Engine:** Claude Agent SDK (the official SDK wrapping the agent loop), driving Claude Code headless — NOT raw `/v1/messages` calls
- **Persistence:** SQLite (single file)
- **Realtime:** WebSocket pushing events to the browser
- **Auth:** per-worker `authMode: 'max' | 'apiKey'`; API key stored in settings, never logged, never sent to the frontend
- **Concurrency:** limiter, default max 2–3 workers at once
- **States:** 8 — `idle, queued, running, blocked, waiting-human, failed, retrying, done`
- **Architecture rule:** workers NEVER talk to each other directly. Everything goes through a central board (the task graph). 1 task = 1 worker = writes only its own output. If two tasks need the same file, force a dependency (serialize), never parallel.
- **UI theme:** side-view space. Each team is one cluster: an orchestrator "sun" on the left, worker "planets" to the right. Multiple teams = multiple clusters in one view. NO orbiting motion. Workers are planets only (no ships/satellites). State is shown by color + animation (signal waves / spin / shake), never by shape. Dashed beams originate from the orchestrator only — never planet-to-planet.
- **Assets:** start with SVG-drawn placeholders (or Deep-Fold planet exports). Asset swap is a late, non-blocking step — it never touches engine logic.

---

## Phase 1 — PoC: prove the core (Max auth + model-per-worker + dependency wiring)

**Goal:** de-risk the riskiest assumptions before building anything real. CLI only. No web server, no DB, no frontend. You currently have NO API key — run against Max only.

```
# Project: Multi-Agent Orchestrator — Phase 1 PoC

I'm building a web app where an "orchestrator" AI agent decomposes a command
into subtasks and dispatches them to specialized "worker" agents, each able to
run on a different model. This is Phase 1: a headless proof-of-concept to
validate the core risk BEFORE building the full system. Do NOT build a web
server, DB, or frontend yet. CLI only.

## Stack
- TypeScript, Node.js
- Claude Agent SDK (the official Anthropic SDK that wraps the agent loop) — NOT
  raw /v1/messages API calls. Check the current package name and API surface.

## Auth situation (important)
- I currently have NO API key. I will run everything against my Claude Max
  subscription via `claude login`.
- So every worker in this PoC uses authMode = 'max' (no ANTHROPIC_API_KEY set).
- BUT design the worker config so an authMode = 'apiKey' option exists and is
  easy to flip on later (it would set ANTHROPIC_API_KEY only for that worker's
  invocation). Just don't exercise the apiKey path yet — I'll test it once I
  have a key. Leave a clear TODO where the key would be injected.

## What this PoC must prove (with Max only)
1. The orchestrator runs against my Max subscription with no API key present.
2. Two workers can run on DIFFERENT models in the same run.
3. Task dependency wiring works: worker A's output is injected as worker B's input.
4. I can capture a structured event stream per agent (start, tool use, result,
   finish) and print it as JSON lines.

## Behavior
- Input: a hardcoded command, e.g. "Write a haiku about the ocean, then count
  the syllables in it."
- Orchestrator decomposes into exactly 2 subtasks with a dependency:
  - task A (no deps): write the haiku
  - task B (depends on A): count syllables in A's output
- Each worker has its own config: { id, systemPrompt, model, authMode }
  - worker A: a capable model (e.g. Sonnet), authMode = 'max'
  - worker B: a cheaper/faster model (e.g. Haiku), authMode = 'max'
  (Different models on purpose, to prove model-per-worker works.)
- Run A, wait, inject A's output into B's input, run B. Sequential is fine for
  the PoC — just prove the dependency wiring is real.
- Build a concurrency limiter capped at 2 (trivial here but make it reusable).

## Auth handling
- authMode = 'max': spawn the agent WITHOUT ANTHROPIC_API_KEY in its env so it
  uses my Max login.
- authMode = 'apiKey': (not used yet) would set ANTHROPIC_API_KEY for that agent
  only. Leave a TODO. Never log a key value.

## Output
- Print every agent event as a JSON line: { taskId, workerId, type, payload, ts }
- At the end: print task B's final result and a summary table — which worker
  used which model + authMode, and whether each succeeded.

## Important
- Before writing real code, check the actual current Claude Agent SDK API and the
  exact way to run it headless with a chosen model. The SDK's JSON output schema
  is not documented to assume — run one tiny test invocation first, inspect the
  top-level keys, then build on what's real.
- Add a per-worker timeout (e.g. 120s) so a stuck agent fails instead of hanging.
- Keep it small, readable, one file. This is a throwaway probe to de-risk the
  design, not production code.

After it runs, tell me:
- Did it work against Max with no API key present?
- Did the two workers actually run on different models?
- Did A's output correctly flow into B?
- Paste a sample of the event stream so I can see its real shape.
```

**Before moving on:** confirm all four answers are yes. Capture the REAL event-stream shape — you'll paste it into Phase 2 and 4 so those phases build on facts, not guesses.

---

## Phase 2 — Data model: SQLite schema + 8-state machine

**Goal:** define the single source of truth everything else hangs off. Still headless. Before running, paste in the real event shape you captured in Phase 1.

```
# Phase 2 — Data model & state machine (headless, no web/frontend yet)

Building on the Phase 1 PoC. Now define the persistent data model and the task
state machine. Still CLI/headless — no web server or frontend yet.

## Stack
- TypeScript, Node.js, SQLite (use better-sqlite3 unless you have a strong reason
  not to — single-file, synchronous, simple).

## Schema (adjust types as needed, keep the shape)
- floors(id, name, team)                      -- a "floor" == a team
- workers(id, floor_id, name, role, model, auth_mode)   -- auth_mode: 'max' | 'apiKey'
- tasks(id, floor_id, parent_id, specialize, system_prompt, model,
        status, input, output, depends_on, session_id, created_at, updated_at)
        -- depends_on: JSON array of task ids
        -- session_id: the Agent SDK session id, stored so we can resume
- task_events(id, task_id, type, payload, ts)  -- append-only log; powers replay
- settings(key, value)                          -- stores ANTHROPIC_API_KEY here

Everything derives from these tables. Never keep authoritative state only in
process memory — a crash must not lose work.

## State machine (8 states)
idle, queued, running, blocked, waiting-human, failed, retrying, done

Implement transitions as code with a single function that validates them. Legal
transitions (adjust if I'm wrong, but enforce *some* explicit set):
- idle -> queued            (task picked up by scheduler)
- queued -> running         (a worker slot opened)
- queued -> blocked         (a dependency isn't done yet)
- blocked -> queued         (dependency completed)
- running -> waiting-human   (worker raised a human-gate)
- waiting-human -> running   (human approved)
- running -> done
- running -> failed
- failed -> retrying
- retrying -> queued
Reject any transition not in the table, with a clear error.

## Event shape
Here is the REAL event shape captured from Phase 1's Agent SDK output
(@anthropic-ai/claude-agent-sdk@0.3.181). The raw SDK stream is an async
iterator of these message types; the PoC normalizes them to a clean event:
  { taskId, workerId, type, payload, ts }
where `type` ∈ start | thinking | assistant_text | tool_use | finish | error
and `payload` is the raw SDK message (stored verbatim as JSON).

Raw top-level message types: system (subtypes: init, hook_*, thinking_tokens,
post_turn_summary), assistant, rate_limit_event, result (subtype: success|error_*).

  // system/init  -> normalized "start"
  { "type":"system","subtype":"init","cwd":"...","session_id":"d12dfad7-...",
    "tools":[...],"model":"claude-sonnet-4-6","permissionMode":"default",
    "apiKeySource":"none","claude_code_version":"2.1.181","uuid":"..." }

  // assistant -> "thinking" | "assistant_text" | "tool_use" by content block
  { "type":"assistant",
    "message":{ "model":"claude-haiku-4-5-20251001","id":"msg_...","role":"assistant",
      "content":[ {"type":"thinking","thinking":"...","signature":"..."},
                  {"type":"text","text":"..."} ],
                  // tool calls: {"type":"tool_use","id","name","input"}
      "stop_reason":null,
      "usage":{"input_tokens":3,"output_tokens":492,"cache_read_input_tokens":0,...} },
    "parent_tool_use_id":null,"session_id":"...","uuid":"...","request_id":"req_..." }

  // result -> "finish" (is_error:false) | "error" (is_error:true)
  { "type":"result","subtype":"success","is_error":false,
    "duration_ms":10844,"num_turns":1,
    "result":"<final text>","stop_reason":"end_turn","session_id":"...",
    "total_cost_usd":0.0107,
    "usage":{"input_tokens":10,"output_tokens":394,"cache_read_input_tokens":19330,...},
    "modelUsage":{"claude-haiku-4-5-20251001":{"inputTokens","outputTokens","costUSD",...}},
    "permission_denials":[],"terminal_reason":"completed","uuid":"..." }

Key facts: final text = result.result; session_id is on EVERY message (store it
for resume); cost/usage on the result message. Make task_events.payload able to
store these faithfully (store raw JSON, no lossy mapping).

## Deliverables
- Schema creation / migration code.
- A typed data-access layer (functions to create floors/workers/tasks, append
  events, query tasks by status, update status THROUGH the validated transition
  function only).
- A tiny seed script that inserts one floor, two workers, and two dependent tasks
  (the haiku example), so I can eyeball the tables.
- A .gitignore that excludes the .sqlite file and any env files.

Keep it readable. No web, no frontend. Show me the resulting table contents after
running the seed.
```

---

## Phase 3 — Orchestration engine (headless): command -> task graph -> dispatch

**Goal:** the real engine. Plug Phase 1's agent-running into Phase 2's data model. Still headless — prove the whole loop works with JSON output before any UI.

```
# Phase 3 — Orchestration engine (headless)

Building on Phase 1 (agent running) and Phase 2 (SQLite + state machine). Now
build the actual engine. Still headless — no frontend yet, but this should be a
long-running process, not a one-shot script.

## The loop
1. Accept a command (CLI arg or stdin for now).
2. ORCHESTRATOR / PLAN phase: an orchestrator agent decomposes the command into a
   task graph (a DAG) and writes tasks into SQLite. It only PLANS here — it does
   not run any worker yet. Tasks start as 'idle'.
3. SUPERVISE phase: a scheduler loop watches the board (SQLite):
   - A task becomes runnable when all its depends_on tasks are 'done'.
   - Runnable tasks go 'queued' -> 'running' as worker slots free up.
   - Respect a concurrency limit (configurable per floor, default 2).
   - When a task finishes, write its output, set 'done', and inject its output as
     input into dependent tasks. Tasks whose deps aren't met sit in 'blocked'.
   - On worker error/timeout: 'failed'. Implement a simple retry policy
     (failed -> retrying -> queued), max N retries, then stay 'failed' and surface it.
4. Every agent event gets appended to task_events as it streams.

## Architecture rules (enforce these)
- Workers NEVER communicate directly. They only read their injected input and
  write their own output, both via the board. The orchestrator routes everything.
- 1 task = 1 worker = writes only its own output. Do not let two running tasks
  target the same output. If the plan requires that, the planner must express it
  as a dependency (serialized), not as parallel tasks.
- Per-worker auth: honor each worker's auth_mode (max vs apiKey). For apiKey, read
  the key from settings and inject ANTHROPIC_API_KEY for that worker's invocation
  only. Never log it. (I may still have no key — keep max as the default path.)

## Resume / crash safety
- On startup, scan for tasks stuck in 'running'. For each: if its Agent SDK
  session_id can be resumed, resume it; otherwise reset to 'queued' to be re-run.
  Tasks must be safe to re-run (idempotent enough not to corrupt on retry).

## Output (still headless)
- Emit a single consolidated event stream to stdout (JSON lines): every status
  transition and agent event, tagged { taskId, floorId, workerId, type, payload, ts }.
- This stream is the contract the future WebSocket + UI will consume — design it
  cleanly now.

## Test
- Use a command that genuinely needs 3–4 tasks with at least one dependency, so I
  can watch the DAG resolve. Print the final assembled result.

Keep modules small: planner, scheduler, worker-runner, data-access. No frontend.
```

---

## Phase 4 — WebSocket event stream + minimal web server

**Goal:** expose the engine over the network so a browser can watch live. Thin layer — no fancy UI yet, just prove events reach the browser.

```
# Phase 4 — WebSocket layer + minimal server

Building on the Phase 3 engine. Wrap it in a small web server that streams the
engine's event stream to the browser over WebSocket. Keep the UI to the bare
minimum — this phase proves transport, not design.

## Stack
- TypeScript. A minimal HTTP server (Express/Fastify, your call) + a WebSocket
  server (ws). Same process can host the engine, or talk to it — your call, but
  keep it simple.

## Endpoints
- POST /command  -> accepts { command, floorId } and kicks off the engine's
  plan+supervise loop for that floor.
- GET /state     -> returns the current snapshot (floors, workers, tasks with
  status) from SQLite, so a fresh browser can render initial state before live
  events arrive.
- WebSocket /events -> pushes the consolidated event stream live:
  { taskId, floorId, workerId, type, status, payload, ts }
  The exact same event objects the engine already emits in Phase 3.

## Requirements
- On WS connect, first send the full current snapshot, THEN start streaming live
  deltas (so the client never misses state).
- Never send ANTHROPIC_API_KEY or any secret over the wire. Mask secrets in any
  /state or settings response.
- A settings endpoint to set/update the API key (stored in SQLite settings).
  Accept it write-only; never return the actual value, only whether it's set.

## Minimal test client
- A single static HTML page that connects to /events and dumps incoming events as
  text rows (no styling, no space theme yet). Just so I can SEE events arriving
  live in a browser as the engine runs. Include a text box + button hitting
  POST /command.

Keep it minimal. The pretty UI is Phase 5.
```

---

## Phase 5 — Frontend: side-view space UI

**Goal:** the real interface. Pure view layer over the Phase 4 event stream. This is where the locked space theme finally gets built.

```
# Phase 5 — Frontend (side-view space theme)

Building on Phase 4's WebSocket stream. Build the real UI as a pure view layer.
It consumes the event stream and renders state — it contains NO orchestration
logic of its own.

## Stack
- TypeScript + React (Vite). Plain Canvas or SVG for the scene — your call, but
  the scene is simple enough that heavy game engines are overkill.

## The scene (locked design — follow exactly)
- Side view. Each FLOOR (team) is one horizontal cluster.
- Each cluster: an orchestrator "sun" on the LEFT, worker "planets" arranged to
  the RIGHT of it.
- Multiple floors = multiple clusters stacked in one view (one page, no camera
  chasing).
- Workers are PLANETS ONLY. No ships, no satellites. Different planets may look
  different (color/pattern) but they are all the same entity type.
- NO orbiting motion. Planets stay put. Position is computed deterministically
  (e.g. worker n in floor f sits at a fixed x,y) — no physics, no pathfinding.
- Dashed "beams" run from the orchestrator (sun) to a worker (planet) ONLY when a
  task is active for that worker. NEVER planet-to-planet — that would contradict
  the architecture.

## State -> visual mapping (state shown by color + animation, NEVER by shape)
Map all 8 states to a distinct, unambiguous visual:
- idle           -> dim, still
- queued         -> faint pulse (waiting for a slot)
- running        -> bright + emitting signal-wave rings (expanding circles that fade)
- blocked        -> amber, slow pulse (waiting on a dependency)
- waiting-human  -> a clear "needs you" indicator (e.g. a blinking marker) that
                    visually differs from blocked
- failed         -> red, shaking
- retrying       -> red-ish, spinning/cycling
- done           -> calm green, settled
Make sure blocked vs waiting-human vs failed are each visually distinct — don't
let "amber wobble" mean three things.

## Assets
- Use SVG-drawn planets as placeholders for now (simple circles with color/pattern
  are fine). Structure the planet rendering so the sprite source can be swapped
  later (e.g. Deep-Fold planet PNGs) WITHOUT touching state logic. Leave a clear
  seam for that swap.

## Data flow
- On load: GET /state for the snapshot, render initial scene.
- Then connect WebSocket /events and update planets/beams as events arrive.
- A text box + button to POST /command. A settings panel to set the API key
  (write-only; show only "key is set / not set", never the value).

## Nice-to-haves (only if cheap)
- Click a planet to see that worker's task: model, status, latest output, event log.
- A per-floor token/cost readout if the event stream carries usage data.

Keep the view dumb and the event contract authoritative. If the engine and the UI
ever disagree, the engine wins.
```

---

## After Phase 5

The five phases give you a working vertical slice: command in → orchestrator plans → workers run on chosen models → state persists → browser shows it live as a space scene.

**Deferred on purpose** (do NOT let these creep into earlier phases):

- Per-worker API-key billing (wire exists from Phase 1; exercise it once you have a key)
- Human-in-the-loop gates as real blocking approvals (the state exists; make it interactive)
- Replay (free-ish: task_events already logs everything; add a scrubber that re-plays them)
- Asset polish (swap SVG placeholders for nicer planet sprites)
- WebGL procedural planet generation (explicitly dropped — revisit only if ever wanted)

**Reminder:** re-edit each phase's prompt with what you learned from the previous one before running it. The biggest single risk is assuming the Agent SDK event schema — pin it down in Phase 1 and feed the real shape forward.
