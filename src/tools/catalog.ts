/**
 * Tool catalog — 12 imaginative tools tailored to stress tool-use.
 * Patterns mirror lib/agent-tools.ts (input_schema with type:object) but domains are generic.
 */

import type { ToolDefinition } from "@/src/providers/types";

export const tools: ToolDefinition[] = [
  {
    name: "get_weather",
    description:
      "Get weather forecast for a location on a date. Use for any weather, forecast, or conditions question.",
    input_schema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City or location name, e.g. 'San Francisco', 'Seattle'",
        },
        date: {
          type: "string",
          description:
            "Date in ISO 8601 (YYYY-MM-DD) or natural language like 'tomorrow', '2026-08-17'",
        },
        unit: {
          type: "string",
          description: "Temperature unit: 'c' for Celsius, 'f' for Fahrenheit",
          enum: ["c", "f"],
        },
      },
      required: ["location", "date"],
    },
  },
  {
    name: "search_calendar",
    description:
      "Search calendar events by query and date range. Returns matching events with title, time, and attendees.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords, e.g. 'meeting', 'dentist', 'trip'",
        },
        date_from: {
          type: "string",
          description: "Start date ISO 8601 (YYYY-MM-DD)",
        },
        date_to: {
          type: "string",
          description: "End date ISO 8601 (YYYY-MM-DD)",
        },
        attendee: {
          type: "string",
          description: "Optional attendee filter (name or email)",
        },
      },
      required: ["query", "date_from", "date_to"],
    },
  },
  {
    name: "book_meeting",
    description:
      "Book a new meeting. Creates an event and returns a meeting_id. Requires all fields.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Meeting title" },
        start_iso: {
          type: "string",
          description:
            "Start time ISO 8601 datetime, e.g. '2026-08-17T10:00:00Z'",
        },
        duration_min: {
          type: "number",
          description: "Duration in minutes (15, 30, 60...)",
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Attendee emails or names",
        },
      },
      required: ["title", "start_iso", "duration_min", "attendees"],
    },
  },
  {
    name: "read_file",
    description:
      "Read a file from the stubbed in-memory filesystem. Returns content or error if not found.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path, e.g. '/tmp/notes.txt', '/docs/report.md'",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "code_exec",
    description:
      "Execute a code snippet in a sandbox. Supports python and js. Returns stdout or error.",
    input_schema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "Language: 'python' or 'js'",
          enum: ["python", "js"],
        },
        code: { type: "string", description: "Code to execute" },
        timeout_ms: {
          type: "number",
          description: "Timeout in ms, default 5000",
        },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web for a query. Returns top hits with title, url, snippet.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: {
          type: "number",
          description: "Number of results, 1-10, default 3",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email. Requires recipient, subject, body. Returns message_id. Refuses if 'to' is missing/invalid.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" },
        cc: { type: "string", description: "Optional CC address" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "calculate",
    description:
      "Evaluate a mathematical expression. Returns numeric result. Use instead of hallucinating math.",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "Expression to evaluate, e.g. '42*19', '(2+3)/7', 'sqrt(16)'",
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "translate_text",
    description:
      "Translate text to a target language. Returns translated text.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to translate" },
        target_lang: {
          type: "string",
          description: "Target language code, e.g. 'es', 'fr', 'ja'",
        },
      },
      required: ["text", "target_lang"],
    },
  },
  {
    name: "lookup_contacts",
    description:
      "Search contacts directory. Returns matching contacts with name, email, role.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term for name, team, or role",
        },
        limit: { type: "number", description: "Max results, default 5" },
      },
      required: ["query"],
    },
  },
  // Two composites for multi-turn / parallel edges
  {
    name: "plan_trip",
    description:
      "Plan a trip for a destination and dates. Internally checks weather and calendar. Use only when user asks to plan a trip.",
    input_schema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Destination city" },
        date_from: { type: "string", description: "Start date ISO 8601" },
        date_to: { type: "string", description: "End date ISO 8601" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Optional companions",
        },
      },
      required: ["destination", "date_from", "date_to"],
    },
  },
  {
    name: "summarize_doc",
    description:
      "Summarize a document by path. Reads the file then produces a summary. Use for doc summary requests.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Document path to summarize" },
        max_chars: {
          type: "number",
          description: "Max summary length, default 500",
        },
      },
      required: ["path"],
    },
  },
];
