/**
 * Ollama provider — talks to local Ollama HTTP API (http://localhost:11434)
 * Supports both /api/chat (native) and OpenAI-compatible /v1/chat/completions.
 * Handles tool-calling loop by forwarding tool definitions as `tools`.
 */

import type {
  ChatMessage,
  ChatOptions,
  Delta,
  ModelProvider,
  ToolCall,
  ToolDefinition,
} from "./types";

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function toOllamaTools(tools?: ToolDefinition[]): OllamaTool[] | undefined {
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

function chatMessagesToOllama(
  messages: ChatMessage[],
): Array<{ role: string; content: string; tool_calls?: unknown }> {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content };
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          function: { name: tc.name, arguments: tc.input },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export class OllamaProvider implements ModelProvider {
  readonly id = "glimmer";
  readonly model: string;
  readonly host: string;

  constructor(opts?: { model?: string; host?: string }) {
    this.host = (
      opts?.host ??
      process.env.OLLAMA_HOST ??
      "http://localhost:11434"
    ).replace(/\/$/, "");
    this.model =
      opts?.model ??
      process.env.GLIMMER_MODEL ??
      process.env.FALLBACK_MODEL ??
      "llama3.1:8b";
  }

  async *chat(options: ChatOptions): AsyncIterable<Delta> {
    const model = options.model ?? this.model;
    const tools = toOllamaTools(options.tools);
    const messages = chatMessagesToOllama(options.messages);

    const body = JSON.stringify({
      model,
      messages,
      tools,
      stream: true,
      options: {
        temperature: options.temperature ?? 0,
      },
    });

    let res: Response;
    try {
      res = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      yield {
        type: "text",
        text: `[ollama unreachable at ${this.host}: ${err instanceof Error ? err.message : String(err)}]`,
      } as Delta;
      yield { type: "done", reason: "error" } as unknown as Delta;
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      // Fallback: try OpenAI-compatible endpoint
      if (res.status === 404 || text.includes("not found")) {
        yield* this.chatOpenAICompat(options);
        return;
      }
      yield {
        type: "text",
        text: `[ollama error ${res.status}: ${text.slice(0, 200)}]`,
      } as Delta;
      yield { type: "done", reason: "error" } as unknown as Delta;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let doneReason: "stop" | "tool_use" = "stop";
    let pendingToolCalls: ToolCall[] = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue;
          }
          const msg = evt.message as
            | {
                content?: string;
                tool_calls?: Array<{
                  id?: string;
                  function: {
                    name: string;
                    arguments: Record<string, unknown> | string;
                  };
                }>;
              }
            | undefined;
          if (msg?.content) {
            yield { type: "text", text: msg.content as string } as Delta;
          }
          if (msg?.tool_calls) {
            for (const tc of msg.tool_calls) {
              const args =
                typeof tc.function.arguments === "string"
                  ? (() => {
                      try {
                        return JSON.parse(
                          tc.function.arguments as string,
                        ) as Record<string, unknown>;
                      } catch {
                        return { _raw: tc.function.arguments };
                      }
                    })()
                  : (tc.function.arguments as Record<string, unknown>);
              const call: ToolCall = {
                id: tc.id ?? `call_${Math.random().toString(36).slice(2, 8)}`,
                name: tc.function.name,
                input: args,
              };
              pendingToolCalls.push(call);
            }
            doneReason = "tool_use";
          }
          if (evt.done && pendingToolCalls.length > 0) {
            for (const tc of pendingToolCalls) {
              yield { type: "tool_use", toolCall: tc } as Delta;
            }
            pendingToolCalls = [];
          }
        }
      }
      // Flush remaining buffer line
      if (buffer.trim()) {
        try {
          const evt = JSON.parse(buffer.trim()) as Record<string, unknown>;
          const msg = evt.message as { content?: string } | undefined;
          if (msg?.content) yield { type: "text", text: msg.content } as Delta;
        } catch {
          // ignore
        }
      }
      // Flush any pending tool calls if not yet emitted
      for (const tc of pendingToolCalls) {
        yield { type: "tool_use", toolCall: tc } as Delta;
      }
      yield { type: "done", reason: doneReason } as Delta;
    } finally {
      reader.releaseLock();
    }
  }

  private async *chatOpenAICompat(options: ChatOptions): AsyncIterable<Delta> {
    const model = options.model ?? this.model;
    const tools = toOllamaTools(options.tools);
    const messages = chatMessagesToOllama(options.messages).map((m) => ({
      role: m.role as string,
      content: m.content,
      tool_calls: (m as { tool_calls?: unknown }).tool_calls,
    }));
    const body = JSON.stringify({
      model,
      messages,
      tools,
      stream: true,
      temperature: options.temperature ?? 0,
    });
    let res: Response;
    try {
      res = await fetch(`${this.host}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      yield {
        type: "text",
        text: `[ollama openai compat unreachable: ${err instanceof Error ? err.message : String(err)}]`,
      } as Delta;
      yield { type: "done", reason: "error" } as unknown as Delta;
      return;
    }
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      yield {
        type: "text",
        text: `[ollama openai error ${res.status}: ${t.slice(0, 200)}]`,
      } as Delta;
      yield { type: "done", reason: "error" } as unknown as Delta;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
            };
            const delta = evt.choices?.[0]?.delta;
            if (delta?.content)
              yield { type: "text", text: delta.content } as Delta;
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const fn = tc.function;
                if (!fn?.name) continue;
                let args: Record<string, unknown> = {};
                if (fn.arguments) {
                  try {
                    args = JSON.parse(fn.arguments) as Record<string, unknown>;
                  } catch {
                    args = { _raw: fn.arguments };
                  }
                }
                yield {
                  type: "tool_use",
                  toolCall: {
                    id:
                      tc.id ?? `call_${Math.random().toString(36).slice(2, 6)}`,
                    name: fn.name,
                    input: args,
                  },
                } as Delta;
              }
            }
          } catch {
            // ignore
          }
        }
      }
      yield { type: "done", reason: "stop" } as Delta;
    } finally {
      reader.releaseLock();
    }
  }

  async complete(
    options: ChatOptions,
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const chunks: Delta[] = [];
    for await (const d of this.chat(options)) chunks.push(d);
    const text = chunks
      .filter((d) => d.type === "text")
      .map((d) => (d as { text: string }).text)
      .join("");
    const toolCalls = chunks
      .filter((d) => d.type === "tool_use")
      .map((d) => (d as { toolCall: ToolCall }).toolCall);
    return { text, toolCalls };
  }
}
