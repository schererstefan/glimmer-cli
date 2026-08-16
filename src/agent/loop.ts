/**
 * Agentic loop — mirrors scherer-ai/lib/agent-core.ts but provider-agnostic.
 * Handles up to MAX_TOOL_ROUNDS tool cycles with streaming callbacks.
 */

import type {
  ChatMessage,
  ModelProvider,
  ToolCall,
} from "@/src/providers/types";
import { tools as catalog } from "@/src/tools/catalog";
import { runTool } from "@/src/tools/registry";
import { buildSystemPrompt } from "./prompts";

export const MAX_TOOL_ROUNDS = 4;

export type LoopMessage = ChatMessage;

export type LoopOptions = {
  provider: ModelProvider;
  messages: LoopMessage[];
  onDelta?: (text: string) => void;
  onToolUse?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: unknown) => void;
  temperature?: number;
};

export type LoopResult = {
  text: string;
  toolCalls: ToolCall[];
  rounds: number;
};

export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const { provider, onDelta, onToolUse, onToolResult } = options;
  const conversation: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...options.messages,
  ];

  let fullText = "";
  const allToolCalls: ToolCall[] = [];
  let rounds = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    rounds = round + 1;
    const deltas: string[] = [];
    const toolCalls: ToolCall[] = [];

    for await (const delta of provider.chat({
      messages: conversation,
      tools: catalog,
      temperature: options.temperature ?? 0,
    })) {
      if (delta.type === "text") {
        deltas.push(delta.text);
        fullText += delta.text;
        onDelta?.(delta.text);
      } else if (delta.type === "tool_use") {
        toolCalls.push(delta.toolCall);
        allToolCalls.push(delta.toolCall);
        onToolUse?.(delta.toolCall.name, delta.toolCall.input);
      } else if (delta.type === "done") {
        if (delta.reason === "stop" && toolCalls.length === 0) {
          // Done without tools — return final text
          return { text: fullText, toolCalls: allToolCalls, rounds };
        }
        if (delta.reason === "tool_use" && toolCalls.length === 0) {
          // Edge: provider signaled tool_use but sent no calls
          continue;
        }
        break;
      }
    }

    // If no tool calls this round, we're done
    if (toolCalls.length === 0) {
      // Also push assistant message for completeness
      if (deltas.length > 0) {
        conversation.push({ role: "assistant", content: deltas.join("") });
      }
      return { text: fullText, toolCalls: allToolCalls, rounds };
    }

    // Execute tools and append results
    // First push the assistant's tool_calls message
    conversation.push({
      role: "assistant",
      content: deltas.join("") || "",
      tool_calls: toolCalls,
    });

    // Parallel dispatch — independent tools
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        try {
          const out = await runTool(tc.name, tc.input);
          onToolResult?.(tc.name, out.result);
          return { id: tc.id, name: tc.name, result: out.result };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { id: tc.id, name: tc.name, result: { error: msg } };
        }
      }),
    );

    for (const r of results) {
      conversation.push({
        role: "tool",
        tool_call_id: r.id,
        name: r.name,
        content: JSON.stringify(r.result),
      });
    }

    // Continue loop — next iteration will call provider again with tool results
    // If caller sees fullText still empty, they'll get it next round's text
  }

  return { text: fullText, toolCalls: allToolCalls, rounds };
}
