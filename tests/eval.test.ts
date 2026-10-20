import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CaseResult,
  computeMetrics,
  makeReport,
  type ProviderReport,
  writeResults,
} from "@/src/eval/report";
import { parseArgs } from "@/src/eval/runner";

function fakeCase(overrides: Partial<CaseResult>): CaseResult {
  return {
    id: "c01",
    category: "single",
    prompt: "hello",
    expected: { tool: "get_weather" },
    actual: {
      tools: ["get_weather"],
      args: [{ location: "Seattle" }],
      text: "weather is rain",
    },
    latencyMs: 100,
    toolSelectionCorrect: true,
    argsCorrect: true,
    mustIncludePass: true,
    verdict: "PASS",
    notes: [],
    ...overrides,
  };
}

describe("eval cases.json", () => {
  it("is valid JSON with 45 cases and required fields", () => {
    const file = path.join(process.cwd(), "evals", "cases.json");
    expect(fs.existsSync(file)).toBe(true);
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<
      Record<string, unknown>
    >;
    expect(data.length).toBe(45);
    for (const c of data) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.prompt).toBe("string");
      expect(typeof c.category).toBe("string");
      expect(c.expected).toBeDefined();
    }
  });

  it("covers all categories", () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "evals", "cases.json"), "utf-8"),
    ) as Array<{ category: string }>;
    const cats = new Set(data.map((d) => d.category));
    for (const need of [
      "single",
      "parallel",
      "multi",
      "negative",
      "edge",
      "factual",
    ]) {
      expect(cats.has(need)).toBe(true);
    }
  });

  it("negative cases expect no tool", () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "evals", "cases.json"), "utf-8"),
    ) as Array<{ category: string; expected: { tool: string | null } }>;
    for (const c of data.filter((d) => d.category === "negative")) {
      expect(c.expected.tool).toBeNull();
    }
  });
});

describe("computeMetrics", () => {
  it("computes F1, latency percentiles", () => {
    const cases: CaseResult[] = [
      fakeCase({
        id: "c01",
        verdict: "PASS",
        latencyMs: 100,
        toolSelectionCorrect: true,
        argsCorrect: true,
      }),
      fakeCase({
        id: "c02",
        verdict: "PASS",
        latencyMs: 200,
        toolSelectionCorrect: true,
        argsCorrect: true,
      }),
      fakeCase({
        id: "c03",
        verdict: "FAIL",
        latencyMs: 300,
        toolSelectionCorrect: false,
        argsCorrect: false,
      }),
      fakeCase({
        id: "c04",
        category: "negative",
        verdict: "PASS",
        latencyMs: 50,
        expected: { tool: null },
        actual: { tools: [], args: [], text: "hello" },
      }),
      fakeCase({
        id: "c05",
        category: "negative",
        verdict: "FAIL",
        latencyMs: 60,
        expected: { tool: null },
        actual: { tools: ["get_weather"], args: [], text: "" },
        toolSelectionCorrect: false,
      }),
      fakeCase({
        id: "c06",
        category: "multi",
        verdict: "PASS",
        latencyMs: 150,
      }),
      fakeCase({
        id: "c07",
        category: "multi",
        verdict: "FAIL",
        latencyMs: 160,
        toolSelectionCorrect: false,
      }),
    ];
    const m = computeMetrics(cases);
    expect(m.total).toBe(7);
    expect(m.pass).toBe(4);
    expect(m.fail).toBe(3);
    expect(m.p50).toBeGreaterThan(0);
    expect(m.p95).toBeGreaterThanOrEqual(m.p50);
    expect(m.avgLatency).toBeGreaterThan(0);
  });
});

describe("makeReport", () => {
  it("produces markdown with provider columns", () => {
    const cases = [fakeCase({ id: "c01" })];
    const metrics = computeMetrics(cases);
    const { markdown, json } = makeReport([
      { provider: "mock", model: "mock-glimmer-v1", cases, metrics },
      { provider: "ollama", model: "llama3.1:8b", cases, metrics },
    ]);
    expect(markdown).toContain("Glimmer vs Muse Spark");
    expect(markdown).toContain("mock");
    expect(markdown).toContain("ollama");
    expect((json as { timestamp: string }).timestamp).toBeDefined();
  });
});

