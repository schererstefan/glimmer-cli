/**
 * Muse Spark 1.2 provider — OpenAI-compatible HTTP API (fetch-based).
 * Env: MUSE_SPARK_API_KEY, MUSE_SPARK_BASE_URL, MUSE_SPARK_MODEL
 * Falls back to mock behavior when credentials are absent (so tests never require keys).
 */

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

  constructor(opts?: { model?: string; baseUrl?: string; apiKey?: string }) {
    this.model =
      opts?.model ?? process.env.MUSE_SPARK_MODEL ?? "muse-spark-1.2";
    this.baseUrl = (
      opts?.baseUrl ??
      process.env.MUSE_SPARK_BASE_URL ??
      "https://api.muse-spark.example/v1"
    ).replace(/\/$/, "");
    this.apiKey = opts?.apiKey ?? process.env.MUSE_SPARK_API_KEY;
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
    const toolCallsById = new Map<string, { name: string; args: string }>();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const evt = JSON.parse(data) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    id?: string;
                    index?: number;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string;
              }>;
            };
            const choice = evt.choices?.[0];
            const delta = choice?.delta;
            if (delta?.content) {
              yield { type: "text", text: delta.content } as Delta;
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = String(tc.index ?? tc.id ?? "0");
                const existing = toolCallsById.get(idx) ?? {
                  name: "",
                  args: "",
                };
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments)
                  existing.args += tc.function.arguments;
                toolCallsById.set(idx, existing);
              }
            }
            if (choice?.finish_reason === "tool_calls") {
              // flush
            }
          } catch {
            // ignore parse errors
          }
        }
      }
      // Emit aggregated tool calls
      for (const [id, v] of toolCallsById) {
        if (!v.name) continue;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = v.args
            ? (JSON.parse(v.args) as Record<string, unknown>)
            : {};
        } catch {
          parsed = { _raw: v.args };
        }
        yield {
          type: "tool_use",
          toolCall: { id: `call_${id}`, name: v.name, input: parsed },
        } as Delta;
      }
      const reason = toolCallsById.size > 0 ? "tool_use" : "stop";
      yield { type: "done", reason } as Delta;
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
