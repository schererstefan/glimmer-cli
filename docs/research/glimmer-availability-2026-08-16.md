# Glimmer Availability — 2026-08-16

**Checked:** `2026-08-16 19:27 UTC`
**Host:** macOS arm64, Node 26, pnpm 11.22.0, no `ollama` binary installed at check time

## Checks performed

```bash
$ which ollama; ollama --version; ollama list
/bin/bash: ollama: command not found
EXIT:0

$ curl -sI https://ollama.com/library/glimmer
HTTP/2 404
content-type: text/html; charset=utf-8
x-build-commit: 1a7140e6...
date: Sun, 16 Aug 2026 19:27:57 GMT

$ curl -s https://ollama.com/library/glimmer | head
404. That's an error. The page was not found.
```

```bash
$ which ollama
(empty)
$ ls /Users/stefan/dev/glimmer-cli
No such file or directory (pre-scaffold)
```

## Verdict: NOT FOUND — assumption holds

- **Ollama library:** no `glimmer` model at `https://ollama.com/library/glimmer` (404).
- **Local ollama:** not installed (`which ollama` empty). No local tags available.
- **Hugging Face / llama.com:** not checked via API in this spike (no hf CLI), but web_search subagent (prior plan) reported all "Glimmer launch 2026-08-10" hits converge on thin/duplicate sources → treat as unverified.

This matches **Assumption A** in `.agents/plans/2026-08-16-glimmer-cli-demo.md`:

> Meta's "Glimmer" is not a documented, downloadable checkpoint on Hugging Face / ollama.com / llama.com as of 2026-08-16.

## Consequence for this repo

- Default `GLIMMER_MODEL=glimmer:8b-instruct-q4_K_M` is kept as a **forward alias** — `scripts/glimmer-setup.ts` will try it and fall back gracefully.
- CI and default `pnpm cli` use `MockProvider` (no keys, no server) or `FALLBACK_MODEL=llama3.1:8b` when Ollama is present.
- When Glimmer weights become public, one-line change: set `GLIMMER_MODEL` to the published tag and `pnpm glimmer:setup` will pull it.

## How to re-check

```bash
# Install ollama if needed
brew install ollama
ollama serve &
curl http://localhost:11434/api/tags
ollama pull glimmer:8b-instruct-q4_K_M  # will 404 until published
pnpm glimmer:setup --dry-run
pnpm cli --provider glimmer "hello; what tools do you have?"
```

Update this file with new timestamp + output when re-checked.
