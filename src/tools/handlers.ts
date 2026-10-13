/**
 * Deterministic stub handlers for all 12 tools.
 * No network, no filesystem, no external keys — pure in-memory maps.
 * Mirrors the scherer-ai runTool switch but with portable domains.
 */

export type ToolResult = {
  result: unknown;
};

// In-memory file system for read_file / summarize_doc
const FILES: Record<string, string> = {
  "/tmp/notes.txt":
    "Meeting notes from 2026-08-10: Discussed Q3 roadmap and hiring.",
  "/docs/report.md":
    "# Q2 Report\nRevenue up 12% YoY. Churn down 3 points. Next: expand to EMEA.",
  "/docs/readme.md": "# Glimmer CLI\nThis is the Glimmer local demo harness.",
  "/tmp/todo.txt": "- buy milk\n- call Alice\n- book flight to SF",
  "/data/contacts.csv":
    "alice@example.com,Alice,Eng\nbob@example.com,Bob,Design",
};

const CONTACTS = [
  {
    name: "Alice Chen",
    email: "alice@example.com",
    role: "Engineering",
    team: "Platform",
  },
  {
    name: "Bob Smith",
    email: "bob@example.com",
    role: "Design",
    team: "Product",
  },
  {
    name: "Carol Lee",
    email: "carol@example.com",
    role: "Research",
    team: "AI",
  },
  {
    name: "David Kim",
    email: "david@example.com",
    role: "Engineering",
    team: "Infra",
  },
  {
    name: "Eve Torres",
    email: "eve@example.com",
    role: "Product",
    team: "Growth",
  },
];

const TRANSLATIONS: Record<string, Record<string, string>> = {
  es: { hello: "hola", "good morning": "buenos días", thanks: "gracias" },
  fr: { hello: "bonjour", "good morning": "bonjour", thanks: "merci" },
  ja: {
    hello: "こんにちは",
    "good morning": "おはようございます",
    thanks: "ありがとう",
  },
};

// Self-contained arithmetic evaluator (recursive descent). Supports
// numbers, + - * / % and ^ / **, parentheses, unary +/-, the functions
// sqrt/abs/floor/ceil/round/min/max and the constants pi/e.
// Anything outside that grammar is a parse error — never executed as code.
const CALC_FUNCTIONS: Record<string, (args: number[]) => number> = {
  sqrt: (args) => {
    if (args.length !== 1) throw new Error("sqrt expects exactly 1 argument");
    return Math.sqrt(args[0]);
  },
  abs: (args) => {
    if (args.length !== 1) throw new Error("abs expects exactly 1 argument");
    return Math.abs(args[0]);
  },
  floor: (args) => {
    if (args.length !== 1) throw new Error("floor expects exactly 1 argument");
    return Math.floor(args[0]);
  },
  ceil: (args) => {
    if (args.length !== 1) throw new Error("ceil expects exactly 1 argument");
    return Math.ceil(args[0]);
  },
  round: (args) => {
    if (args.length !== 1) throw new Error("round expects exactly 1 argument");
    return Math.round(args[0]);
  },
  min: (args) => {
    if (args.length < 1) throw new Error("min expects at least 1 argument");
    return Math.min(...args);
  },
  max: (args) => {
    if (args.length < 1) throw new Error("max expects at least 1 argument");
    return Math.max(...args);
  },
};

