/**
 * Shared Server-Sent Events helpers for OpenAI-compatible streaming.
 *
 * In OpenAI-compatible streaming, a single tool call is spread across many
 * chunks: the first chunk carries the function name and the start of the
 * JSON arguments string, while continuation chunks carry only further
 * argument fragments (no name). Callers must therefore accumulate the
 * fragments by tool-call index/id and emit one tool call per index/id at
 * stream end, instead of emitting one call per chunk.
 */

import type { ToolCall } from "./types";

export type SseToolCallDelta = {
  id?: string;
  index?: number;
  function?: { name?: string; arguments?: string };
};

export type SseChatEvent = {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: SseToolCallDelta[];
    };
    finish_reason?: string;
  }>;
};

/**
 * Parse one SSE line (`data: {...}`) into a chat event.
 * Returns null for non-data lines, the `[DONE]` sentinel, and malformed JSON.
 */
export function parseSseDataLine(line: string): SseChatEvent | null {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as SseChatEvent;
  } catch {
    return null;
  }
}

/**
 * Accumulates streamed `tool_calls` deltas across SSE chunks, keyed by
 * index (falling back to id), and reassembles each call's arguments.
 */
export class SseToolCallAggregator {
  private readonly byKey = new Map<
    string,
    { id?: string; name: string; args: string }
  >();
  private lastKey: string | undefined;

  add(toolCalls: SseToolCallDelta[] | undefined): void {
    if (!toolCalls) return;
    for (const tc of toolCalls) {
      // A continuation chunk may omit both index and id; it belongs to the
      // most recent call seen so far.
      const key =
        tc.index !== undefined && tc.index !== null
          ? String(tc.index)
          : (tc.id ?? this.lastKey ?? "0");
      this.lastKey = key;
      const existing = this.byKey.get(key) ?? { name: "", args: "" };
      if (tc.id && !existing.id) existing.id = tc.id;
      if (tc.function?.name) existing.name = tc.function.name;
      if (tc.function?.arguments) existing.args += tc.function.arguments;
      this.byKey.set(key, existing);
    }
  }

  /** One reassembled tool call per accumulated index/id, in arrival order. */
  toToolCalls(): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const [key, v] of this.byKey) {
      if (!v.name) continue;
      let input: Record<string, unknown> = {};
      if (v.args) {
        try {
          input = JSON.parse(v.args) as Record<string, unknown>;
        } catch {
          input = { _raw: v.args };
        }
      }
      calls.push({ id: v.id ?? `call_${key}`, name: v.name, input });
    }
    return calls;
  }
}