describe("mock-only provenance", () => {
  function mockReport(): ProviderReport {
    const cases = [fakeCase({ id: "c01" })];
    return {
      provider: "mock",
      model: "mock-glimmer-v1",
      cases,
      metrics: computeMetrics(cases),
    };
  }

  it("titles mock-only report as no model comparison with Mode and Providers", () => {
    const { markdown, json } = makeReport([mockReport()]);
    expect(markdown).toContain("Mock only — no model comparison");
    expect(markdown).not.toContain("Glimmer vs Muse Spark 1.2 — Eval Report");
    expect(markdown).toContain("Mode:");
    expect(markdown).toContain("mock-only");
    expect(markdown).toContain("Providers:");
    expect(markdown).toContain("mock:mock-glimmer-v1");
    expect((json as { mode: string }).mode).toBe("mock-only");
  });

  it("writeResults writes COMPARISON-MOCK.md and does not touch COMPARISON.md", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "glimmer-eval-"));
    try {
      const outDir = path.join(tmp, "results");
      const sentinel = path.join(tmp, "COMPARISON.md");
      fs.writeFileSync(sentinel, "sentinel live results\n");
      const { jsonPath, mdPath } = writeResults([mockReport()], outDir);
      expect(mdPath).toBe(path.join(tmp, "COMPARISON-MOCK.md"));
      expect(fs.existsSync(mdPath)).toBe(true);
      expect(fs.readFileSync(mdPath, "utf-8")).toContain(
        "Mock only — no model comparison",
      );
      expect(fs.readFileSync(sentinel, "utf-8")).toBe(
        "sentinel live results\n",
      );
      expect(fs.existsSync(jsonPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
        mode: string;
      };
      expect(written.mode).toBe("mock-only");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writeResults writes COMPARISON.md for mixed/live reports", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "glimmer-eval-"));
    try {
      const outDir = path.join(tmp, "results");
      const cases = [fakeCase({ id: "c01" })];
      const metrics = computeMetrics(cases);
      const { mdPath } = writeResults(
        [
          mockReport(),
          { provider: "ollama", model: "llama3.1:8b", cases, metrics },
        ],
        outDir,
      );
      expect(mdPath).toBe(path.join(tmp, "COMPARISON.md"));
      expect(fs.existsSync(mdPath)).toBe(true);
      expect(fs.existsSync(path.join(tmp, "COMPARISON-MOCK.md"))).toBe(false);
      expect(fs.readFileSync(mdPath, "utf-8")).toContain(
        "Glimmer vs Muse Spark",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("parseArgs", () => {
  it("throws on unknown provider value", () => {
    expect(() => parseArgs(["--provider=glimemr"])).toThrow(
      /Unknown provider.*glimemr/,
    );
  });

  it("throws on space form --only naming --only", () => {
    expect(() => parseArgs(["--only", "c01,c02"])).toThrow(/--only/);
  });

  it("throws on unknown argument naming it", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/--bogus/);
  });

  it("parses = forms for --only and --provider", () => {
    const opts = parseArgs(["--only=c01,c02", "--provider=mock"]);
    expect(opts.onlyIds).toEqual(["c01", "c02"]);
    expect(opts.providerFilter).toBe("mock");
  });
});

describe("skipped Spark", () => {
  it("labels skipped spark, suppresses Delta, and carries skipped in JSON", () => {
    const cases = [fakeCase({ id: "c01" })];
    const skippedSpark: ProviderReport = {
      provider: "spark",
      model: "muse-spark-1.2",
      cases: [],
      metrics: computeMetrics([]),
      skipped: true,
      skipReason: "no credentials",
    };
    const { markdown, json } = makeReport([
      {
        provider: "ollama",
        model: "llama3.1:8b",
        cases,
        metrics: computeMetrics(cases),
      },
      skippedSpark,
    ]);
    expect(markdown).toContain("spark (no credentials — skipped)");
    expect(markdown).toContain("excluded from scoring");
    const f1Row = markdown
      .split("\n")
      .find((l) => l.startsWith("| Tool-selection F1 |"));
    expect(f1Row).toBeDefined();
    const cells = (f1Row as string).split("|").map((c) => c.trim());
    // cells: ["", "Tool-selection F1", ollamaVal, sparkVal, delta, ""]
    expect(cells[cells.length - 2]).toBe("");
    const parsed = json as {
      mode: string;
      providers: Array<{ provider: string; skipped?: boolean }>;
    };
    expect(parsed.mode).not.toBe("mock-only");
    expect(parsed.providers[1]?.skipped).toBe(true);
    const skippedSection =
      markdown.split("### spark (no credentials — skipped)")[1] ?? "";
    expect(skippedSection).toContain("no credentials");
    expect(skippedSection).not.toContain("Top failures");
    expect(skippedSection).not.toContain("| c01 |");
  });
});
