/**
 * Tool registry — dispatcher mirroring scherer-ai/lib/agent-tools.ts.
 * Validates required fields via catalog, then delegates to handlers.
 */

import { tools as catalog } from "./catalog";
import type { ToolResult } from "./handlers";
import {
  handleBookMeeting,
  handleCalculate,
  handleCodeExec,
  handleGetWeather,
  handleLookupContacts,
  handlePlanTrip,
  handleReadFile,
  handleSearchCalendar,
  handleSendEmail,
  handleSummarizeDoc,
  handleTranslate,
  handleWebSearch,
} from "./handlers";

export { catalog as tools };

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const validation = validateToolInput(name, input);
  if (!validation.valid) {
    if (validation.missing.some((m) => m.startsWith("unknown tool"))) {
      return { result: { error: `Unknown tool: ${name}` } };
    }
    return {
      result: { error: `${name} requires: ${validation.missing.join(", ")}` },
    };
  }
  switch (name) {
    case "get_weather":
      return handleGetWeather(input);
    case "search_calendar":
      return handleSearchCalendar(input);
    case "book_meeting":
      return handleBookMeeting(input);
    case "read_file":
      return handleReadFile(input);
    case "code_exec":
      return handleCodeExec(input);
    case "web_search":
      return handleWebSearch(input);
    case "send_email":
      return handleSendEmail(input);
    case "calculate":
      return handleCalculate(input);
    case "translate_text":
      return handleTranslate(input);
    case "lookup_contacts":
      return handleLookupContacts(input);
    case "plan_trip":
      return handlePlanTrip(input);
    case "summarize_doc":
      return handleSummarizeDoc(input);
    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}

/** Validate required fields against catalog schema (lightweight, for tests). */
export function validateToolInput(
  name: string,
  input: Record<string, unknown>,
): { valid: boolean; missing: string[] } {
  const def = catalog.find((t) => t.name === name);
  if (!def) return { valid: false, missing: [`unknown tool ${name}`] };
  const required = (def.input_schema as { required?: string[] }).required ?? [];
  const missing = required.filter(
    (k) => input[k] === undefined || input[k] === null || input[k] === "",
  );
  return { valid: missing.length === 0, missing };
}
