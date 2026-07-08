// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Pi-parallel-work-guardrail standalone extension entry point.
 *
 * Loaded by pi directly from package.json "pi" section.
 * Emits `pi-parallel-work-guardrail:ready` event with API object for host configuration.
 * Follows the pi.events service locator pattern (same as pi-todo, pi-subagent-ui-bridge).
 *
 * Lifecycle:
 * 1. pi loads this extension → extension.ts runs
 * 2. Initializes own settings from avtc-pi-settings-ui
 * 3. Registers event handlers (tool_call, before_agent_start, tool_result, session_shutdown)
 * 4. Creates API object { addWhitelistCheck } for host configuration
 * 5. Caches API on globalThis for reload survival
 * 6. Always defers pi-parallel-work-guardrail:ready to session_start
 *    (ensures all consumers have registered listeners before :ready fires)
 * 7. Host subscribes to 'pi-parallel-work-guardrail:ready' and calls addWhitelistCheck
 */

import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ToolCallEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { checkCommand, GUARDRAIL_INSTRUCTION, handleDisruptiveMatch } from "./guardrail.js";
import { type GuardrailMode, isGuardrailMode } from "./schema.js";
import { getGuardrailSettings, initGuardrailSettings } from "./settings-ui.js";
import type { GuardrailWhitelistCheck } from "./types.js";

// ---------------------------------------------------------------------------
// Idempotency guard — reload-safe globalThis wiring flag
// ---------------------------------------------------------------------------

/** globalThis key marking this extension as already wired in the current session.
 *  Prevents double-wiring when the package is bundled into the avtc-pi umbrella
 *  AND installed standalone (both entry paths resolve to this module). */
const WIRED_KEY = "__avtcPiParallelWorkGuardrailWired";
type GlobalWithWired = typeof globalThis & { [WIRED_KEY]?: boolean };

// ---------------------------------------------------------------------------
// Hook arrays — multi-consumer storage
// ---------------------------------------------------------------------------

export const _whitelistChecks: GuardrailWhitelistCheck[] = [];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Get guardrail mode from own settings. */
function getMode(): GuardrailMode {
  const raw = getGuardrailSettings().parallelWorkGuardrail;
  return isGuardrailMode(raw) ? raw : "ask";
}

// ---------------------------------------------------------------------------
// Extension API
// ---------------------------------------------------------------------------

/** API object exposed to host extensions via pi.events.
 *  Hosts use addWhitelistCheck to register hooks independently. */
export interface PiGuardrailApi {
  addWhitelistCheck(fn: GuardrailWhitelistCheck): void;
}

/** globalThis survives module re-import during /reload. */
const _gt = globalThis as {
  __piGuardrailExtState?: {
    cachedApi: PiGuardrailApi | null;
    unsubs: Array<() => void>;
  };
};

if (!_gt.__piGuardrailExtState) {
  _gt.__piGuardrailExtState = {
    cachedApi: null,
    unsubs: [],
  };
}
const _state = _gt.__piGuardrailExtState;

/** Reset module state — called on test cleanup. */
export function _resetExtensionState(): void {
  for (const unsub of _state.unsubs) unsub();
  _state.unsubs.length = 0;
  _state.cachedApi = null;
  _whitelistChecks.length = 0;
  // Clear the idempotency guard so each test starts in a fresh, unwired state
  // (globalThis persists across tests under isolate:false).
  delete (globalThis as GlobalWithWired)[WIRED_KEY];
}

/** Register an event handler on pi, returning an unsubscribe function. */
function safeOn<TEvent, TCtx = unknown>(
  pi: ExtensionAPI,
  event: string,
  handler: (event: TEvent, ctx: TCtx) => unknown,
): () => void {
  // ExtensionAPI.on is overloaded; cast to a single-signature view to accept our typed handler.
  const on = (
    pi as unknown as {
      on(event: string, handler: (event: TEvent, ctx: TCtx) => unknown): unknown;
    }
  ).on;
  const unsub = on(event, handler);
  return typeof unsub === "function" ? (unsub as () => void) : () => {};
}

