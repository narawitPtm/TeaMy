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

Full vertical slice works: command in → orchestrator plans → workers run on
chosen models → state persists in SQLite → browser shows it live.

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
- [ ] Human-in-the-loop gates — make the `waiting-human` state a real blocking
      approval (engine pause + UI approve button + resume).
- [ ] Replay — task_events already logs everything; add a scrubber that
      re-plays a run.
- [ ] Asset polish — swap SVG placeholder planets for sprite PNGs via the seam
      in `web/src/Planet.tsx` (`PlanetSprite`).
