import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type CaseResult, computeMetrics, makeReport } from "@/src/eval/report";

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
