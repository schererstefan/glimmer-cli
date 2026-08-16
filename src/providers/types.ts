/**
 * ModelProvider abstraction — one interface for Glimmer (Ollama) and Muse Spark (API).
 * Mirrors the scherer-ai agent-core pattern but model-agnostic.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: Role;
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type Delta =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCall: ToolCall }
  | { type: "done"; reason: "stop" | "tool_use" | "error" };

export type ChatOptions = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  model?: string;
};

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  chat(options: ChatOptions): AsyncIterable<Delta>;
  // Non-streaming convenience
  complete(
    options: ChatOptions,
  ): Promise<{ text: string; toolCalls: ToolCall[] }>;
}

/** Provider metadata for eval reports */
export type ProviderInfo = {
  id: string;
  model: string;
  baseUrl?: string;
  via: "ollama" | "api" | "mock";
};
