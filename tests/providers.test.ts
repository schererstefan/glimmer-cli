import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@/src/providers/mock";
import { MuseSparkProvider } from "@/src/providers/muse-spark";
import { OllamaProvider } from "@/src/providers/ollama";
import { tools } from "@/src/tools/catalog";

describe("MockProvider", () => {
  it("has id mock and default model", () => {
    const p = new MockProvider();
    expect(p.id).toBe("mock");
    expect(p.model).toContain("mock");
  });

  it("routes weather prompt to get_weather", async () => {
    const p = new MockProvider();
    const { toolCalls } = await p.complete({
      messages: [
        { role: "user", content: "What's the weather in Seattle tomorrow?" },
      ],
      tools,
    });
    expect(toolCalls.some((c) => c.name === "get_weather")).toBe(true);
  });

  it("routes plan trip to two parallel tools", async () => {
    const p = new MockProvider();
    const { toolCalls } = await p.complete({
      messages: [
        {
          role: "user",
          content:
            "Plan my trip to San Francisco from 2026-08-17 to 2026-08-20",
        },
      ],
      tools,
    });
    expect(toolCalls.map((c) => c.name)).toContain("get_weather");
    expect(toolCalls.map((c) => c.name)).toContain("search_calendar");
  });

  it("returns no tool for hello", async () => {
    const p = new MockProvider();
    const { toolCalls, text } = await p.complete({
      messages: [{ role: "user", content: "Hello, how are you?" }],
      tools,
    });
    expect(toolCalls).toHaveLength(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("streams deltas", async () => {
    const p = new MockProvider();
    const deltas: unknown[] = [];
    for await (const d of p.chat({
      messages: [{ role: "user", content: "Calculate 2+2" }],
      tools,
    }))
      deltas.push(d);
    expect(
      deltas.some((d) => (d as { type: string }).type === "tool_use"),
    ).toBe(true);
    expect(deltas.some((d) => (d as { type: string }).type === "done")).toBe(
      true,
    );
  });

  it("respects available tools filter", async () => {
    const p = new MockProvider();
    const { toolCalls } = await p.complete({
      messages: [{ role: "user", content: "What's the weather in Seattle?" }],
      tools: tools.filter((t) => t.name !== "get_weather"),
    });
    expect(toolCalls.some((c) => c.name === "get_weather")).toBe(false);
  });
});

describe("OllamaProvider", () => {
  it("constructs with defaults from env", () => {
    const p = new OllamaProvider({
      host: "http://localhost:11434",
      model: "llama3.1:8b",
    });
    expect(p.host).toBe("http://localhost:11434");
    expect(p.model).toBe("llama3.1:8b");
    expect(p.id).toBe("glimmer");
  });

  it("uses GLIMMER_MODEL env fallback", () => {
    const prev = process.env.GLIMMER_MODEL;
    process.env.GLIMMER_MODEL = "glimmer:test";
    const p = new OllamaProvider({ host: "http://localhost:11434" });
    expect(p.model).toBe("glimmer:test");
    if (prev === undefined) delete process.env.GLIMMER_MODEL;
    else process.env.GLIMMER_MODEL = prev;
  });

  describe("default model resolution", () => {
    let savedGlimmerModel: string | undefined;
    let savedFallbackModel: string | undefined;

    beforeEach(() => {
      savedGlimmerModel = process.env.GLIMMER_MODEL;
      savedFallbackModel = process.env.FALLBACK_MODEL;
      delete process.env.GLIMMER_MODEL;
      delete process.env.FALLBACK_MODEL;
    });

    afterEach(() => {
      if (savedGlimmerModel === undefined) delete process.env.GLIMMER_MODEL;
      else process.env.GLIMMER_MODEL = savedGlimmerModel;
      if (savedFallbackModel === undefined) delete process.env.FALLBACK_MODEL;
      else process.env.FALLBACK_MODEL = savedFallbackModel;
    });

    it("defaults to muse-glimmer when no model env is set", () => {
      expect(new OllamaProvider().model).toBe("muse-glimmer");
    });

    it("ignores FALLBACK_MODEL so it cannot masquerade as the primary", () => {
      process.env.FALLBACK_MODEL = "llama3.1:8b";
      expect(new OllamaProvider().model).toBe("muse-glimmer");
    });

    it("lets GLIMMER_MODEL win over the muse-glimmer default", () => {
      process.env.GLIMMER_MODEL = "glimmer:custom";
      expect(new OllamaProvider().model).toBe("glimmer:custom");
    });
  });
});

describe("MuseSparkProvider", () => {
  it("detects missing credentials", () => {
    const p = new MuseSparkProvider({
      baseUrl: "https://api.muse-spark.example/v1",
      apiKey: undefined,
    });
    expect(p.hasCredentials()).toBe(false);
  });

  it("uses provided apiKey and baseUrl", () => {
    const p = new MuseSparkProvider({
      apiKey: "sk-123",
      baseUrl: "https://api.muse-spark.live/v1",
      model: "muse-spark-1.2",
    });
    expect(p.hasCredentials()).toBe(true);
    expect(p.model).toBe("muse-spark-1.2");
  });

  it("mock path when no credentials yields text", async () => {
    const p = new MuseSparkProvider({
      apiKey: undefined,
      baseUrl: "https://api.muse-spark.example/v1",
    });
    const chunks: unknown[] = [];
    for await (const d of p.chat({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    }))
      chunks.push(d);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
