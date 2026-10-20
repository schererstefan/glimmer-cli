/**
 * Eval report generator — writes JSON + markdown COMPARISON.md
 * Layered scoring: exact arg match + selection precision/recall/F1 + latency/cost
 */

import fs from "node:fs";
import path from "node:path";

export type CaseResult = {
  id: string;
  category: string;
  prompt: string;
  expected: {
    tool?: string | null;
    tools?: string[];
    args?: Record<string, unknown>;
  };
  actual: { tools: string[]; args: Record<string, unknown>[]; text: string };
  latencyMs: number;
  costUsd?: number;
  toolSelectionCorrect: boolean;
  argsCorrect: boolean;
  mustIncludePass: boolean;
  verdict: "PASS" | "FAIL" | "PARTIAL";
  notes: string[];
};

export type ProviderReport = {
  provider: string;
  model: string;
  skipped?: boolean;
  skipReason?: string;
  cases: CaseResult[];
  metrics: {
    total: number;
    pass: number;
    partial: number;
    fail: number;
    precision: number;
    recall: number;
    f1: number;
    argAccuracy: number;
    multiTurnSuccess: number;
    negativeCorrect: number;
    p50: number;
    p95: number;
    avgLatency: number;
    totalCostUsd: number;
  };
};

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function computeMetrics(cases: CaseResult[]): ProviderReport["metrics"] {
  const total = cases.length;
  const pass = cases.filter((c) => c.verdict === "PASS").length;
  const partial = cases.filter((c) => c.verdict === "PARTIAL").length;
  const fail = cases.filter((c) => c.verdict === "FAIL").length;

  // Selection precision/recall: consider only cases where expected tool is non-null
  const selectable = cases.filter(
    (c) => c.expected.tool !== null || c.expected.tools,
  );
  // For simplicity, precision = correct selections / actual calls made, recall = correct / expected
  // We'll compute at case level: correct if toolSelectionCorrect
  const selCorrect = selectable.filter((c) => c.toolSelectionCorrect).length;
  const precision = selectable.length ? selCorrect / selectable.length : 1;
  const recall = selectable.length ? selCorrect / selectable.length : 1;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  const argCases = cases.filter(
    (c) => c.expected.args && Object.keys(c.expected.args).length > 0,
  );
  const argAccuracy = argCases.length
    ? argCases.filter((c) => c.argsCorrect).length / argCases.length
    : 1;

  const multi = cases.filter(
    (c) => c.category === "multi" || c.category === "parallel",
  );
  const multiTurnSuccess = multi.length
    ? multi.filter((c) => c.verdict === "PASS").length / multi.length
    : 1;

  const negatives = cases.filter((c) => c.category === "negative");
  const negativeCorrect = negatives.length
    ? negatives.filter((c) => c.toolSelectionCorrect).length / negatives.length
    : 1;

  const latencies = cases.map((c) => c.latencyMs);
  return {
    total,
    pass,
    partial,
    fail,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    f1: Number(f1.toFixed(3)),
    argAccuracy: Number(argAccuracy.toFixed(3)),
    multiTurnSuccess: Number(multiTurnSuccess.toFixed(3)),
    negativeCorrect: Number(negativeCorrect.toFixed(3)),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    avgLatency: Math.round(mean(latencies)),
    totalCostUsd: Number(
      cases.reduce((s, c) => s + (c.costUsd ?? 0), 0).toFixed(4),
    ),
  };
}

function isMockOnly(providers: ProviderReport[]): boolean {
  if (providers.length === 0) return false;
  const active = providers.filter((p) => !p.skipped);
  return active.length > 0 && active.every((p) => p.provider === "mock");
}

function reportMode(providers: ProviderReport[]): string {
  return isMockOnly(providers) ? "mock-only" : "mixed/live";
}

function providerLabel(p: ProviderReport): string {
  if (p.skipped) {
    const reason =
      p.skipReason ?? (p.provider === "spark" ? "no credentials" : undefined);
    return reason
      ? `${p.provider} (${reason} — skipped)`
      : `${p.provider} (skipped)`;
  }
  return `${p.provider} (${p.model})`;
}

function providerProvenance(p: ProviderReport): string {
  if (p.skipped) return `${providerLabel(p)} [${p.provider}:${p.model}]`;
  return `${p.provider}:${p.model}`;
}

