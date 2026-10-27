#!/usr/bin/env tsx
/**
 * Eval runner — runs evals/cases.json against each provider and writes results.
 *
 * Usage:
 *   pnpm eval              # mock by default (no keys, no server)
 *   pnpm eval --mock       # same
 *   pnpm eval --live       # requires Ollama + Spark credentials, runs both providers
 *   pnpm eval --only=c01,c02 --provider=mock
 *   pnpm eval --json       # emit JSON to stdout instead of writing files
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "@/src/agent/loop";
import { MockProvider } from "@/src/providers/mock";
import { MuseSparkProvider } from "@/src/providers/muse-spark";
import { OllamaProvider } from "@/src/providers/ollama";
import type { ModelProvider } from "@/src/providers/types";
import {
  type CaseResult,
  computeMetrics,
  makeReport,
  type ProviderReport,
  writeResults,
} from "./report";

type Case = {
  id: string;
  category: string;
  prompt: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  expected: {
    tool?: string | null;
    tools?: string[];
    args?: Record<string, unknown>;
    answer_contains?: string;
  };
  must_include?: string[];
  must_not_include?: string[];
};

function color(s: string, code: number): string {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
const dim = (s: string) => color(s, 2);
const bold = (s: string) => color(s, 1);
const green = (s: string) => color(s, 32);
const yellow = (s: string) => color(s, 33);
const red = (s: string) => color(s, 31);
const cyan = (s: string) => color(s, 36);

export function parseArgs(argv: string[] = process.argv.slice(2)): {
  mock: boolean;
  live: boolean;
  json: boolean;
  onlyIds: string[] | null;
  providerFilter: string | null;
} {
  let mockFlag = false;
  let live = false;
  let json = false;
  let onlyIds: string[] | null = null;
  let providerFilter: string | null = null;
  for (const arg of argv) {
    if (arg === "--mock") mockFlag = true;
    else if (arg === "--live") live = true;
    else if (arg === "--json") json = true;
    else if (arg.startsWith("--only="))
      onlyIds = arg.slice("--only=".length).split(",");
    else if (arg.startsWith("--provider=")) {
      const v = arg.slice("--provider=".length);
      if (v !== "mock" && v !== "glimmer" && v !== "spark")
        throw new Error(`Unknown provider: ${v} (use glimmer|spark|mock)`);
      providerFilter = v;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    mock: mockFlag || !live,
    live,
    json,
    onlyIds,
    providerFilter,
  };
}

function lower(s: string): string {
  return s.toLowerCase();
}

function argsMatch(
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown>[],
): boolean {
  if (!expected || Object.keys(expected).length === 0) return true;
  if (actual.length === 0) return false;
  // Check if any actual tool input contains all expected keys/values (case-insensitive for strings)
  return actual.some((a) => {
    for (const [k, v] of Object.entries(expected)) {
      const av = a[k];
      if (av === undefined) return false;
      if (typeof v === "string" && typeof av === "string") {
        if (!lower(av).includes(lower(v)) && lower(av) !== lower(v))
          return false;
      } else if (av !== v) return false;
    }
    return true;
  });
}

function mustIncludePass(
  c: Case,
  text: string,
  tools: string[],
  args: Record<string, unknown>[],
): boolean {
  const hay = lower(`${text} ${tools.join(" ")} ${JSON.stringify(args)}`);
  if (c.must_include) {
    for (const s of c.must_include) {
      if (!hay.includes(lower(s))) return false;
    }
  }
  if (c.must_not_include) {
    for (const s of c.must_not_include)
      if (hay.includes(lower(s))) return false;
  }
  return true;
}

async function runProvider(
  provider: ModelProvider,
  cases: Case[],
): Promise<ProviderReport> {
  const results: CaseResult[] = [];

  for (const c of cases) {
    const t0 = Date.now();
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (c.history)
      for (const h of c.history)
        messages.push({
          role: h.role as "user" | "assistant",
          content: h.content,
        });
    messages.push({ role: "user", content: c.prompt });

    let finalText = "";
    let tools: string[] = [];
    let args: Record<string, unknown>[] = [];
    let error: string | null = null;
    try {
      const res = await runLoop({
        provider,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        temperature: 0,
      });
      finalText = res.text;
      tools = res.toolCalls.map((tc) => tc.name);
      args = res.toolCalls.map((tc) => tc.input);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      finalText = `[error: ${error}]`;
    }
    const latencyMs = Date.now() - t0;

    // Selection correctness
    let toolSelectionCorrect = false;
    const expectedTools =
      c.expected.tools ?? (c.expected.tool ? [c.expected.tool] : []);
    const expectedNull = c.expected.tool === null && !c.expected.tools;
    if (expectedNull) {
      toolSelectionCorrect = tools.length === 0;
    } else if (expectedTools.length > 0) {
      // For parallel case: all expected tools should be in actual
      if (expectedTools.length > 1) {
        toolSelectionCorrect = expectedTools.every((t) => tools.includes(t));
      } else {
        const first = expectedTools[0];
        toolSelectionCorrect = first !== undefined && tools.includes(first);
      }
    } else {
      // No expectation — consider pass if we got something plausible? For factual with no tool expected, we check no tool
      // But some factual cases intentionally expect no tool
      toolSelectionCorrect = true;
    }

    const argsCorrect = argsMatch(c.expected.args, args);
    const mustPass = mustIncludePass(c, finalText, tools, args);

    let verdict: "PASS" | "FAIL" | "PARTIAL" = "PASS";
    const notes: string[] = [];
    if (!toolSelectionCorrect) {
      verdict = "FAIL";
      notes.push(
        `tool selection: expected ${JSON.stringify(expectedTools.length ? expectedTools : "none")} got ${JSON.stringify(tools)}`,
      );
    }
    if (!argsCorrect) {
      verdict = verdict === "FAIL" ? "FAIL" : "PARTIAL";
      notes.push(
        `args mismatch: expected ${JSON.stringify(c.expected.args)} got ${JSON.stringify(args)}`,
      );
    }
    if (!mustPass) {
      verdict = "FAIL";
      notes.push(`must_include check failed`);
    }
    if (error) notes.push(`error: ${error}`);

    results.push({
      id: c.id,
      category: c.category,
      prompt: c.prompt,
      expected: {
        tool: c.expected.tool,
        tools: c.expected.tools,
        args: c.expected.args,
      },
      actual: { tools, args, text: finalText.slice(0, 500) },
      latencyMs,
      toolSelectionCorrect,
      argsCorrect,
      mustIncludePass: mustPass,
      verdict,
      notes,
    });
  }

  const metrics = computeMetrics(results);
  return {
    provider: provider.id,
    model: provider.model,
    cases: results,
    metrics,
  };
}

async function main() {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs();
  } catch (err) {
    console.error(red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
  const casesFile = path.join(process.cwd(), "evals", "cases.json");
  if (!fs.existsSync(casesFile)) {
    console.error(red(`✗ cases file not found: ${casesFile}`));
    process.exit(1);
  }
  const allCases: Case[] = JSON.parse(fs.readFileSync(casesFile, "utf-8"));
  const cases = opts.onlyIds
    ? allCases.filter((c) => opts.onlyIds?.includes(c.id))
    : allCases;

  // Choose providers
  let providers: ModelProvider[] = [];
  if (opts.json && opts.providerFilter === "mock") {
    providers = [new MockProvider()];
  } else if (opts.live) {
    providers = [new OllamaProvider(), new MuseSparkProvider()];
    // For live, still allow mock comparison
    providers.push(new MockProvider());
  } else if (opts.providerFilter) {
    if (opts.providerFilter === "mock") providers = [new MockProvider()];
    else if (opts.providerFilter === "glimmer")
      providers = [new OllamaProvider()];
    else if (opts.providerFilter === "spark")
      providers = [new MuseSparkProvider()];
  } else {
    // Default: mock only (CI-safe)
    providers = [new MockProvider()];
  }

  if (!opts.json) {
    console.log(bold(`\nGlimmer eval — ${cases.length} cases`));
    console.log(
      dim(
        `  providers: ${providers.map((p) => `${p.id}:${p.model}`).join(", ")}`,
      ),
    );
    if (!opts.live)
      console.log(
        dim(
          "  mode: mock (use --live for Ollama + Spark, requires server/keys)",
        ),
      );
    console.log("");
  }

  const reports: ProviderReport[] = [];
  for (const p of providers) {
    if (opts.live && p instanceof MuseSparkProvider && !p.hasCredentials()) {
      const spark = p;
      if (!opts.json)
        console.log(dim(`Skipping spark:${spark.model} — no credentials`));
      reports.push({
        provider: "spark",
        model: spark.model,
        cases: [],
        metrics: computeMetrics([]),
        skipped: true,
        skipReason: "no credentials",
      });
      continue;
    }
    if (!opts.json)
      process.stdout.write(dim(`Running ${p.id}:${p.model} ... `));
    const rep = await runProvider(p, cases);
    reports.push(rep);
    if (!opts.json) {
      const { pass, fail, f1 } = rep.metrics;
      console.log(
        `${green(`${pass} pass`)} ${fail ? red(`${fail} fail`) : ""} ${dim(`F1 ${f1.toFixed(2)}`)}`,
      );
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(makeReport(reports).json, null, 2));
    if (reports.some((r) => !r.skipped && r.metrics.fail > 0)) {
      process.exitCode = 1;
    }
    return;
  }

  const { jsonPath, mdPath } = writeResults(reports);
  console.log(bold("\nSummary"));
  for (const r of reports) {
    if (r.skipped) {
      console.log(
        `  ${cyan(r.provider)} (${r.model}): skipped — ${r.skipReason ?? "skipped"} (excluded from scoring)`,
      );
      continue;
    }
    const m = r.metrics;
    console.log(
      `  ${cyan(r.provider)} (${r.model}): ${green(`${m.pass}/${m.total} PASS`)} ${m.fail ? red(`${m.fail} FAIL`) : ""} · F1 ${m.f1} · arg ${m.argAccuracy} · p50 ${m.p50}ms`,
    );
  }
  console.log(dim(`\n  JSON: ${path.relative(process.cwd(), jsonPath)}`));
  console.log(dim(`  Markdown: ${path.relative(process.cwd(), mdPath)}`));

  const anyFail = reports.some((r) => r.metrics.fail > 0);
  if (anyFail) {
    console.log(
      yellow(
        "\n  Some cases failed — see report for details (failures expected for edge cases on live models)",
      ),
    );
  }
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  if (entry.endsWith("runner.ts")) return true;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(entry);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error(red("✗ Fatal: "), err);
    process.exit(1);
  });
}
