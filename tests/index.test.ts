// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as selectWithNoteModule from "avtc-pi-ui-components";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import guardrailExtension, { _resetExtensionState, _whitelistChecks, type PiGuardrailApi } from "../src/extension.js";
import type { GuardrailSettings } from "../src/schema.js";
import { GUARDRAIL_ASK_TIMEOUT_MS, type GuardrailMode } from "../src/schema.js";
import { _resetGetGuardrailSettings, _setGetGuardrailSettings } from "../src/settings-ui.js";
import type { MockLogger } from "./helpers/mock-logger.js";

// Mock the shared log module so log calls are spies instead of file writes.
// `child()` returns the mock itself, so all module-scoped child loggers share the same spies.
vi.mock("../src/log.js", async () => {
  const { createMockLogger } = await import("./helpers/mock-logger.js");
  return { log: createMockLogger() };
});

// Lazily import the mock logger (hoisted vi.mock means it's always the mock).
async function getMockLogger(): Promise<MockLogger> {
  const { log } = await import("../src/log.js");
  return log as unknown as MockLogger;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => unknown;

/** Find the guardrail :ready event payload, throwing if it was never emitted. */
function getReadyApi(emitted: Array<{ event: string; data: unknown }>): PiGuardrailApi {
  const ready = emitted.find((e) => e.event === "pi-parallel-work-guardrail:ready");
  if (!ready) throw new Error("pi-parallel-work-guardrail:ready was not emitted");
  return ready.data as PiGuardrailApi;
}

// ── Fake PI ────────────────────────────────────────────────────────────────────

function createFakePi() {
  const handlers = new Map<string, Handler[]>();
  return {
    handlers,
    api: {
      on(event: string, handler: Handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return () => {};
      },
      events: {
        on() {
          return () => {};
        },
      },
      registerTool() {},
      registerCommand() {},
    } as unknown as ExtensionAPI,
  };
}

function getFirstHandler(handlers: Map<string, Handler[]>, event: string): Handler {
  const list = handlers.get(event) ?? [];
  expect(list.length).toBeGreaterThan(0);
  const first = list[0];
  if (!first) throw new Error(`no handler registered for ${event}`);
  return first;
}

// ── Test helper: create extension with mode ─────────────────────────────────

function setMode(mode: GuardrailMode) {
  _setGetGuardrailSettings(() => ({ parallelWorkGuardrail: mode }) as GuardrailSettings);
}

function setupExtension(mode: GuardrailMode) {
  _whitelistChecks.length = 0;
  setMode(mode);
  const { api, handlers } = createFakePi();
  guardrailExtension(api);
  return { handlers };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("parallel-work-guardrail extension", () => {
  afterEach(async () => {
    _whitelistChecks.length = 0;
    delete process.env.PI_SETTINGS_PARALLEL_WORK_GUARDRAIL;
    _resetExtensionState();
    _resetGetGuardrailSettings();
    vi.restoreAllMocks();
    const mockLog = await getMockLogger();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockLog.debug.mockClear();
    mockLog.child.mockClear();
  });

  test("registers tool_call, tool_result, before_agent_start, and session_shutdown handlers", async () => {
    const { handlers } = setupExtension("off");
    expect(handlers.has("tool_call")).toBe(true);
    expect(handlers.has("tool_result")).toBe(true);
    expect(handlers.has("before_agent_start")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
  });

  test("off mode passes all commands through tool_call", async () => {
    const { handlers } = setupExtension("off");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toBeUndefined();
  });

  test("block mode blocks disruptive command", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("Stash") });
  });

  test("block mode allows safe command", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git status" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toBeUndefined();
  });

  test("block mode blocks redirect workaround (git show > file)", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git show HEAD:file > file" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("circumvents") });
  });

  test("block mode blocks plumbing restore (git checkout-index)", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git checkout-index -a" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("plumbing") });
  });

  test("block mode blocks compound command with redirect workaround", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git status && git show HEAD:file > out" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("circumvents") });
  });

  test("block mode blocks git read-tree --reset -u HEAD (plumbing restore)", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git read-tree --reset -u HEAD" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("plumbing") });
  });

  test("ask mode with hasUI=false blocks with reason", async () => {
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: false, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("Stash") });
  });

  test("ask mode with hasUI=true shows dialog and blocks on reject", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "block", note: "" });
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.any(String) });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ hasUI: true }),
      expect.stringContaining("Stash"),
      expect.arrayContaining([
        expect.objectContaining({ label: "Allow once", value: "allow" }),
        expect.objectContaining({ label: "Block once", value: "block" }),
      ]),
      expect.objectContaining({ value: "block", label: "Block once" }),
      "guardrail",
      undefined, // ask mode: no timeout
    );
    spy.mockRestore();
  });

  test("ask mode with hasUI=true allows on confirm", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "allow", note: "" });
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ hasUI: true }),
      expect.stringContaining("Stash"),
      expect.arrayContaining([
        expect.objectContaining({ label: "Allow once", value: "allow" }),
        expect.objectContaining({ label: "Block once", value: "block" }),
      ]),
      expect.objectContaining({ value: "block", label: "Block once" }),
      "guardrail",
      undefined, // ask mode: no timeout
    );
    spy.mockRestore();
  });

  test("ask mode with hasUI=true blocks on dialog dismiss (undefined)", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue(null);
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.any(String) });
    spy.mockRestore();
  });

  // ── ask-with-timeout modes: ask-allow-15m / ask-block-15m ──
  // These show the same dialog as 'ask' but pass a non-zero timeoutMs and a mode-specific
  // defaultOption (allow for ask-allow-15m, block for ask-block-15m) so showSelectWithNote
  // auto-resolves to that option after GUARDRAIL_ASK_TIMEOUT_MS with no human response.
  test("ask-allow-15m: dialog shown with defaultOption=allow and timeoutMs=15m", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "allow", note: "" });
    const { handlers } = setupExtension("ask-allow-15m");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    // User confirmed allow → tool_call proceeds (no block).
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ hasUI: true }),
      expect.stringContaining("Stash"),
      expect.arrayContaining([
        expect.objectContaining({ label: "Allow once", value: "allow" }),
        expect.objectContaining({ label: "Block once", value: "block" }),
      ]),
      // defaultOption = Allow once (the auto-allow resolution target).
      expect.objectContaining({ value: "allow", label: "Allow once" }),
      "guardrail",
      GUARDRAIL_ASK_TIMEOUT_MS,
    );
    spy.mockRestore();
  });

  test("ask-block-15m: dialog shown with defaultOption=block and timeoutMs=15m", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "block", note: "" });
    const { handlers } = setupExtension("ask-block-15m");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    // User confirmed block → tool_call blocked.
    expect(result).toEqual({ block: true, reason: expect.any(String) });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ hasUI: true }),
      expect.stringContaining("Stash"),
      expect.arrayContaining([
        expect.objectContaining({ label: "Allow once", value: "allow" }),
        expect.objectContaining({ label: "Block once", value: "block" }),
      ]),
      // defaultOption = Block once (the auto-block resolution target).
      expect.objectContaining({ value: "block", label: "Block once" }),
      "guardrail",
      GUARDRAIL_ASK_TIMEOUT_MS,
    );
    spy.mockRestore();
  });

  test("ask-allow-15m still injects system prompt (active, not off)", async () => {
    const { handlers } = setupExtension("ask-allow-15m");
    const handler = getFirstHandler(handlers, "before_agent_start");
    const result = await handler(
      { prompt: "test", systemPrompt: "existing prompt" },
      { hasUI: false, cwd: process.cwd() },
    );
    expect(result).toEqual({
      systemPrompt: expect.stringContaining("Parallel work guardrail"),
    });
    // Active mode must still inject the instruction (not skipped like 'off').
    expect(result).toEqual({ systemPrompt: expect.stringContaining("Do not use git operations") });
  });

  test("ask-block-15m still injects system prompt (active, not off)", async () => {
    const { handlers } = setupExtension("ask-block-15m");
    const handler = getFirstHandler(handlers, "before_agent_start");
    const result = await handler(
      { prompt: "test", systemPrompt: "existing prompt" },
      { hasUI: false, cwd: process.cwd() },
    );
    expect(result).toEqual({
      systemPrompt: expect.stringContaining("Parallel work guardrail"),
    });
    expect(result).toEqual({ systemPrompt: expect.stringContaining("Do not use git operations") });
  });

  test("ask mode passes notification params to dialog", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "block", note: "" });
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "tool_call");
    await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );

    // Verify flat params: defaultOption (blockOption) and source string
    const callArgs = spy.mock.calls[0];
    expect(callArgs[3]).toEqual({
      value: "block",
      label: "Block once",
    });
    expect(callArgs[4]).toBe("guardrail");
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  test("ask mode blocks command when dialog throws (safe failure)", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockRejectedValue(new Error("TUI error"));
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("Stash") });

    // Verify the shared logger received a warn call
    const mockLog = await getMockLogger();
    expect(mockLog.warn).toHaveBeenCalled();
    expect(mockLog.warn.mock.calls[0][0]).toContain("Dialog error");

    spy.mockRestore();
  });

  test("ignores non-bash tool calls", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "read", input: { path: "some/file.ts" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toBeUndefined();
  });

  test("decomposes compound commands", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "cd dir && git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("Stash") });
  });

  test("stash is always blocked regardless of cwd", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.any(String) });
  });

  test("ignores empty command in tool_call", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toBeUndefined();
  });

  test("ignores missing command in tool_call", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler({ toolName: "bash", input: {}, toolCallId: "1" }, { hasUI: true, cwd: process.cwd() });
    expect(result).toBeUndefined();
  });

  test("detects disruptive command in middle of compound command", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git status && git stash && echo done" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("Stash") });
  });

  test("whitelist check bypasses matching category (AND semantics)", async () => {
    const { handlers } = setupExtension("block");
    _whitelistChecks.push((categoryId) => categoryId === "stash");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toBeUndefined(); // whitelisted
  });

  test("whitelist check only bypasses matching category, not others", async () => {
    const { handlers } = setupExtension("block");
    _whitelistChecks.push((categoryId) => categoryId === "branch-switch");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.any(String) }); // stash not whitelisted
  });

  test("AND semantics: multiple whitelist checks must all return true", async () => {
    const { handlers } = setupExtension("block");
    _whitelistChecks.push(() => true); // first check passes
    _whitelistChecks.push(() => false); // second check fails
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.any(String) }); // not whitelisted — AND fails
  });

  test("empty whitelist checks means no bypass", async () => {
    // _whitelistChecks is empty (no checks registered)
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.any(String) });
  });
});

