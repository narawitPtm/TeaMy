# AI Workspace — build progress & notes

This folder holds the AI's working markdown for the Multi-Agent Orchestrator
build: the original phase prompts, the de-risking findings, and this log.

- [BUILD_PROMPTS.md](BUILD_PROMPTS.md) — the 5 sequential phase prompts (Phase 2's
  event-shape slot is filled with the real schema captured in Phase 1).
- [PHASE1_FINDINGS.md](PHASE1_FINDINGS.md) — the verified Claude Agent SDK event
  schema and auth/model facts everything else was built on.
- [screenshots/](screenshots/) — UI verification captures.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 — PoC | Max auth, model-per-worker, dependency wiring, event capture | ✅ done & verified |
| 2 — Data model | SQLite schema + 8-state machine + DAO + seed | ✅ done & verified |
| 3 — Engine | command → plan(DAG) → supervise → assemble (headless) | ✅ done & verified |
| 4 — WS server | Express + ws, snapshot-then-deltas, write-only API key | ✅ done & verified |
| 5 — Frontend | React/Vite side-view space scene (radial: sun + planets) | ✅ done & verified |
| 6 — Human-in-the-loop | `waiting-human` as a real blocking approval (engine pause + approve/reject) | ✅ done & verified |
| 7 — Asset polish | swap placeholder circles for generated planet sprites via the seam | ✅ done & verified |
| 8 — Replay | scrubber that re-plays a run from task_events | ✅ done & verified |
| 9 — Multi-team + Observatory UI | concurrent teams + full-screen pan/zoom star map | ✅ done & verified |
| 10 — Team config + manual roster | per-team name/instruction/model/cwd/permission; auto vs manual worker roster | ✅ done & verified |

Full vertical slice works: command in → orchestrator plans → workers run on
chosen models → state persists in SQLite → browser shows it live.

## Phase 6 notes (human-in-the-loop gates)

- The planner flags the final/irreversible task `requires_approval`. At dispatch
  the scheduler transitions it `running -> waiting-human` and BLOCKS (polling the
  board) until a human decides.
- `POST /approve { taskId, approved }` records the decision; approve →
  `waiting-human -> running` (runs the SDK), reject → `waiting-human -> failed`
  (no API call wasted, output `(blocked by human: rejected)`).
- UI: a top approval banner + inspector buttons; the gated planet itself shows
  the `waiting-human` visual (purple + blinking "!" + "needs you").
- Data-model improvement made for this: tasks now persist `worker_id` (set at
  dispatch), so the snapshot conveys worker↔task binding to clients that connect
  mid-run. Added `requires_approval` + `approval` columns too (idempotent migration).
- Bug fixed: the Vite dev proxy was missing `/approve`, so the browser's POST
  never reached the backend — added it.

## Phase 9 notes (multi-team + Observatory UI)

Addresses the audit's #1 gap (multi-team unusable) and the "make it a stargazing
site" ask:
- **Backend:** per-floor busy guard (different teams run concurrently, same team
  serializes) + `POST /floors` to create a team. Verified: two teams accepted
  commands simultaneously.
- **Frontend — full rewrite of the view layer:** full-screen pannable/zoomable
  star map (`useViewport` — drag to pan, wheel/buttons to zoom toward cursor,
  click-vs-pan threshold so planet selection still works). Each team is a star
  system scattered on a golden-angle spiral; pan/zoom to explore. Parallax
  `Starfield` (3 depth layers + nebula). Glass HUD (Syne + Space Mono fonts):
  brand, settings, approval toasts, legend, command console with team selector +
  "＋ Team", inspector card, replay bar. Sun glow, refined planet glow/beams.
- Files: `useViewport.ts`, `Starfield.tsx`, `Cluster.tsx`, `Universe.tsx`,
  rewritten `App.tsx` + `styles.css`; `Replay.tsx` now renders a `Cluster`;
  removed `Scene.tsx`.

## Design decisions of note

- **Radial layout** (per the user's sketch): orchestrator sun in the CENTER,
  worker planets arranged at fixed angles around it. Dashed beams point OUTWARD
  from the sun to a planet, arrowhead at the planet end, ONLY while running.
  Workers are planets only — no ships/satellites.
- **Clean-room workers:** every worker invocation passes `settingSources: []`
  so it doesn't load the host project's CLAUDE.md/hooks (~21k cached tokens and
  ~$0.13/call otherwise).
- **Auth:** `max` is the default everywhere (no `ANTHROPIC_API_KEY`). The
  `apiKey` path is wired but stubbed with a TODO until a key is available; the
  key is never logged and never sent to the frontend.

## Bugs caught during the build

1. Phase 5: `shake` animation's CSS `transform` clobbered each planet's SVG
   `translate(x,y)`; moved animations to an inner `<g>`.
2. Phase 5: the UI dropped live `running`/beam states for tasks created by a
   fresh run (they weren't in the initial snapshot). Fixed the data hook to stub
   unknown tasks on first event and refresh worker details when a new worker
   appears.

## Deferred (the "next phase" backlog)

- [ ] Per-worker API-key billing — exercise the `apiKey` path once a key exists.
- [x] Human-in-the-loop gates — DONE in Phase 6 (engine pause + approve/reject).
- [x] Replay — DONE in Phase 8. `GET /history` returns the floor's task_events
      chronologically; `web/src/Replay.tsx` reconstructs the scene at any playhead
      (slider + play/restart), reusing `<Scene>`. Worker↔planet binding from the
      persisted `worker_id`; beams/state replay exactly.
- [x] Asset polish — DONE in Phase 7. 8 generated planet sprites
      (`web/scripts/gen-planets.mjs` → `web/public/assets/planets/planet-*.svg`),
      loaded through the `PlanetSprite` seam by a stable per-worker hash. State
      animation (rings/shake/blink/glow) is untouched — composes over the sprite.
      To use Deep-Fold PNGs instead, point the seam's `href` at the PNGs; nothing
      else changes. Gallery at `/gallery.html`.
