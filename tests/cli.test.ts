import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "@/src/cli";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("returns defaults with no args", () => {
    expect(parseArgs([])).toEqual({
      help: false,
      verbose: false,
      json: false,
      provider: "glimmer",
    });
  });

  it("parses flags, provider, model, and prompt", () => {
    const args = parseArgs([
      "--verbose",
      "--json",
      "--provider",
      "mock",
      "--model",
      "mock-glimmer-v1",
      "hello",
      "there",
    ]);
    expect(args.verbose).toBe(true);
    expect(args.json).toBe(true);
    expect(args.provider).toBe("mock");
    expect(args.model).toBe("mock-glimmer-v1");
    expect(args.prompt).toBe("hello there");
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("exits(1) on unknown flag", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => parseArgs(["--bogus"])).toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits(1) on unknown provider", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => parseArgs(["--provider", "bogus"])).toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
