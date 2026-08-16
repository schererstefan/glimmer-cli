import { describe, expect, it } from "vitest";
import { tools as catalog } from "@/src/tools/catalog";
import { runTool, tools, validateToolInput } from "@/src/tools/registry";

describe("tool catalog", () => {
  it("exposes 12 tools", () => {
    expect(tools).toHaveLength(12);
    const names = tools.map((t) => t.name);
    for (const expected of [
      "get_weather",
      "search_calendar",
      "book_meeting",
      "read_file",
      "code_exec",
      "web_search",
      "send_email",
      "calculate",
      "translate_text",
      "lookup_contacts",
      "plan_trip",
      "summarize_doc",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("every tool has description and input_schema type object", () => {
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema.properties).toBeDefined();
    }
  });

  it("required fields are declared", () => {
    const gw = catalog.find((t) => t.name === "get_weather");
    expect(gw).toBeDefined();
    expect((gw?.input_schema as { required?: string[] })?.required).toContain(
      "location",
    );
    const bm = catalog.find((t) => t.name === "book_meeting");
    expect(bm).toBeDefined();
    expect((bm?.input_schema as { required?: string[] })?.required).toContain(
      "title",
    );
  });
});

describe("validateToolInput", () => {
  it("flags missing required fields", () => {
    expect(
      validateToolInput("get_weather", { location: "Seattle" }).valid,
    ).toBe(false);
    expect(
      validateToolInput("get_weather", {
        location: "Seattle",
        date: "2026-08-17",
      }).valid,
    ).toBe(true);
  });

  it("unknown tool is invalid", () => {
    expect(validateToolInput("nonexistent", {}).valid).toBe(false);
  });
});

describe("handlers", () => {
  it("get_weather: Seattle → rain, SF → fog", async () => {
    const seattle = await runTool("get_weather", {
      location: "Seattle",
      date: "2026-08-17",
      unit: "c",
    });
    expect((seattle.result as { condition: string }).condition).toBe("rain");
    const sf = await runTool("get_weather", {
      location: "San Francisco",
      date: "2026-08-17",
    });
    expect((sf.result as { condition: string }).condition).toBe("fog");
  });

  it("get_weather requires location", async () => {
    const r = await runTool("get_weather", { date: "2026-08-17" });
    expect((r.result as { error: string }).error).toMatch(/location/);
  });

  it("search_calendar returns events", async () => {
    const r = await runTool("search_calendar", {
      query: "meeting",
      date_from: "2026-08-17",
      date_to: "2026-08-20",
    });
    expect((r.result as { count: number }).count).toBeGreaterThan(0);
  });

  it("book_meeting validates required", async () => {
    const bad = await runTool("book_meeting", { title: "x" });
    expect((bad.result as { error: string }).error).toMatch(/requires/);
    const ok = await runTool("book_meeting", {
      title: "Team Sync",
      start_iso: "2026-08-17T10:00:00Z",
      duration_min: 30,
      attendees: ["alice@example.com"],
    });
    expect((ok.result as { meeting_id: string }).meeting_id).toMatch(/^mtg_/);
  });

  it("read_file: existing vs not found", async () => {
    const ok = await runTool("read_file", { path: "/tmp/notes.txt" });
    expect((ok.result as { content: string }).content).toContain(
      "Meeting notes",
    );
    const bad = await runTool("read_file", { path: "/nonexistent.txt" });
    expect((bad.result as { error: string }).error).toMatch(/not found/i);
  });

  it("code_exec python and js", async () => {
    const py = await runTool("code_exec", {
      language: "python",
      code: "print(42)",
    });
    expect((py.result as { stdout: string }).stdout).toBe("42");
    const js = await runTool("code_exec", {
      language: "js",
      code: "console.log(42)",
    });
    expect((js.result as { stdout: string }).stdout).toBe("42");
  });

  it("code_exec requires language", async () => {
    const r = await runTool("code_exec", { code: "print(42)" });
    expect((r.result as { error: string }).error).toMatch(/language/);
  });

  it("web_search returns hits", async () => {
    const r = await runTool("web_search", { query: "Glimmer", count: 2 });
    expect((r.result as { hits: unknown[] }).hits).toHaveLength(2);
  });

  it("send_email requires valid to", async () => {
    const bad = await runTool("send_email", {
      to: "not-an-email",
      subject: "Hi",
      body: "x",
    });
    expect((bad.result as { error: string }).error).toMatch(/valid/);
    const ok = await runTool("send_email", {
      to: "bob@example.com",
      subject: "Hi",
      body: "Hello",
    });
    expect((ok.result as { message_id: string }).message_id).toMatch(/^msg_/);
  });

  it("calculate evaluates math", async () => {
    expect(
      (await runTool("calculate", { expression: "42*19" })).result,
    ).toMatchObject({ value: 798 });
    expect(
      (await runTool("calculate", { expression: "sqrt(16)" })).result,
    ).toMatchObject({ value: 4 });
    expect(
      (await runTool("calculate", { expression: "2+2" })).result,
    ).toMatchObject({ value: 4 });
  });

  it("calculate errors on invalid", async () => {
    const r = await runTool("calculate", { expression: "" });
    expect((r.result as { error: string }).error).toBeDefined();
  });

  it("translate_text deterministic", async () => {
    const es = await runTool("translate_text", {
      text: "hello",
      target_lang: "es",
    });
    expect((es.result as { translated: string }).translated).toBe("hola");
    const fr = await runTool("translate_text", {
      text: "hello",
      target_lang: "fr",
    });
    expect((fr.result as { translated: string }).translated).toBe("bonjour");
  });

  it("lookup_contacts filters", async () => {
    const r = await runTool("lookup_contacts", { query: "Alice" });
    expect(
      (r.result as { contacts: Array<{ name: string }> }).contacts[0].name,
    ).toContain("Alice");
  });

  it("plan_trip composes weather + calendar", async () => {
    const r = await runTool("plan_trip", {
      destination: "Seattle",
      date_from: "2026-08-17",
      date_to: "2026-08-20",
    });
    expect((r.result as { destination: string }).destination).toBe("Seattle");
    expect((r.result as { plan: string }).plan).toContain("Seattle");
  });

  it("summarize_doc reads and truncates", async () => {
    const r = await runTool("summarize_doc", {
      path: "/docs/report.md",
      max_chars: 10,
    });
    expect(
      (r.result as { summary: string }).summary.length,
    ).toBeLessThanOrEqual(10);
  });

  it("summarize_doc errors on missing file", async () => {
    const r = await runTool("summarize_doc", { path: "/nope.txt" });
    expect((r.result as { error: string }).error).toMatch(/not found/i);
  });

  it("unknown tool returns error", async () => {
    const r = await runTool("unknown_tool", {});
    expect((r.result as { error: string }).error).toMatch(/Unknown tool/);
  });
});
