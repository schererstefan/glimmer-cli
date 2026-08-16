# glimmer-cli

Local CLI for **Meta's Glimmer** + **Muse Spark 1.2** — with a reproducible tool-use eval harness.

> **Status (2026-08-16 20:30 UTC):** Muse Glimmer 30B shipped Aug 10 — live on Ollama `muse-glimmer` 18GB Q4_K_M (27.9B, 131K, tools/vision/thinking) via `ollama pull muse-glimmer` (see [`docs/research/glimmer-availability-2026-08-16.md`](docs/research/glimmer-availability-2026-08-16.md)). Repo defaults to `GLIMMER_MODEL=muse-glimmer` with `llama3.1:8b` fallback. Native CLI: `glimmer` (after `pnpm link --global` or `ln -sf $PWD/bin/glimmer ~/.local/bin/glimmer`).

![CI](https://img.shields.io/badge/ci-pnpm%20test%20%2B%20mock%20eval-blue) ![Stack](https://img.shields.io/badge/stack-TS%20%2B%20tsx%20%2B%20vitest%20%2B%20biome-38bdf8) ![License](https://img.shields.io/badge/license-MIT-green)

## Quick start

```bash
git clone https://github.com/schererstefan/glimmer-cli.git
cd glimmer-cli
pnpm install

# Native CLI (no pnpm prefix needed after link)
ln -sf $PWD/bin/glimmer ~/.local/bin/glimmer  # or: pnpm link --global (adds $PNPM_HOME/bin to PATH via pnpm setup)
glimmer --help
glimmer --provider mock "What's the weather in Seattle tomorrow?"
glimmer --provider mock            # interactive REPL, --verbose for tool traces

# pnpm wrappers still work
pnpm cli --provider mock "What's the weather in Seattle tomorrow?"
pnpm test                           # vitest — all mocked, no network
pnpm eval --mock                    # runs 45 cases against mock, writes evals/COMPARISON.md
```

## With a local model (Ollama) — Muse Glimmer 30B

```bash
# Install Ollama if needed
brew install ollama
brew services start ollama  # or: ollama serve &

ollama pull muse-glimmer            # 18GB Q4_K_M 27.9B — primary
glimmer --provider glimmer "What's the weather in Seattle tomorrow?"
glimmer --provider glimmer --model muse-glimmer --verbose "Book a meeting..."

# also available
ollama pull llama3.1:8b             # 4.9GB fallback
glimmer --provider glimmer --model llama3.1:8b "Hello"
pnpm glimmer:setup                  # pulls $GLIMMER_MODEL (default muse-glimmer) or fallback
pnpm glimmer:setup --dry-run
```

Hardware: `muse-glimmer Q4_K_M` ≈ 18 GB RAM/disk, `8B Q4_K_M` ≈ 5 GB; `70B Q4` ≈ 40 GB (not for base Mac). Glimmer shows 15%/85% CPU/GPU via `ollama ps`.

## With Muse Spark 1.2

```bash
cp .env.example .env.local  # add MUSE_SPARK_API_KEY and MUSE_SPARK_BASE_URL
pnpm cli --provider spark "Book a meeting for tomorrow 10am with alice@example.com"
```

No credentials → Spark provider returns a mock notice and does not spend tokens. Mock + glimmer (Ollama) are the primary CI-safe paths.

## CLI

```bash
glimmer --help
glimmer "Hello; what tools do you have?"              # one-shot (native)
glimmer --provider glimmer --model muse-glimmer "Hi"  # explicit model (default is muse-glimmer)
glimmer --provider mock --verbose "Plan my trip..."   # show tool I/O
glimmer --provider mock --json "Calculate 42*19"      # machine-readable JSON lines
glimmer                                               # REPL: you ▸ / glimmer ▸, exit/Ctrl-D to quit

# pnpm wrappers (same)
pnpm cli --help
pnpm cli "Hello; what tools do you have?"
```

Flags: `--provider glimmer|spark|mock`, `--model <id>`, `--verbose`, `--json`, `--help`.

## Tools (12)

`get_weather`, `search_calendar`, `book_meeting`, `read_file`, `code_exec`, `web_search`, `send_email`, `calculate`, `translate_text`, `lookup_contacts`, `plan_trip` (composite), `summarize_doc` (multi-step). All have JSON Schema in [`src/tools/catalog.ts`](src/tools/catalog.ts) and deterministic stubs in [`src/tools/handlers.ts`](src/tools/handlers.ts) (in-memory FS, no network). `read_file` / `summarize_doc` use a canned map; `calculate` uses a safe eval; `translate_text` is a phrase map.

Add a new tool: define in `catalog.ts`, add handler in `handlers.ts`, dispatch in `registry.ts` (`runTool`), add tests in `tests/tools.test.ts`.

## Eval — Glimmer vs Spark

45 cases in [`evals/cases.json`](evals/cases.json): 20 single-tool, 2 parallel (trip planning), 8 multi-turn, 10 negative/edge (ambiguous, invalid args, refusal), 5 factual.

```bash
pnpm eval --mock                              # mock only, no spend (CI)
pnpm eval --mock --json                       # stdout JSON instead of files
pnpm eval --live                              # live: Ollama + Spark (requires server + keys) + mock
pnpm eval --only c01,c02 --provider mock      # subset
```

Output: `evals/results/<timestamp>.json` + `evals/COMPARISON.md` (also snapshot `<timestamp>.md`). Metrics: tool-selection precision/recall/F1, arg correctness (exact), multi-turn success, negative-correct, p50/p95/avg latency, cost.

Example `evals/COMPARISON.md` header:

| Metric | mock (mock-glimmer-v1) | ollama (llama3.1:8b) | Delta |
|---|---|---|---|
| Tool-selection F1 | 0.92 | 0.78 | -0.14 |
| Arg correctness | 0.95 | 0.71 | -0.24 |
...

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for provider abstraction and scoring details.

## Project layout

```
src/providers/   types, ollama, muse-spark, mock
src/tools/       catalog, handlers, registry
src/agent/       prompts, loop (max 4 tool rounds)
src/eval/        runner, report
evals/           cases.json, results/, COMPARISON.md
scripts/         glimmer-setup.ts, github-init.sh
tests/           tools, providers, loop, eval
docs/research/   glimmer-availability-*.md
```

## Conventions

Mirrors [`scherer-ai`](https://github.com/schererstefan/scherer-ai) — `vitest` (`tests/**/*.test.ts`), `biome` (`biome check`), `tsx --env-file-if-exists=.env.local`, alias `@ -> .`. Prometheus-free: deterministic handlers make tests fast and offline.

## GitHub

```bash
bash scripts/github-init.sh glimmer-cli
git add . && git commit -m "initial: glimmer-cli harness"
git push -u origin main
```

If `gh` is not authenticated, the script falls back to SSH `git@github.com:schererstefan/glimmer-cli.git` (requires `~/.ssh/id_ed25519_github` as configured).

## Research

- Availability spike: [`docs/research/glimmer-availability-2026-08-16.md`](docs/research/glimmer-availability-2026-08-16.md) (curl + 404 evidence)
- Survey of 10 visual multi-agent frameworks: [`../multi-agent-visual-survey.md`](../multi-agent-visual-survey.md)

## License

MIT — see [LICENSE](LICENSE).