describe("parallel-work-guardrail — before_agent_start handler", () => {
  afterEach(async () => {
    _whitelistChecks.length = 0;
    delete process.env.PI_SETTINGS_PARALLEL_WORK_GUARDRAIL;
    _resetExtensionState();
    _resetGetGuardrailSettings();
    vi.restoreAllMocks();
    const mockLog = await getMockLogger();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockLog.debug.mockClear();
    mockLog.child.mockClear();
  });

  test("injects system prompt when mode is ask", async () => {
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "before_agent_start");
    const result = (await handler({ prompt: "test", systemPrompt: "existing prompt" }, {})) as { systemPrompt: string };
    expect(result).toEqual({
      systemPrompt: expect.stringContaining("Parallel work guardrail"),
    });
    expect(result.systemPrompt).toContain("Do not use git operations");
    expect(result.systemPrompt).toContain("Do NOT work around these restrictions");
    expect(result.systemPrompt).toContain("existing prompt");
  });

  test("injects system prompt when mode is block", async () => {
    const { handlers } = setupExtension("block");
    const handler = getFirstHandler(handlers, "before_agent_start");
    const result = (await handler({ prompt: "test", systemPrompt: "existing prompt" }, {})) as { systemPrompt: string };
    expect(result).toEqual({
      systemPrompt: expect.stringContaining("Parallel work guardrail"),
    });
  });

  test("does not inject when mode is off", async () => {
    const { handlers } = setupExtension("off");
    const handler = getFirstHandler(handlers, "before_agent_start");
    const result = await handler({ prompt: "test", systemPrompt: "existing prompt" }, {});
    expect(result).toBeUndefined();
  });

  test("handles null systemPrompt", async () => {
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "before_agent_start");
    const result = await handler({ prompt: "test", systemPrompt: null }, {});
    expect(result).toEqual({
      systemPrompt: expect.stringContaining("Parallel work guardrail"),
    });
  });

  test("system prompt does not contain mode name", async () => {
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "before_agent_start");
    const result = (await handler({ prompt: "test", systemPrompt: "existing prompt" }, {})) as { systemPrompt: string };
    expect(result.systemPrompt).not.toContain("(ask mode)");
    expect(result.systemPrompt).not.toContain("(block mode)");
  });
});