export function makeReport(providers: ProviderReport[]): {
  json: unknown;
  markdown: string;
} {
  const timestamp = new Date().toISOString();
  const mode = reportMode(providers);
  const mockOnly = isMockOnly(providers);
  const json = { timestamp, mode, providers };

  let md = mockOnly
    ? `# Mock only — no model comparison\n\n`
    : `# Glimmer vs Muse Spark 1.2 — Eval Report\n\n`;
  md += `**Generated:** ${timestamp}\n\n`;
  md += `Mode: ${mode}\n\n`;
  md += `Providers: ${providers.map((p) => providerProvenance(p)).join(", ")}\n\n`;
  for (const p of providers) {
    if (p.skipped) {
      md += `Note: ${providerLabel(p)} — skipped (${p.skipReason ?? "no credentials"}), excluded from scoring.\n\n`;
    }
  }
  md += `| Metric | ${providers.map((p) => providerLabel(p)).join(" | ")} | Delta |\n`;
  md += `|---|${providers.map(() => "---").join("|")}|---|\n`;

  const rows: Array<[string, (m: ProviderReport["metrics"]) => string]> = [
    ["Total cases", (m) => String(m.total)],
    ["PASS", (m) => String(m.pass)],
    ["PARTIAL", (m) => String(m.partial)],
    ["FAIL", (m) => String(m.fail)],
    ["Tool-selection F1", (m) => m.f1.toFixed(3)],
    ["Precision", (m) => m.precision.toFixed(3)],
    ["Recall", (m) => m.recall.toFixed(3)],
    ["Arg correctness (exact)", (m) => m.argAccuracy.toFixed(3)],
    ["Multi-turn success", (m) => m.multiTurnSuccess.toFixed(3)],
    ["Negative correct", (m) => m.negativeCorrect.toFixed(3)],
    ["Avg latency", (m) => `${m.avgLatency}ms`],
    ["p50", (m) => `${m.p50}ms`],
    ["p95", (m) => `${m.p95}ms`],
    ["Cost total (USD)", (m) => `$${m.totalCostUsd.toFixed(4)}`],
  ];

  for (const [label, getter] of rows) {
    const vals = providers.map((p) => (p.skipped ? "—" : getter(p.metrics)));
    let delta = "";
    if (providers.length === 2 && !providers.some((p) => p.skipped)) {
      // Numeric delta where possible
      const a = providers[0].metrics as Record<string, number>;
      const b = providers[1].metrics as Record<string, number>;
      const key = label.toLowerCase().includes("f1")
        ? "f1"
        : label.toLowerCase().includes("precision") &&
            !label.toLowerCase().includes("arg")
          ? "precision"
          : label.toLowerCase().includes("recall")
            ? "recall"
            : label.toLowerCase().includes("arg")
              ? "argAccuracy"
              : undefined;
      if (key && typeof a[key] === "number" && typeof b[key] === "number") {
        const d = (b[key] as number) - (a[key] as number);
        delta = `${d >= 0 ? "+" : ""}${d.toFixed(3)}`;
      }
    }
    md += `| ${label} | ${vals.join(" | ")} | ${delta} |\n`;
  }

  md += `\n## Per-provider breakdown\n\n`;
  for (const p of providers) {
    md += `### ${providerLabel(p)}\n\n`;
    if (p.skipped) {
      md += `Skipped: ${p.skipReason ?? "no credentials"} — excluded from scoring.\n\n`;
      continue;
    }
    md += `| ID | Category | Expected | Actual | Verdict | Latency |\n`;
    md += `|---|---|---|---|---|---|\n`;
    for (const c of p.cases) {
      const exp = c.expected.tools
        ? c.expected.tools.join(",")
        : (c.expected.tool ?? "none");
      const act = c.actual.tools.length ? c.actual.tools.join(",") : "none";
      md += `| ${c.id} | ${c.category} | ${exp} | ${act} | ${c.verdict} | ${c.latencyMs}ms |\n`;
    }
    md += `\n`;
    const fails = p.cases.filter((c) => c.verdict === "FAIL");
    if (fails.length > 0) {
      md += `**Top failures:**\n\n`;
      for (const f of fails.slice(0, 3)) {
        md += `- **${f.id}** (${f.category}): expected \`${JSON.stringify(f.expected)}\` got \`${JSON.stringify(f.actual)}\` — ${f.notes.join("; ")}\n`;
      }
      md += `\n`;
    }
  }

  md += `\n---\n\n*Notes:*\n- Glimmer local is via Ollama (\`OLLAMA_HOST\`, \`GLIMMER_MODEL\`). When weights are gated, harness falls back to \`FALLBACK_MODEL\` (default \`llama3.1:8b\`) and records it as \`${providers[0]?.model ?? "mock"}\`.\n- Spark is via \`MUSE_SPARK_BASE_URL\` + \`MUSE_SPARK_API_KEY\`; mock provider is used for CI (no spend).\n- Arg correctness is exact match on required keys (case-insensitive for strings where applicable).\n`;

  return { json, markdown: md };
}

export function writeResults(
  reports: ProviderReport[],
  outDir = path.join(process.cwd(), "evals", "results"),
): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const { json, markdown } = makeReport(reports);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `${ts}.json`);
  const mdFilename = isMockOnly(reports)
    ? "COMPARISON-MOCK.md"
    : "COMPARISON.md";
  const mdPath = path.join(outDir, "..", mdFilename);
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  fs.writeFileSync(mdPath, markdown);
  // And a snapshot copy alongside JSON
  fs.writeFileSync(path.join(outDir, `${ts}.md`), markdown);
  return { jsonPath, mdPath };
}
