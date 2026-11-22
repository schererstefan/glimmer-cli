/**
 * Muse Spark 1.2 provider — OpenAI-compatible HTTP API (fetch-based).
 * Env: MUSE_SPARK_API_KEY, MUSE_SPARK_BASE_URL, MUSE_SPARK_MODEL
 * Falls back to mock behavior when credentials are absent (so tests never require keys).
 */

import { parseSseDataLine, SseToolCallAggregator } from "./sse";
import type { ChatOptions, Delta, ModelProvider, ToolCall } from "./types";

type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function toOpenAITools(tools: ChatOptions["tools"]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties:
          (t.input_schema as { properties?: Record<string, unknown> })
            .properties ?? {},
        required: (t.input_schema as { required?: string[] }).required ?? [],
      },
    },
  }));
}

export class MuseSparkProvider implements ModelProvider {
  readonly id = "spark";
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;

  constructor(opts?: {
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
  }) {
    this.model =
      opts?.model ?? process.env.MUSE_SPARK_MODEL ?? "muse-spark-1.2";
    this.baseUrl = (
      opts?.baseUrl ??
      process.env.MUSE_SPARK_BASE_URL ??
      "https://api.muse-spark.example/v1"
    ).replace(/\/$/, "");
    this.apiKey = opts?.apiKey ?? process.env.MUSE_SPARK_API_KEY;
    const envTimeout = Number(process.env.MUSE_SPARK_TIMEOUT_MS);
    this.timeoutMs =
      opts?.timeoutMs ??
      (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 120_000);
  }

  hasCredentials(): boolean {
    return Boolean(
      this.apiKey && this.baseUrl && !this.baseUrl.includes("example"),
    );
  }

  async *chat(options: ChatOptions): AsyncIterable<Delta> {
    if (!this.hasCredentials()) {
      // Mock path — deterministic, no spend
      yield { type: "text", text: `[spark mock — no credentials] ` } as Delta;
      // Delegate to shared mock rule? Instead emit a friendly text and stop.
      // For eval harness, MockProvider is used explicitly; Spark mock here is just safety.
      yield { type: "done", reason: "stop" } as Delta;
      return;
    }

    const model = options.model ?? this.model;
    const tools = toOpenAITools(options.tools);
    const messages = options.messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          tool_call_id: m.tool_call_id ?? "",
          content: m.content,
        };
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: "assistant" as const,
          content: m.content,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        };
      }
      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      };
    });

    const body = JSON.stringify({
      model,
      messages,
      tools,
      stream: true,
      temperature: options.temperature ?? 0,
    });

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      yield {
        type: "text",
        text: `[spark fetch failed: ${err instanceof Error ? err.message : String(err)}]`,
      } as Delta;
      yield { type: "done", reason: "error" } as unknown as Delta;
      return;
    }

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      yield {
        type: "text",
        text: `[spark error ${res.status}: ${txt.slice(0, 300)}]`,
      } as Delta;
      yield { type: "done", reason: "error" } as unknown as Delta;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls = new SseToolCallAggregator();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const evt = parseSseDataLine(line);
          if (!evt) continue;
          const delta = evt.choices?.[0]?.delta;
          if (delta?.content) {
            yield { type: "text", text: delta.content } as Delta;
          }
          toolCalls.add(delta?.tool_calls);
        }
      }
      // Flush unterminated trailing line, if any
      const trailing = parseSseDataLine(buffer);
      if (trailing) {
        const delta = trailing.choices?.[0]?.delta;
        if (delta?.content) {
          yield { type: "text", text: delta.content } as Delta;
        }
        toolCalls.add(delta?.tool_calls);
      }
      // Emit aggregated tool calls
      const calls = toolCalls.toToolCalls();
      for (const toolCall of calls) {
        yield { type: "tool_use", toolCall } as Delta;
      }
      const reason = calls.length > 0 ? "tool_use" : "stop";
      yield { type: "done", reason } as Delta;
    } catch (err) {
      yield {
        type: "text",
        text: `[spark stream error: ${err instanceof Error ? err.message : String(err)}]`,
      } as Delta;
      yield { type: "done", reason: "error" } as unknown as Delta;
    } finally {
      reader.releaseLock();
    }
  }

  async complete(
    options: ChatOptions,
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const deltas: Delta[] = [];
    for await (const d of this.chat(options)) deltas.push(d);
    const text = deltas
      .filter((d) => d.type === "text")
      .map((d) => (d as { text: string }).text)
      .join("");
    const toolCalls = deltas
      .filter((d) => d.type === "tool_use")
      .map((d) => (d as { toolCall: ToolCall }).toolCall);
    return { text, toolCalls };
  }
}