describe("parallel-work-guardrail — note delivery", () => {
  afterEach(async () => {
    _whitelistChecks.length = 0;
    delete process.env.PI_SETTINGS_PARALLEL_WORK_GUARDRAIL;
    _resetExtensionState();
    _resetGetGuardrailSettings();
    vi.restoreAllMocks();
    const mockLog = await getMockLogger();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockLog.debug.mockClear();
    mockLog.child.mockClear();
  });

  test("allow with note stores note for tool_result delivery", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValue({ value: "allow", note: "need this for rebase" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    const result = await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toBeUndefined();

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult = await trHandler(
      { toolName: "bash", toolCallId: "tc-1", content: [{ type: "text", text: "output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult).toEqual({
      content: [
        { type: "text", text: "[User note: need this for rebase]\n" },
        { type: "text", text: "output" },
      ],
    });
    spy.mockRestore();
  });

  test("tool_result cleans up note after delivery", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValue({ value: "allow", note: "first note" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-2" },
      { hasUI: true, cwd: process.cwd() },
    );

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult1 = await trHandler(
      { toolName: "bash", toolCallId: "tc-2", content: [{ type: "text", text: "output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult1).toEqual({
      content: [
        { type: "text", text: "[User note: first note]\n" },
        { type: "text", text: "output" },
      ],
    });

    const trResult2 = await trHandler(
      { toolName: "bash", toolCallId: "tc-2", content: [{ type: "text", text: "more output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult2).toBeUndefined();
    spy.mockRestore();
  });

  test("block with note includes note in block reason", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValue({ value: "block", note: "don't touch stash" });
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "tool_call");
    const result = await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(result).toEqual({ block: true, reason: expect.stringContaining("User note: don't touch stash") });
    spy.mockRestore();
  });

  test("tool_result ignores unmatched toolCallId", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValue({ value: "allow", note: "test" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-1" },
      { hasUI: true, cwd: process.cwd() },
    );

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult = await trHandler(
      { toolName: "bash", toolCallId: "unknown-id", content: [{ type: "text", text: "output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult).toBeUndefined();
    spy.mockRestore();
  });

  test("tool_result ignores missing toolCallId", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValue({ value: "allow", note: "test" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-1" },
      { hasUI: true, cwd: process.cwd() },
    );

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult = await trHandler(
      { toolName: "bash", content: [{ type: "text", text: "output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult).toBeUndefined();
    spy.mockRestore();
  });

  test("tool_result ignores non-bash tool", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValue({ value: "allow", note: "test" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-1" },
      { hasUI: true, cwd: process.cwd() },
    );

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult = await trHandler(
      { toolName: "read", toolCallId: "tc-1", content: [{ type: "text", text: "file content" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult).toBeUndefined();
    spy.mockRestore();
  });

  test("label uses Block once instead of Block", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "allow", note: "" });
    const { handlers } = setupExtension("ask");
    const handler = getFirstHandler(handlers, "tool_call");
    await handler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "1" },
      { hasUI: true, cwd: process.cwd() },
    );

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ label: "Block once" }),
        expect.objectContaining({ label: "Allow once" }),
      ]),
      expect.objectContaining({ value: "block", label: "Block once" }),
      "guardrail",
      undefined, // ask mode: no timeout
    );
    spy.mockRestore();
  });

  test("allow without note does not prepend to tool_result", async () => {
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "allow", note: "" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-1" },
      { hasUI: true, cwd: process.cwd() },
    );

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult = await trHandler(
      { toolName: "bash", toolCallId: "tc-1", content: [{ type: "text", text: "output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult).toBeUndefined();
    spy.mockRestore();
  });

  test("allow with note and empty content array returns note only", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValue({ value: "allow", note: "be careful" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-1" },
      { hasUI: true, cwd: process.cwd() },
    );

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult = await trHandler(
      { toolName: "bash", toolCallId: "tc-1", content: [] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult).toEqual({
      content: [{ type: "text", text: "[User note: be careful]\n" }],
    });
    spy.mockRestore();
  });

  test("multiple concurrent pending notes deliver to correct tool_results", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValueOnce({ value: "allow", note: "note for first command" })
      .mockResolvedValueOnce({ value: "allow", note: "note for second command" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-1" },
      { hasUI: true, cwd: process.cwd() },
    );
    await tcHandler(
      { toolName: "bash", input: { command: "git checkout main" }, toolCallId: "tc-2" },
      { hasUI: true, cwd: process.cwd() },
    );

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult1 = await trHandler(
      { toolName: "bash", toolCallId: "tc-1", content: [{ type: "text", text: "stash output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult1).toEqual({
      content: [
        { type: "text", text: "[User note: note for first command]\n" },
        { type: "text", text: "stash output" },
      ],
    });

    const trResult2 = await trHandler(
      { toolName: "bash", toolCallId: "tc-2", content: [{ type: "text", text: "checkout output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult2).toEqual({
      content: [
        { type: "text", text: "[User note: note for second command]\n" },
        { type: "text", text: "checkout output" },
      ],
    });
    spy.mockRestore();
  });

  test("session_shutdown clears pendingNotes", async () => {
    const spy = vi
      .spyOn(selectWithNoteModule, "showSelectWithNote")
      .mockResolvedValue({ value: "allow", note: "urgent fix" });
    const { handlers } = setupExtension("ask");
    const tcHandler = getFirstHandler(handlers, "tool_call");
    await tcHandler(
      { toolName: "bash", input: { command: "git stash" }, toolCallId: "tc-1" },
      { hasUI: true, cwd: process.cwd() },
    );

    const ssHandlers = handlers.get("session_shutdown") ?? [];
    for (const h of ssHandlers) h();

    const trHandler = getFirstHandler(handlers, "tool_result");
    const trResult = await trHandler(
      { toolName: "bash", toolCallId: "tc-1", content: [{ type: "text", text: "output" }] },
      { hasUI: true, cwd: process.cwd() },
    );
    expect(trResult).toBeUndefined();
    spy.mockRestore();
  });
});

// ── Extension lifecycle tests ────────────────────────────────────────────────

function createMockPiWithEvents() {
  const emitted: Array<{ event: string; data: unknown }> = [];
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

  return {
    events: {
      emit(event: string, data: unknown) {
        emitted.push({ event, data });
      },
      on(_channel: string, _handler: (...args: unknown[]) => unknown) {
        return () => {};
      },
    },
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    sendUserMessage: vi.fn(),
    emitted,
    handlers,
    fireSessionEvent(event: string, ...args: unknown[]) {
      // Iterate a snapshot so a handler that unsubscribes another (or itself) during
      // dispatch does not skip later handlers — matches real emitter semantics.
      const list = handlers.get(event) ?? [];
      for (const h of [...list]) h(...args);
    },
  };
}

describe("extension lifecycle", () => {
  beforeEach(() => {
    _resetExtensionState();
    _resetGetGuardrailSettings();
    _whitelistChecks.length = 0;
    delete process.env.PI_SETTINGS_PARALLEL_WORK_GUARDRAIL;
  });

  afterEach(async () => {
    _resetExtensionState();
    _resetGetGuardrailSettings();
    _whitelistChecks.length = 0;
    delete process.env.PI_SETTINGS_PARALLEL_WORK_GUARDRAIL;
    vi.restoreAllMocks();
    const mockLog = await getMockLogger();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockLog.debug.mockClear();
    mockLog.child.mockClear();
  });

  test("emits pi-parallel-work-guardrail:ready with addWhitelistCheck API on session_start", () => {
    const pi = createMockPiWithEvents();
    guardrailExtension(pi as unknown as ExtensionAPI);

    // Before session_start: no :ready emitted
    expect(pi.emitted.filter((e) => e.event === "pi-parallel-work-guardrail:ready").length).toBe(0);

    pi.fireSessionEvent("session_start", {}, { cwd: process.cwd() });

    const readyEvents = pi.emitted.filter((e) => e.event === "pi-parallel-work-guardrail:ready");
    expect(readyEvents.length).toBe(1);

    const ready = readyEvents[0];
    expect(ready).toBeDefined();
    if (!ready) return;
    const api = ready.data as PiGuardrailApi;
    expect(typeof api.addWhitelistCheck).toBe("function");
  });

  test("addWhitelistCheck pushes to _whitelistChecks array", () => {
    const pi = createMockPiWithEvents();
    guardrailExtension(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", {}, { cwd: process.cwd() });

    const api = getReadyApi(pi.emitted);
    const check = vi.fn();
    api.addWhitelistCheck(check);
    expect(_whitelistChecks).toContain(check);
  });

  test("registers /parallel-work-guardrail:settings command", () => {
    const pi = createMockPiWithEvents();
    guardrailExtension(pi as unknown as ExtensionAPI);

    expect(pi.registerCommand).toHaveBeenCalledWith(
      "parallel-work-guardrail:settings",
      expect.objectContaining({
        description: expect.any(String),
      }),
    );
  });

  test("caches API on globalThis for reload survival", () => {
    const pi = createMockPiWithEvents();
    guardrailExtension(pi as unknown as ExtensionAPI);

    const state = (globalThis as unknown as { __piGuardrailExtState?: { cachedApi: PiGuardrailApi | null } })
      .__piGuardrailExtState;
    expect(state).toBeDefined();
    expect(state).toHaveProperty("cachedApi");
    expect(state).toHaveProperty("cachedApi.addWhitelistCheck");
  });

  test("clears hook arrays on session_start before re-emitting :ready", () => {
    const pi = createMockPiWithEvents();
    guardrailExtension(pi as unknown as ExtensionAPI);
    pi.fireSessionEvent("session_start", {}, { cwd: process.cwd() });

    // Register hooks
    const api = getReadyApi(pi.emitted);
    api.addWhitelistCheck(vi.fn());
    expect(_whitelistChecks.length).toBe(1);

    // Simulate reload: /reload tears down the old session (session_shutdown resets the
    // idempotency guard so the re-evaluated module re-wires), then a new factory +
    // session_start clears arrays.
    pi.fireSessionEvent("session_shutdown");
    const pi2 = createMockPiWithEvents();
    guardrailExtension(pi2 as unknown as ExtensionAPI);
    expect(_whitelistChecks.length).toBe(1); // not yet cleared

    pi2.fireSessionEvent("session_start", {}, { cwd: process.cwd() });
    expect(_whitelistChecks.length).toBe(0);
  });

  test("session_shutdown cleans up state", () => {
    const pi = createMockPiWithEvents();
    guardrailExtension(pi as unknown as ExtensionAPI);

    expect(
      (globalThis as unknown as { __piGuardrailExtState?: { cachedApi: PiGuardrailApi | null } }).__piGuardrailExtState
        ?.cachedApi,
    ).toBeDefined();

    pi.fireSessionEvent("session_shutdown");

    expect(
      (globalThis as unknown as { __piGuardrailExtState?: { cachedApi: PiGuardrailApi | null } }).__piGuardrailExtState
        ?.cachedApi,
    ).toBeNull();
  });
});
