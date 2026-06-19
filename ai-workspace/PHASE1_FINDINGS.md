# Phase 1 — Findings (feed these forward into Phases 2–5)

Run date: 2026-06-18. SDK: `@anthropic-ai/claude-agent-sdk@0.3.181`. Node v22.

## Verdict — all four risks retired

| # | Question | Answer |
|---|----------|--------|
| 1 | Runs against Max with NO API key? | **Yes.** `apiKeySource: "none"`, `ANTHROPIC_API_KEY` absent. |
| 2 | Two workers on different models in one run? | **Yes.** A reported `claude-sonnet-4-6`, B reported `claude-haiku-4-5-20251001`. |
| 3 | A's output injected as B's input? | **Yes.** Haiku from A was passed verbatim into B's prompt; B counted it. |
| 4 | Structured per-agent event stream captured? | **Yes.** JSON lines `{ taskId, workerId, type, payload, ts }`. |

## SDK API surface (verified, not assumed)

- Entry point: `query({ prompt, options })` → **async iterator** of message objects.
- Model selection: `options.model` (string). Accepts aliases (`claude-haiku-4-5`) and pinned IDs (`claude-haiku-4-5-20251001`). The API reports back the **pinned** id on the assistant message.
- Auth: if `ANTHROPIC_API_KEY` is unset in the invocation env, the SDK uses `claude login` (Max) credentials. Precedence puts `ANTHROPIC_API_KEY` ABOVE the subscription, so for Max we must `delete env.ANTHROPIC_API_KEY`.
- Per-invocation env scoping: `options.env` (a full env object). We clone `process.env`, delete the key for Max, and would set it here for the `apiKey` path.
- Clean room: `options.settingSources: []` stops the worker from loading the project's CLAUDE.md / hooks / settings. **Important** — without it, every worker re-runs SessionStart hooks (claude-mem etc.) and burns ~21–29k cached tokens of context per call.
- Timeout/abort: `options.abortController` (an `AbortController`). We wire a 120s `setTimeout` → `controller.abort()`.
- Final text: on the `result` message, field `result` (string).
- Session id: `session_id` on **every** message (store from the first; needed for Phase 3 resume).
- Cost/usage: `result.total_cost_usd`, `result.usage`, `result.modelUsage` (per-model breakdown — useful for the Phase 5 per-floor cost readout).

## REAL event-stream shape (paste target for Phase 2 `task_events.payload` and Phase 4 WS contract)

The stream is **noisy**. The PoC normalizer keeps only meaningful events and drops the rest.

### Top-level message types observed

```
system     (subtypes: hook_started, hook_progress, hook_response, init,
            thinking_tokens, post_turn_summary)   -- mostly noise
assistant  (message.content[] = thinking | text | tool_use blocks)
rate_limit_event
result     (subtype: success | error_*)
```

### `system` / `init` — the "start" event

```json
{
  "type": "system", "subtype": "init",
  "cwd": "...", "session_id": "d12dfad7-...",
  "tools": ["Task","Bash","Edit", ...],
  "mcp_servers": [{"name":"...","status":"pending"}],
  "model": "claude-sonnet-4-6",
  "permissionMode": "default",
  "apiKeySource": "none",
  "claude_code_version": "2.1.181",
  "uuid": "...", "memory_paths": {...}, "fast_mode_state": "off"
}
```

### `assistant` — thinking / text / tool_use

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-haiku-4-5-20251001",
    "id": "msg_...", "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "...", "signature": "..." },
      { "type": "text", "text": "..." }
      // tool calls would appear as { "type": "tool_use", "id", "name", "input" }
    ],
    "stop_reason": null,
    "usage": { "input_tokens", "output_tokens", "cache_read_input_tokens", ... }
  },
  "parent_tool_use_id": null,
  "session_id": "...", "uuid": "...", "request_id": "req_..."
}
```

### `result` — the "finish" event (final text + cost + usage)

```json
{
  "type": "result", "subtype": "success", "is_error": false,
  "api_error_status": null,
  "duration_ms": 10844, "duration_api_ms": 10525, "num_turns": 1,
  "result": "Line 1: 5 syllables\n...",
  "stop_reason": "end_turn",
  "session_id": "...",
  "total_cost_usd": 0.0107,
  "usage": { "input_tokens", "output_tokens", "cache_*", "iterations": [...] },
  "modelUsage": {
    "claude-haiku-4-5-20251001": { "inputTokens", "outputTokens", "costUSD", ... }
  },
  "permission_denials": [],
  "terminal_reason": "completed",
  "uuid": "..."
}
```

### `rate_limit_event`

```json
{
  "type": "rate_limit_event",
  "rate_limit_info": { "status": "allowed", "resetsAt": 1781795400,
                       "rateLimitType": "five_hour", "isUsingOverage": false },
  "uuid": "...", "session_id": "..."
}
```

## Normalizer mapping used in the PoC (`src/poc.ts`)

| Raw | Emitted `type` |
|-----|----------------|
| `system`/`init` | `start` |
| `assistant` w/ `tool_use` block | `tool_use` |
| `assistant` w/ `text` block | `assistant_text` |
| `assistant` w/ `thinking` block | `thinking` |
| `result` (`is_error:false`) | `finish` |
| `result` (`is_error:true`) | `error` |
| everything else (`hook_*`, `thinking_tokens`, `rate_limit_event`, ...) | dropped |

## Gotchas to carry forward

1. **Cost of context-loading.** With `settingSources` unset, A cost ~$0.136 just to write a haiku (21k tokens of cached CLAUDE.md/hook context). Always pass `settingSources: []` to workers unless they genuinely need project context.
2. **`modelUsage` shows two models even for one worker** — the harness uses Haiku internally (e.g. for summaries) alongside the requested model. Trust the `assistant.message.model` field for "what the worker ran on".
3. **`session_id` differs per `query()` call** — one session per task, exactly what we want for Phase 3's per-task resume.
4. **Windows note:** a SessionStart hook warned the bundled claude-mem binary is macOS-only; harmless, JS fallback handles it. Irrelevant once `settingSources: []` is set.