export default function guardrailExtension(pi: ExtensionAPI): void {
  // Idempotency guard: this module can be evaluated twice when bundled into the
  // avtc-pi umbrella AND installed standalone, and pi re-evaluates it fresh on
  // /reload (jiti moduleCache:false). globalThis persists across re-evaluations,
  // so a single flag ensures the entry wires exactly once per session. The flag
  // is reset on session_shutdown (below) so the next /reload re-wires cleanly —
  // an un-reset guard would short-circuit re-wiring and leave the extension dead.
  const g = globalThis as GlobalWithWired;
  if (g[WIRED_KEY]) return;
  g[WIRED_KEY] = true;

  // Clean up previous listeners on reload
  for (const unsub of _state.unsubs) unsub();
  _state.unsubs.length = 0;

  // Initialize settings (registers /parallel-work-guardrail:settings + modal; loads at
  // registration + every session_start).
  initGuardrailSettings(pi);

  // Notes awaiting delivery to tool_result (keyed by toolCallId)
  const pendingNotes = new Map<string, string>();

  // --- before_agent_start: inject system prompt ---
  _state.unsubs.push(
    safeOn(pi, "before_agent_start", async (event: BeforeAgentStartEvent) => {
      if (getMode() === "off") return;

      return { systemPrompt: (event.systemPrompt ?? "") + GUARDRAIL_INSTRUCTION };
    }),
  );

  // --- tool_call: intercept bash commands ---
  _state.unsubs.push(
    safeOn(pi, "tool_call", async (event: ToolCallEvent, ctx: ExtensionCommandContext) => {
      if (event.toolName !== "bash") return;

      const mode = getMode();
      if (mode === "off") return;

      const command = ((event.input as Record<string, unknown>).command as string | undefined) ?? "";
      if (!command) return;

      const match = checkCommand(command, ctx.cwd);
      if (!match) return;

      const result = await handleDisruptiveMatch(match, command, mode, ctx, "tool_call", _whitelistChecks);
      if (result?.blocked) return { block: true, reason: result.reason };
      if (result?.note) pendingNotes.set(event.toolCallId, result.note);
    }),
  );

  // --- tool_result: deliver user notes for allowed commands ---
  _state.unsubs.push(
    safeOn(pi, "tool_result", async (event: ToolResultEvent) => {
      if (event.toolName !== "bash") return;
      const note = pendingNotes.get(event.toolCallId);
      if (!note) return;
      pendingNotes.delete(event.toolCallId);

      return {
        content: [{ type: "text", text: `[User note: ${note}]\n` }, ...event.content],
      };
    }),
  );

  // Build the API object with add* methods
  const api: PiGuardrailApi = {
    addWhitelistCheck(fn: GuardrailWhitelistCheck): void {
      _whitelistChecks.push(fn);
    },
  };

  // Cache API for reload survival
  _state.cachedApi = api;

  // Always defer :ready to session_start — ensures all consumers have registered listeners.
  // Clear hook arrays unconditionally (no-op on first load, clears stale hooks on reload).
  _state.unsubs.push(
    safeOn(pi, "session_start", () => {
      _whitelistChecks.length = 0;
      pi.events.emit("pi-parallel-work-guardrail:ready", api);
    }),
  );

  // Cleanup on session shutdown: clear shared state AND unsubscribe this session's
  // own handlers (tool_call, before_agent_start, session_start, etc.).
  // pi tears down the old extension runner on reload, but unsubscribing explicitly is
  // defense-in-depth and keeps _state.unsubs from accumulating stale entries.
  _state.unsubs.push(
    safeOn(pi, "session_shutdown", () => {
      _state.cachedApi = null;
      pendingNotes.clear();
      for (const unsub of _state.unsubs) {
        if (typeof unsub === "function") unsub();
      }
      _state.unsubs.length = 0;
    }),
  );

  // Reset the idempotency guard on shutdown so the next /reload re-wires the
  // freshly-evaluated module (globalThis persists, but the new Extension is empty).
  pi.on("session_shutdown", () => {
    g[WIRED_KEY] = false;
  });
}

export { decompose, decomposeWithCwd, type Subcommand } from "./decompose.js";
export { isInWorktree } from "./git-utils.js";
export { checkCommand, GUARDRAIL_INSTRUCTION } from "./guardrail.js";
export { type DisruptiveCategory, type DisruptiveMatch, getCategories, matchDisruptive } from "./patterns.js";
// Re-export types and modules for consumer access
export type { GuardrailResult, GuardrailWhitelistCheck } from "./types.js";
