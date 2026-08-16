#!/usr/bin/env node
/**
 * Glimmer CLI — one-shot + interactive REPL with streaming + tool traces.
 * Mirrors scherer-ai/scripts/ask-cli.ts pattern.
 *
 * Usage:
 *   pnpm cli --help
 *   pnpm cli "What's the weather in Seattle tomorrow?"
 *   pnpm cli --provider spark "Book a meeting for tomorrow 10am"
 *   pnpm cli                  # REPL
 */

import readline from "node:readline/promises";
import { runLoop } from "@/src/agent/loop";
import { MockProvider } from "@/src/providers/mock";
import { MuseSparkProvider } from "@/src/providers/muse-spark";
import { OllamaProvider } from "@/src/providers/ollama";
import type { ModelProvider } from "@/src/providers/types";

// Simple arg parsing — no extra deps
type CliArgs = {
  help: boolean;
  verbose: boolean;
  json: boolean;
  provider: "glimmer" | "spark" | "mock";
  model?: string;
  prompt?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    verbose: false,
    json: false,
    provider: "glimmer",
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--json") args.json = true;
    else if (a === "--provider") {
      const v = argv[++i];
      if (v === "glimmer" || v === "spark" || v === "mock") args.provider = v;
      else {
        console.error(`Unknown provider: ${v} (use glimmer|spark|mock)`);
        process.exit(1);
      }
    } else if (a === "--model") {
      args.model = argv[++i];
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else {
      rest.push(a);
    }
  }
  if (rest.length > 0) args.prompt = rest.join(" ");
  return args;
}

function printHelp() {
  console.log(`
Glimmer CLI — local Glimmer (Ollama) + Muse Spark 1.2 demo

Usage:
  pnpm cli [options] [prompt]

Options:
  --provider <glimmer|spark|mock>  Model provider (default: glimmer via Ollama)
  --model <id>                     Override model id
  --verbose, -v                    Show tool inputs/outputs
  --json                           Emit JSON lines (machine-readable)
  --help, -h                       Show this help

Examples:
  pnpm cli "What's the weather in Seattle tomorrow?"
  pnpm cli --provider mock "Book a meeting for tomorrow 10am"
  pnpm cli --provider glimmer --model llama3.1:8b "Hello"
  pnpm cli                         # interactive REPL

Env:
  OLLAMA_HOST                      Ollama host (default http://localhost:11434)
  GLIMMER_MODEL                    Glimmer model tag (default glimmer:8b-instruct-q4_K_M)
  FALLBACK_MODEL                   Fallback when Glimmer not available (default llama3.1:8b)
  MUSE_SPARK_API_KEY               Spark API key
  MUSE_SPARK_BASE_URL              Spark base URL
  MUSE_SPARK_MODEL                 Spark model (default muse-spark-1.2)
`);
}

function color(s: string, code: number): string {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
const dim = (s: string) => color(s, 2);
const bold = (s: string) => color(s, 1);
const red = (s: string) => color(s, 31);
const cyan = (s: string) => color(s, 36);
const green = (s: string) => color(s, 32);
const yellow = (s: string) => color(s, 33);

function createProvider(
  kind: CliArgs["provider"],
  modelOverride?: string,
): ModelProvider {
  if (kind === "mock") return new MockProvider();
  if (kind === "spark")
    return new MuseSparkProvider(
      modelOverride ? { model: modelOverride } : undefined,
    );
  return new OllamaProvider(
    modelOverride ? { model: modelOverride } : undefined,
  );
}

async function chatOnce(
  provider: ModelProvider,
  question: string,
  opts: {
    verbose: boolean;
    json: boolean;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  },
) {
  opts.history.push({ role: "user", content: question });

  const start = Date.now();
  let firstDelta = true;
  let toolCount = 0;

  if (!opts.json) process.stdout.write(dim("·"));

  const result = await runLoop({
    provider,
    messages: opts.history.map((m) => ({ role: m.role, content: m.content })),
    onDelta: (t) => {
      if (opts.json) return;
      if (firstDelta) {
        const label = provider.id === "mock" ? "mock" : provider.id;
        process.stdout.write(`\r${cyan(`${label} ▸ `)}`);
        firstDelta = false;
      }
      process.stdout.write(t);
    },
    onToolUse: (name, input) => {
      toolCount++;
      if (opts.verbose && !opts.json) {
        process.stdout.write(
          `\r${yellow(`  [tool: ${name} ${JSON.stringify(input)}]`)}\n`,
        );
        firstDelta = true;
      } else if (opts.json) {
        console.log(JSON.stringify({ type: "tool_use", name, input }));
      }
    },
    onToolResult: (name, result) => {
      if (opts.verbose && !opts.json) {
        const preview = JSON.stringify(result).slice(0, 200);
        process.stdout.write(`${dim(`  [tool_result: ${name} ${preview}]`)}\n`);
      }
    },
  });

  const latency = Date.now() - start;
  opts.history.push({
    role: "assistant",
    content: result.text || "[tool calls completed]",
  });

  if (opts.json) {
    console.log(
      JSON.stringify({
        type: "answer",
        text: result.text,
        toolCalls: result.toolCalls,
        latencyMs: latency,
        provider: provider.id,
        model: provider.model,
      }),
    );
  } else {
    if (firstDelta && result.text === "" && toolCount > 0) {
      // Tools were called but no final text — show summary
      process.stdout.write(
        `\r${cyan(`${provider.id} ▸ `)}${dim(`[${toolCount} tool call(s) completed]`)}`,
      );
    }
    process.stdout.write("\n");
    if (opts.verbose) {
      console.log(
        dim(
          `\n  done — ${latency}ms · ${result.rounds} round(s) · ${result.toolCalls.length} tool call(s)`,
        ),
      );
    }
  }
  return result;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const provider = createProvider(args.provider, args.model);
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  // One-shot mode
  if (args.prompt) {
    if (!args.json) {
      const modelInfo = `${provider.id}:${provider.model}`;
      console.log(
        bold(`\nGlimmer CLI — ${modelInfo}`) +
          dim(` ${args.verbose ? "(verbose)" : ""}`),
      );
    }
    try {
      await chatOnce(provider, args.prompt, {
        verbose: args.verbose,
        json: args.json,
        history,
      });
    } catch (err) {
      console.error(
        red("\n✗ ") + (err instanceof Error ? err.message : String(err)),
      );
      process.exit(1);
    }
    return;
  }

  // REPL mode
  if (!args.json) {
    console.log(bold("\nGlimmer CLI — interactive"));
    console.log(dim(`Provider: ${provider.id} (${provider.model})`));
    console.log(
      dim(
        "Type a question. Empty line, exit or Ctrl-D to quit. Add --verbose for tool traces.\n",
      ),
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  while (true) {
    const q = (await rl.question(green("you ▸ "))).trim();
    if (!q || q === "exit" || q === "quit") break;
    try {
      await chatOnce(provider, q, {
        verbose: args.verbose,
        json: args.json,
        history,
      });
    } catch (err) {
      console.error(
        `${red("\n✗ ") + (err instanceof Error ? err.message : String(err))}\n`,
      );
    }
  }

  rl.close();
  if (!args.json) console.log(dim("\nbye."));
}

main().catch((err) => {
  console.error(red("✗ Fatal: "), err);
  process.exit(1);
});
