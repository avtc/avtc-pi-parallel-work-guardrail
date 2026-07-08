// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi } from "vitest";
import guardrailExtension, { _resetExtensionState } from "../src/extension.js";

// globalThis survives module re-import during /reload, so the idempotency guard's
// flag persists across the whole test run (isolate: false). Wipe it before every
// test so each starts in a fresh, unwired state.
type GlobalWithWiredFlag = { __avtcPiParallelWorkGuardrailWired?: boolean };
const WIRED_KEY = "__avtcPiParallelWorkGuardrailWired" as const;

function readWired(): boolean {
  return (globalThis as unknown as GlobalWithWiredFlag)[WIRED_KEY] === true;
}

// ── Mock PI ─────────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => unknown;

function createMockPi() {
  const handlers = new Map<string, Handler[]>();
  const registerCommand = vi.fn();
  const registerTool = vi.fn();
  const eventsEmit = vi.fn();
  return {
    registerCommand,
    registerTool,
    emitted: eventsEmit,
    on(event: string, handler: Handler): () => void {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    events: {
      emit: eventsEmit,
      on(): () => void {
        return () => {};
      },
    },
    fire(event: string, ...args: unknown[]): void {
      // Iterate a snapshot so a handler that unsubscribes another (or itself) during
      // dispatch does not skip later handlers — matches real emitter semantics.
      for (const h of [...(handlers.get(event) ?? [])]) h(...args);
    },
  };
}

describe("extension idempotency (reload-safe globalThis guard)", () => {
  beforeEach(() => {
    _resetExtensionState();
    delete (globalThis as unknown as GlobalWithWiredFlag)[WIRED_KEY];
  });

  test("(a) first call wires — registers settings command + event handlers", () => {
    const pi = createMockPi();
    guardrailExtension(pi as unknown as ExtensionAPI);

    // initGuardrailSettings(pi) registers the settings command on first wire.
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "parallel-work-guardrail:settings",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  test("(b) second call no-ops — fresh pi gets no wiring", () => {
    const pi1 = createMockPi();
    guardrailExtension(pi1 as unknown as ExtensionAPI);
    expect(pi1.registerCommand).toHaveBeenCalledTimes(1);

    // A second invocation with a brand-new pi must short-circuit and wire nothing.
    const pi2 = createMockPi();
    guardrailExtension(pi2 as unknown as ExtensionAPI);
    expect(pi2.registerCommand).not.toHaveBeenCalled();
    expect(pi2.emitted).not.toHaveBeenCalled();
  });

  test("(c) flag is set to true after the first wire", () => {
    const pi = createMockPi();
    expect(readWired()).toBe(false);

    guardrailExtension(pi as unknown as ExtensionAPI);
    expect(readWired()).toBe(true);
  });

  test("(d) reload-safe cycle: session_shutdown resets the flag so a re-call re-wires", () => {
    // First wire.
    const pi1 = createMockPi();
    guardrailExtension(pi1 as unknown as ExtensionAPI);
    expect(readWired()).toBe(true);

    // /reload tears down the old session → session_shutdown must reset the flag,
    // otherwise the re-evaluated module would short-circuit and leave the
    // extension dead after reload.
    pi1.fire("session_shutdown");
    expect(readWired()).toBe(false);

    // pi re-evaluates the module fresh and calls the entry with a new Extension.
    const pi2 = createMockPi();
    guardrailExtension(pi2 as unknown as ExtensionAPI);
    expect(readWired()).toBe(true);
    // Re-wired: the new pi received the settings command registration.
    expect(pi2.registerCommand).toHaveBeenCalledWith(
      "parallel-work-guardrail:settings",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });
});
