# Glimmer vs Muse Spark 1.2 — Eval Report

**Generated:** 2026-08-16T20:28:04.669Z

| Metric | glimmer (muse-glimmer) | Delta |
|---|---|---|
| Total cases | 2 |  |
| PASS | 2 |  |
| PARTIAL | 0 |  |
| FAIL | 0 |  |
| Tool-selection F1 | 1.000 |  |
| Precision | 1.000 |  |
| Recall | 1.000 |  |
| Arg correctness (exact) | 1.000 |  |
| Multi-turn success | 1.000 |  |
| Negative correct | 1.000 |  |
| Avg latency | 49198ms |  |
| p50 | 25778ms |  |
| p95 | 72618ms |  |
| Cost total (USD) | $0.0000 |  |

## Per-provider breakdown

### glimmer (muse-glimmer)

| ID | Category | Expected | Actual | Verdict | Latency |
|---|---|---|---|---|---|
| c01 | single | get_weather | get_weather | PASS | 72618ms |
| c09 | single | calculate | calculate | PASS | 25778ms |


---

*Notes:*
- Glimmer local is via Ollama (`OLLAMA_HOST`, `GLIMMER_MODEL`). When weights are gated, harness falls back to `FALLBACK_MODEL` (default `llama3.1:8b`) and records it as `muse-glimmer`.
- Spark is via `MUSE_SPARK_BASE_URL` + `MUSE_SPARK_API_KEY`; mock provider is used for CI (no spend).
- Arg correctness is exact match on required keys (case-insensitive for strings where applicable).
