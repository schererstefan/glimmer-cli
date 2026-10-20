import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "@/src/providers/mock";
import { MuseSparkProvider } from "@/src/providers/muse-spark";
import { OllamaProvider } from "@/src/providers/ollama";
import type { Delta } from "@/src/providers/types";
import { tools } from "@/src/tools/catalog";

const ENV_KEYS = [
  "GLIMMER_TIMEOUT_MS",
  "MUSE_SPARK_TIMEOUT_MS",
  "GLIMMER_MODEL",
  "FALLBACK_MODEL",
  "OLLAMA_HOST",
  "MUSE_SPARK_MODEL",
  "MUSE_SPARK_BASE_URL",
  "MUSE_SPARK_API_KEY",
] as const;

const savedEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function neverResolvingFetch() {
  return vi.fn(
    (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(
            signal.reason ??
              new DOMException("The operation timed out.", "TimeoutError"),
          );
          return;
        }
        signal.addEventListener("abort", () => {
          reject(
            signal.reason ??
              new DOMException("The operation timed out.", "TimeoutError"),
          );
        });
      }),
  );
}

async function collectDeltas(iterable: AsyncIterable<Delta>): Promise<Delta[]> {
  const deltas: Delta[] = [];
  for await (const delta of iterable) deltas.push(delta);
  return deltas;
}

function textOf(deltas: Delta[]): string {
  return deltas
    .filter((d) => d.type === "text")
    .map((d) => (d as { text: string }).text)
    .join("");
}

function streamResponse(bodyText: string, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(bodyText));
      controller.close();
    },
  });
  return new Response(body, { status });
}

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

describe("providers with stubbed fetch", () => {
  it("Ollama timeout: never-resolving fetch ends with done error", async () => {
    const fetchStub = neverResolvingFetch();
    vi.stubGlobal("fetch", fetchStub);
    const p = new OllamaProvider({
      host: "http://localhost:11434",
      model: "llama3.1:8b",
      timeoutMs: 20,
    });
    expect(p.timeoutMs).toBe(20);
    const deltas = await collectDeltas(
      p.chat({
        messages: [{ role: "user", content: "hello" }],
        tools,
      }),
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBeDefined();
    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(deltas.at(-1)).toEqual({ type: "done", reason: "error" });
  });

  it("MuseSpark timeout: never-resolving fetch ends with done error", async () => {
    const fetchStub = neverResolvingFetch();
    vi.stubGlobal("fetch", fetchStub);
    const p = new MuseSparkProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.muse-spark.live/v1",
      timeoutMs: 20,
    });
    expect(p.hasCredentials()).toBe(true);
    expect(p.timeoutMs).toBe(20);
    const deltas = await collectDeltas(
      p.chat({
        messages: [{ role: "user", content: "hello" }],
        tools,
      }),
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBeDefined();
    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(deltas.at(-1)).toEqual({ type: "done", reason: "error" });
  });

  it("Ollama streamed chunk + tool call parses", async () => {
    const line = JSON.stringify({
      message: {
        content: "Hi ",
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "get_weather",
              arguments: { location: "Seattle" },
            },
          },
        ],
      },
      done: true,
    });
    const fetchStub = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        streamResponse(`${line}\n`),
    );
    vi.stubGlobal("fetch", fetchStub);
    const p = new OllamaProvider({
      host: "http://localhost:11434",
      model: "llama3.1:8b",
    });
    const deltas = await collectDeltas(
      p.chat({
        messages: [{ role: "user", content: "What's the weather in Seattle?" }],
        tools,
      }),
    );
    expect(textOf(deltas)).toContain("Hi");
    const toolDelta = deltas.find(
      (d): d is Extract<Delta, { type: "tool_use" }> => d.type === "tool_use",
    );
    expect(toolDelta?.toolCall.name).toBe("get_weather");
    expect(toolDelta?.toolCall.input.location).toBe("Seattle");
    expect(deltas.at(-1)).toEqual({ type: "done", reason: "tool_use" });
  });

  it("Ollama 404 falls back to OpenAI compat endpoint", async () => {
    const fetchStub = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        if (String(input).includes("/v1/chat/completions")) {
          return streamResponse(
            'data: {"choices":[{"delta":{"content":"compat hi"}}]}\n\ndata: [DONE]\n\n',
          );
        }
        return new Response("model not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchStub);
    const p = new OllamaProvider({
      host: "http://localhost:11434",
      model: "llama3.1:8b",
    });
    const deltas = await collectDeltas(
      p.chat({
        messages: [{ role: "user", content: "hello" }],
        tools,
      }),
    );
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(String(fetchStub.mock.calls[1]?.[0])).toContain(
      "/v1/chat/completions",
    );
    expect(textOf(deltas)).toContain("compat hi");
    expect(deltas.at(-1)).toEqual({ type: "done", reason: "stop" });
  });

  it("MuseSpark streamed chunk parses", async () => {
    const fetchStub = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        streamResponse(
          'data: {"choices":[{"delta":{"content":"spark hi"}}]}\n\ndata: [DONE]\n\n',
        ),
    );
    vi.stubGlobal("fetch", fetchStub);
    const p = new MuseSparkProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.muse-spark.live/v1",
    });
    const deltas = await collectDeltas(
      p.chat({
        messages: [{ role: "user", content: "hello" }],
        tools,
      }),
    );
    expect(textOf(deltas)).toContain("spark hi");
    expect(deltas.at(-1)).toEqual({ type: "done", reason: "stop" });
  });
});