function safeEval(expr: string): number {
  const src = expr;
  let pos = 0;

  function fail(msg: string): never {
    throw new Error(msg);
  }

  function skipWs(): void {
    while (pos < src.length && /\s/.test(src.charAt(pos))) pos++;
  }

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      skipWs();
      const c = src.charAt(pos);
      if (c !== "+" && c !== "-") return value;
      pos++;
      const rhs = parseTerm();
      value = c === "+" ? value + rhs : value - rhs;
    }
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (;;) {
      skipWs();
      const c = src.charAt(pos);
      if (c !== "*" && c !== "/" && c !== "%") return value;
      if (c === "*" && src.charAt(pos + 1) === "*")
        fail(`Unexpected operator '**' at position ${pos}`);
      pos++;
      const rhs = parseUnary();
      if (c === "*") value *= rhs;
      else if (c === "/") value /= rhs;
      else value %= rhs;
    }
  }

  // Unary binds looser than exponent: -2^2 === -(2^2).
  function parseUnary(): number {
    skipWs();
    const c = src.charAt(pos);
    if (c === "+") {
      pos++;
      return parseUnary();
    }
    if (c === "-") {
      pos++;
      return -parseUnary();
    }
    return parsePower();
  }

  // Exponent is right-associative: 2^3^2 === 2^(3^2).
  function parsePower(): number {
    const base = parsePrimary();
    skipWs();
    let op: string | null = null;
    if (src.startsWith("**", pos)) op = "**";
    else if (src.charAt(pos) === "^") op = "^";
    if (op === null) return base;
    pos += op.length;
    return base ** parseUnary();
  }

  function parsePrimary(): number {
    skipWs();
    if (src.charAt(pos) === "(") {
      pos++;
      const value = parseExpression();
      skipWs();
      if (src.charAt(pos) !== ")") fail(`Expected ')' at position ${pos}`);
      pos++;
      return value;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(pos));
    if (num) {
      pos += num[0].length;
      return Number(num[0]);
    }
    const ident = /^[A-Za-z]+/.exec(src.slice(pos));
    if (ident) {
      const name = ident[0].toLowerCase();
      pos += ident[0].length;
      if (name === "pi") return Math.PI;
      if (name === "e") return Math.E;
      const fn = CALC_FUNCTIONS[name];
      if (!fn)
        fail(
          `Unknown identifier '${ident[0]}' at position ${pos - ident[0].length}`,
        );
      skipWs();
      if (src.charAt(pos) !== "(")
        fail(`Expected '(' after '${name}' at position ${pos}`);
      pos++;
      const args: number[] = [];
      skipWs();
      if (src.charAt(pos) !== ")") {
        for (;;) {
          args.push(parseExpression());
          skipWs();
          if (src.charAt(pos) === ",") {
            pos++;
            continue;
          }
          break;
        }
      }
      skipWs();
      if (src.charAt(pos) !== ")") fail(`Expected ')' at position ${pos}`);
      pos++;
      return fn(args);
    }
    if (pos >= src.length) fail("Unexpected end of expression");
    fail(`Unexpected character '${src.charAt(pos)}' at position ${pos}`);
  }

  const value = parseExpression();
  skipWs();
  if (pos < src.length)
    fail(`Unexpected character '${src.charAt(pos)}' at position ${pos}`);
  if (!Number.isFinite(value))
    fail("expression did not evaluate to finite number");
  return value;
}

export async function handleGetWeather(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const location = typeof input.location === "string" ? input.location : "";
  const date = typeof input.date === "string" ? input.date : "2026-08-17";
  const unit = input.unit === "f" ? "f" : "c";
  if (!location) return { result: { error: "get_weather requires location" } };
  // Deterministic stub: Seattle → rain, SF → fog, else sunny
  const loc = location.toLowerCase();
  let condition = "sunny";
  if (loc.includes("seattle")) condition = "rain";
  else if (loc.includes("san francisco") || loc === "sf") condition = "fog";
  else if (loc.includes("london")) condition = "cloudy";
  const temp = unit === "c" ? 22 : 72;
  return { result: { location, date, condition, temp, unit } };
}

export async function handleSearchCalendar(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const query = typeof input.query === "string" ? input.query : "";
  const date_from =
    typeof input.date_from === "string" ? input.date_from : "2026-08-17";
  const date_to =
    typeof input.date_to === "string" ? input.date_to : "2026-08-20";
  if (!query) return { result: { error: "search_calendar requires query" } };
  if (!date_from || !date_to)
    return {
      result: { error: "search_calendar requires date_from and date_to" },
    };
  const events = [
    {
      id: "e1",
      title: "Team Sync",
      start: `${date_from}T10:00:00Z`,
      attendees: ["alice@example.com"],
    },
    {
      id: "e2",
      title: "Trip planning",
      start: `${date_from}T14:00:00Z`,
      attendees: ["bob@example.com"],
    },
  ].filter(
    (e) =>
      e.title.toLowerCase().includes(query.toLowerCase()) ||
      query.toLowerCase().includes("meeting"),
  );
  return { result: { count: events.length, events } };
}

export async function handleBookMeeting(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const title = typeof input.title === "string" ? input.title : "";
  const start_iso = typeof input.start_iso === "string" ? input.start_iso : "";
  const duration_min =
    typeof input.duration_min === "number" ? input.duration_min : 0;
  const attendees = Array.isArray(input.attendees)
    ? (input.attendees as unknown[]).filter((x) => typeof x === "string")
    : [];
  if (!title || !start_iso || !duration_min || attendees.length === 0) {
    return {
      result: {
        error:
          "book_meeting requires title, start_iso, duration_min, attendees",
      },
    };
  }
  return {
    result: {
      meeting_id: `mtg_${Math.random().toString(36).slice(2, 8)}`,
      title,
      start_iso,
      duration_min,
      attendees,
      status: "confirmed",
    },
  };
}

export async function handleReadFile(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const filePath = typeof input.path === "string" ? input.path : "";
  if (!filePath) return { result: { error: "read_file requires path" } };
  const content = FILES[filePath];
  if (content === undefined)
    return { result: { error: `File not found: ${filePath}` } };
  return { result: { path: filePath, content } };
}

