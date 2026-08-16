# Glimmer Availability — 2026-08-16 (updated 2026-08-16 20:30 UTC)

**Checked:** `2026-08-16 20:30 UTC` — Muse Glimmer 30B shipped Aug 10, 2026
**Host:** macOS arm64, Node 26, pnpm 11.22.0, Ollama 0.32.13
**Models:** `muse-glimmer:latest` 18GB Q4_K_M (27.9B params, 131K ctx, tools+vision+thinking) + `llama3.1:8b` 4.9GB

## Checks performed

```bash
$ curl -s https://ollama.com/library/muse-glimmer | head
<title>muse-glimmer</title> Meta's latest open model built for always-on local agents. 30B parameters, Apache 2.0
$ curl -s https://ollama.com/library/muse-glimmer/tags | grep href
muse-glimmer:latest (18GB), muse-glimmer:30b (18GB), muse-glimmer:30b-mlx etc

$ ollama pull muse-glimmer
pulling manifest
pulling f48b452316f9: 100% 1.4 GB
pulling 71b5c9c9abbc: 100% 16 GB
verifying sha256 digest
writing manifest
success

$ ollama list
muse-glimmer:latest    de878ce33ad8    18 GB
llama3.1:8b            46e0c10c039e    4.9 GB

$ ollama show muse-glimmer
architecture        muse-glimmer
parameters          27.9B
quantization        Q4_K_M
context length      131072
capabilities        completion vision tools thinking
```

Web sources (2026-08-16): Meta releases 30B Muse Glimmer on Hugging Face `meta-models/Muse-Glimmer-30B` (Apache 2.0), Ollama/LM Studio/llama.cpp integrations (TheHinduBusinessLine, Engadget, research.meta.ai blog).

## Verdict: FOUND — update

- **Ollama library:** `https://ollama.com/library/muse-glimmer` live — `muse-glimmer` 18GB is the published tag (not `glimmer:8b-instruct-q4_K_M`).
- **Local:** pulled `muse-glimmer:latest` 18GB Q4_K_M, verified via `ollama show`.
- Previous 2026-08-16 19:27 check used wrong name `glimmer` (404) and pre-dated Aug 10 launch propagation.

## Consequence for this repo

- Default `GLIMMER_MODEL=muse-glimmer` now (updated in `.env.example` and `scripts/glimmer-setup.ts`).
- `FALLBACK_MODEL=llama3.1:8b` remains for CI / low-RAM.
- CLI: `pnpm cli --provider glimmer --model muse-glimmer "hello"` verified:
  `{"type":"tool_use","name":"get_weather"...} latencyMs 58640` and `calculate` 24711ms.

## How to re-check

```bash
brew install ollama; brew services start ollama
ollama pull muse-glimmer
pnpm glimmer:setup
pnpm cli --provider glimmer --model muse-glimmer --json "What's the weather in Seattle tomorrow?"
pnpm eval --provider=glimmer --only=c01,c09
```
