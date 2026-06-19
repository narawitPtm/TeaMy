/**
 * Phase 1 probe — a single tiny invocation to inspect the REAL event-stream
 * shape of the Claude Agent SDK before building anything on top of it.
 *
 * Runs against Max (no ANTHROPIC_API_KEY in env). Dumps each streamed message's
 * top-level keys plus a truncated JSON of the whole thing.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

function truncate(s: string, n = 600): string {
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n} chars)` : s;
}

async function main() {
  console.log("=== PROBE START ===");
  console.log("ANTHROPIC_API_KEY present in env:", Boolean(process.env.ANTHROPIC_API_KEY));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  let i = 0;
  try {
    for await (const message of query({
      prompt: "Reply with exactly the single word: PONG",
      options: {
        model: "claude-haiku-4-5",
        systemPrompt: "You are a terse probe. Answer with one word only.",
        abortController: controller,
        maxTurns: 1,
      },
    })) {
      i++;
      const m = message as Record<string, unknown>;
      console.log(`\n--- message #${i} ---`);
      console.log("type:", m.type, "| subtype:", m.subtype ?? "(none)");
      console.log("top-level keys:", Object.keys(m).join(", "));
      console.log("raw:", truncate(JSON.stringify(m)));
    }
  } finally {
    clearTimeout(timeout);
  }
  console.log("\n=== PROBE END — saw", i, "messages ===");
}

main().catch((err) => {
  console.error("PROBE ERROR:", err);
  process.exit(1);
});