export async function handleCodeExec(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const language =
    input.language === "js"
      ? "js"
      : input.language === "python"
        ? "python"
        : "";
  const code = typeof input.code === "string" ? input.code : "";
  if (!language)
    return {
      result: { error: "code_exec requires language 'python' or 'js'" },
    };
  if (!code) return { result: { error: "code_exec requires code" } };
  // Stub: echo code with simulated stdout
  if (code.includes("print(42)") || code.includes("console.log(42)")) {
    return { result: { stdout: "42", language, code } };
  }
  if (code.includes("1/0") || code.includes("raise")) {
    return { result: { error: "execution error: division by zero", language } };
  }
  return {
    result: {
      stdout: `executed ${language} code (${code.slice(0, 40)}...)`,
      language,
    },
  };
}

export async function handleWebSearch(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const query = typeof input.query === "string" ? input.query : "";
  const count =
    typeof input.count === "number"
      ? Math.min(Math.max(input.count, 1), 10)
      : 3;
  if (!query) return { result: { error: "web_search requires query" } };
  const hits = Array.from({ length: count }, (_, i) => ({
    title: `Result ${i + 1} for ${query}`,
    url: `https://example.com/search?q=${encodeURIComponent(query)}&n=${i + 1}`,
    snippet: `Snippet about ${query} — result ${i + 1}`,
  }));
  return { result: { query, count: hits.length, hits } };
}

export async function handleSendEmail(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const to = typeof input.to === "string" ? input.to : "";
  const subject = typeof input.subject === "string" ? input.subject : "";
  const body = typeof input.body === "string" ? input.body : "";
  const cc = typeof input.cc === "string" ? input.cc : undefined;
  if (!to || !to.includes("@"))
    return { result: { error: "send_email requires valid 'to' email" } };
  if (!subject) return { result: { error: "send_email requires subject" } };
  if (!body) return { result: { error: "send_email requires body" } };
  return {
    result: {
      message_id: `msg_${Math.random().toString(36).slice(2, 8)}`,
      to,
      subject,
      body,
      ...(cc ? { cc } : {}),
      status: "sent",
    },
  };
}

export async function handleCalculate(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const expr = typeof input.expression === "string" ? input.expression : "";
  if (!expr) return { result: { error: "calculate requires expression" } };
  try {
    const value = safeEval(expr);
    return { result: { expression: expr, value } };
  } catch (err) {
    return {
      result: {
        error: err instanceof Error ? err.message : "invalid expression",
      },
    };
  }
}

export async function handleTranslate(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const text = typeof input.text === "string" ? input.text : "";
  const target =
    typeof input.target_lang === "string"
      ? input.target_lang.toLowerCase()
      : "";
  if (!text) return { result: { error: "translate_text requires text" } };
  if (!target)
    return { result: { error: "translate_text requires target_lang" } };
  const map = TRANSLATIONS[target];
  if (map) {
    const lower = text.toLowerCase();
    if (map[lower])
      return {
        result: { original: text, translated: map[lower], target_lang: target },
      };
  }
  // fallback: append target
  return {
    result: {
      original: text,
      translated: `${text} [${target}]`,
      target_lang: target,
    },
  };
}

export async function handleLookupContacts(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const query =
    typeof input.query === "string" ? input.query.toLowerCase() : "";
  const limit = typeof input.limit === "number" ? Math.min(input.limit, 20) : 5;
  if (!query) return { result: { error: "lookup_contacts requires query" } };
  const filtered = CONTACTS.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      c.email.toLowerCase().includes(query) ||
      c.role.toLowerCase().includes(query) ||
      c.team.toLowerCase().includes(query),
  ).slice(0, limit);
  return { result: { count: filtered.length, contacts: filtered } };
}

export async function handlePlanTrip(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const destination =
    typeof input.destination === "string" ? input.destination : "";
  const date_from =
    typeof input.date_from === "string" ? input.date_from : "2026-08-17";
  const date_to =
    typeof input.date_to === "string" ? input.date_to : "2026-08-20";
  if (!destination)
    return { result: { error: "plan_trip requires destination" } };
  // Compose weather + calendar stub
  const weather = await handleGetWeather({
    location: destination,
    date: date_from,
    unit: "c",
  });
  const calendar = await handleSearchCalendar({
    query: "trip",
    date_from,
    date_to,
  });
  return {
    result: {
      destination,
      date_from,
      date_to,
      weather: (weather.result as { condition?: string }).condition ?? "sunny",
      calendar: (calendar.result as { events?: unknown[] }).events ?? [],
      plan: `Trip to ${destination} from ${date_from} to ${date_to} — weather ${(weather.result as { condition?: string }).condition}, ${((calendar.result as { events?: unknown[] }).events ?? []).length} conflicting events`,
    },
  };
}

export async function handleSummarizeDoc(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const filePath = typeof input.path === "string" ? input.path : "";
  const max = typeof input.max_chars === "number" ? input.max_chars : 500;
  if (!filePath) return { result: { error: "summarize_doc requires path" } };
  const file = await handleReadFile({ path: filePath });
  const err = (file.result as { error?: string }).error;
  if (err) return { result: { error: err } };
  const content = (file.result as { content: string }).content;
  const summary = content.slice(0, max);
  return {
    result: { path: filePath, summary, truncated: content.length > max },
  };
}
