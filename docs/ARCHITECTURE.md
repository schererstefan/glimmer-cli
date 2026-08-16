# Architecture

## Overview

```
glimmer-cli/
  src/
    providers/
      types.ts       ModelProvider interface (chat → AsyncIterable<Delta>)
      ollama.ts      Ollama HTTP (local Glimmer / Llama)
      muse-spark.ts  Muse Spark 1.2 OpenAI-compat fetch
      mock.ts        Deterministic rule-based mock (CI, tests)
    tools/
      catalog.ts     12 ToolDefinition with JSON Schema
      handlers.ts    Stub implementations (in-memory, no network)
      registry.ts    runTool dispatcher + validateToolInput
    agent/
      prompts.ts     buildSystemPrompt()
      loop.ts        runLoop — up to 4 tool rounds, streaming callbacks
    eval/
      runner.ts      Runs evals/cases.json against providers
      report.ts      Computes precision/recall/F1, latency percentiles, writes COMPARISON.md
  evals/
    cases.json       45 tool-use + factual cases
    results/.gitkeep
  scripts/
    glimmer-setup.ts Checks ollama, pulls $GLIMMER_MODEL or FALLBACK_MODEL, smoke test
    github-init.sh   Tries gh repo create, falls back to SSH remote
  tests/
```

## ModelProvider

```ts
interface ModelProvider {
  id: string; model: string;
  chat(options: { messages, tools?, temperature?, model? }): AsyncIterable<Delta>
  complete(options): Promise<{ text, toolCalls }>
}
type Delta = {type:"text", text} | {type:"tool_use", toolCall} | {type:"done", reason}
```

- **OllamaProvider**: `POST /api/chat` streaming JSON lines, tool_calls parsed; falls back to `/v1/chat/completions` if 404.
- **MuseSparkProvider**: `POST {baseUrl}/chat/completions` OpenAI streaming SSE (`data: ...`), aggregates `tool_calls` by index.
- **MockProvider**: rule-based `decideToolCalls()` — maps prompts like "weather in X" → `get_weather`, "plan trip" → parallel `get_weather`+`search_calendar`. Used for unit tests and `pnpm eval --mock`.

## Agent loop

`runLoop({provider, messages, onDelta, onToolUse, onToolResult})`

1. Prepend system prompt.
2. Call `provider.chat({messages, tools: catalog, temperature:0})`.
3. Collect deltas: stream text via `onDelta`, collect `tool_use`.
4. If no tools → done, return `text`.
5. Else execute `runTool` in parallel, push `tool` messages, loop (max 4).

Mirrors `scherer-ai/lib/agent-core.ts` but provider-agnostic.

## Tools

12 tools (see `catalog.ts`): `get_weather`, `search_calendar`, `book_meeting`, `read_file`, `code_exec`, `web_search`, `send_email`, `calculate`, `translate_text`, `lookup_contacts`, `plan_trip`, `summarize_doc`.

Handlers are pure: `FILES` map, `CONTACTS` array, `safeEval` for `calculate`, `TRANSLATIONS` map. Unknown tool → `{error: "Unknown tool: X"}` (same shape as `scherer-ai/tests/agent-tools.test.ts`).

## Eval

- **Cases** (`evals/cases.json`): 20 single, 2 parallel, 8 multi, 10 negative/edge, 5 factual.
- **Runner**: for each provider × case → `runLoop` with `temperature:0`, record `tools`, `args`, `latencyMs`, check `toolSelectionCorrect` (exact or superset for parallel), `argsCorrect` (subset match), `must_include`/`must_not_include`.
- **Metrics**: precision/recall/F1 (case-level), argAccuracy, multiTurnSuccess, negativeCorrect, p50/p95/avg latency, totalCost.
- **Output**: `evals/results/<ts>.json` + `evals/COMPARISON.md` + snapshot `<ts>.md` via `report.ts`.

## CLI

`src/cli.ts` — manual arg parse (no commander), `--provider glimmer|spark|mock`, `--model`, `--verbose`, `--json`, `--help`. One-shot (`pnpm cli "prompt"`) or REPL (`pnpm cli`). Streaming via `onDelta`, tool traces via `onToolUse` (yellow), results via `onToolResult` (dim).

## Env

See `.env.example`: `OLLAMA_HOST`, `GLIMMER_MODEL`, `FALLBACK_MODEL`, `MUSE_SPARK_*`, `ANTHROPIC_API_KEY` (optional judge).

## CI

`.github/workflows/ci.yml`: pnpm setup → install → `biome check` → `tsc --noEmit` → `vitest run` → `pnpm eval --mock --json`.
