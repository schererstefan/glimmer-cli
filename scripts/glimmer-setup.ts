#!/usr/bin/env tsx
/**
 * Glimmer setup — checks Ollama, pulls model, verifies, smoke test.
 * Falls back to llama3.1:8b when Glimmer weights are not yet public (404).
 */

function color(s: string, code: number): string {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
const dim = (s: string) => color(s, 2);
const bold = (s: string) => color(s, 1);
const green = (s: string) => color(s, 32);
const yellow = (s: string) => color(s, 33);
const red = (s: string) => color(s, 31);
const _cyan = (s: string) => color(s, 36);

const OLLAMA_HOST = (
  process.env.OLLAMA_HOST ?? "http://localhost:11434"
).replace(/\/$/, "");
const GLIMMER_MODEL = process.env.GLIMMER_MODEL ?? "muse-glimmer";
const FALLBACK_MODEL = process.env.FALLBACK_MODEL ?? "llama3.1:8b";

async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

async function pullModel(
  model: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `${res.status}: ${txt.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function smokeChat(model: string): Promise<boolean> {
  try {
    const { OllamaProvider } = await import("@/src/providers/ollama");
    const { runLoop } = await import("@/src/agent/loop");
    const provider = new OllamaProvider({ model });
    const result = await runLoop({
      provider,
      messages: [{ role: "user", content: "Hello; what tools do you have?" }],
    });
    return result.text.length > 0 || result.toolCalls.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(bold("\nGlimmer setup"));
  console.log(dim(`  host: ${OLLAMA_HOST}`));
  console.log(dim(`  target: ${GLIMMER_MODEL}`));
  console.log(dim(`  fallback: ${FALLBACK_MODEL}`));
  if (dryRun) console.log(yellow("  (dry-run — no pull)"));
  console.log("");

  // 1. Check ollama binary
  const { execSync } = await import("node:child_process");
  let hasOllama = false;
  try {
    execSync("which ollama", { stdio: "ignore" });
    hasOllama = true;
  } catch {
    hasOllama = false;
  }

  if (!hasOllama) {
    console.log(yellow("  ○ ollama not found"));
    console.log(dim("    Install: brew install ollama"));
    console.log(dim("    Then: ollama serve &"));
    if (!dryRun) {
      console.log(
        red(
          "\n  ✗ Ollama is required. Install it and re-run: pnpm glimmer:setup",
        ),
      );
      console.log(
        dim(
          `  Fallback for CI: use MockProvider via pnpm cli --provider mock "hello"`,
        ),
      );
      process.exit(0);
    }
  } else {
    console.log(green("  ✓ ollama binary found"));
  }

  // 2. Check server
  const up = await checkOllama();
  if (!up) {
    console.log(yellow(`  ○ ollama server not reachable at ${OLLAMA_HOST}`));
    console.log(dim("    Try: ollama serve &  or  brew services start ollama"));
    if (dryRun) {
      console.log(dim("\n  Dry-run complete — no server, no pull."));
      return;
    }
    console.log(red("\n  ✗ Server not up. Start it and re-run."));
    process.exit(0);
  }
  console.log(green(`  ✓ ollama server up at ${OLLAMA_HOST}`));

  const existing = await listModels();
  if (existing.length > 0) {
    console.log(dim(`  models: ${existing.join(", ")}`));
  }

  // 3. Try Glimmer pull (unless dry-run)
  if (dryRun) {
    console.log(dim(`\n  Dry-run: would pull ${GLIMMER_MODEL}`));
    console.log(
      dim(
        `  If Glimmer is private (404), would fall back to ${FALLBACK_MODEL}`,
      ),
    );
    const hasGlimmer = existing.some((m) => m.includes("glimmer"));
    if (hasGlimmer) console.log(green(`  ✓ glimmer model already present`));
    else
      console.log(
        yellow(`  ○ glimmer not in local tags (expected — weights are gated)`),
      );
    console.log(dim("\n  Dry-run complete."));
    return;
  }

  // Real pull path
  if (
    existing.includes(GLIMMER_MODEL) ||
    existing.some((m) => m.startsWith(GLIMMER_MODEL.split(":")[0]))
  ) {
    console.log(green(`  ✓ ${GLIMMER_MODEL} already pulled`));
  } else {
    console.log(dim(`  pulling ${GLIMMER_MODEL} ...`));
    const res = await pullModel(GLIMMER_MODEL);
    if (!res.ok) {
      console.log(yellow(`  ○ glimmer pull failed: ${res.error}`));
      console.log(
        dim(
          `    This is expected if Glimmer is private. Falling back to ${FALLBACK_MODEL}`,
        ),
      );
      const fb = await pullModel(FALLBACK_MODEL);
      if (!fb.ok) {
        console.log(red(`  ✗ fallback pull also failed: ${fb.error}`));
        process.exit(1);
      }
      console.log(green(`  ✓ fallback ${FALLBACK_MODEL} ready`));
      console.log(
        dim(
          `\n  Set GLIMMER_MODEL=${FALLBACK_MODEL} for now, or use MockProvider:`,
        ),
      );
      console.log(dim(`    pnpm cli --provider mock "hello"`));
      return;
    }
    console.log(green(`  ✓ ${GLIMMER_MODEL} pulled`));
  }

  // 4. Smoke
  const modelToTest = existing.includes(GLIMMER_MODEL)
    ? GLIMMER_MODEL
    : FALLBACK_MODEL;
  console.log(dim(`  smoke chat with ${modelToTest} ...`));
  const ok = await smokeChat(modelToTest);
  if (ok) console.log(green("  ✓ smoke chat succeeded"));
  else
    console.log(
      yellow("  ○ smoke chat no response (model may still be loading)"),
    );

  console.log(
    bold("\nDone.") +
      dim(`  Try: pnpm cli --provider glimmer "What tools do you have?"`),
  );
}

main().catch((err) => {
  console.error(red("✗ Fatal: "), err);
  process.exit(1);
});
