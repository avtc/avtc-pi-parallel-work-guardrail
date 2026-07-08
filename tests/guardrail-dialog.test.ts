// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Tests for guardrail-dialog (Option A: thin pass-through to showSelectWithNote).
 *
 * The ask-with-timeout modes (ask-allow-15m / ask-block-15m) are implemented by
 * showSelectWithNote itself (timeout auto-resolve to defaultOption), tested in
 * avtc-pi-ui-components. So this file only verifies the pass-through contract:
 *  - title / options / defaultOption forwarded unchanged,
 *  - timeoutMs forwarded verbatim (undefined = no timeout),
 *  - source="guardrail" forwarded (for notification attention routing),
 *  - the return value (including null) is propagated unchanged.
 */

import type { SelectWithNoteOption, SelectWithNoteResult } from "avtc-pi-ui-components";
import { afterEach, describe, expect, test, vi } from "vitest";
import { showGuardrailDialog } from "../src/guardrail-dialog.js";

const OPTIONS: SelectWithNoteOption[] = [
  { label: "Allow once", value: "allow" },
  { label: "Block once", value: "block" },
];

const TITLE = "Stash: git stash. Allow?";

describe("showGuardrailDialog — pass-through contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("forwards title, options, defaultOption, source=guardrail, and timeoutMs (undefined = no timeout)", async () => {
    const selectWithNoteModule = await import("avtc-pi-ui-components");
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "allow", note: "" });

    const ctx = { hasUI: true } as Parameters<typeof showGuardrailDialog>[0];
    // ask mode: undefined = no timeout (wait for the human indefinitely).
    await showGuardrailDialog(ctx, TITLE, OPTIONS, OPTIONS[0], undefined);

    expect(spy).toHaveBeenCalledOnce();
    const [passedCtx, passedTitle, passedOptions, passedDefaultOption, passedSource, passedTimeoutMs] =
      spy.mock.calls[0];
    expect(passedCtx).toBe(ctx);
    expect(passedTitle).toBe(TITLE);
    expect(passedOptions).toBe(OPTIONS);
    expect(passedDefaultOption).toBe(OPTIONS[0]);
    expect(passedSource).toBe("guardrail");
    expect(passedTimeoutMs).toBeUndefined();
  });

  test("forwards a non-zero timeoutMs verbatim (ask-with-timeout modes)", async () => {
    const selectWithNoteModule = await import("avtc-pi-ui-components");
    const spy = vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue({ value: "block", note: "" });

    const ctx = { hasUI: true } as Parameters<typeof showGuardrailDialog>[0];
    await showGuardrailDialog(ctx, TITLE, OPTIONS, OPTIONS[1], 15 * 60_000);

    const [, , , passedDefaultOption, , passedTimeoutMs] = spy.mock.calls[0];
    // ask-block-15m style: block is the default + the timeout resolution.
    expect(passedDefaultOption).toBe(OPTIONS[1]);
    expect(passedTimeoutMs).toBe(15 * 60_000);
  });

  test("propagates the underlying result unchanged (allow)", async () => {
    const selectWithNoteModule = await import("avtc-pi-ui-components");
    const expected: SelectWithNoteResult = { value: "allow", note: "go ahead" };
    vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue(expected);

    const ctx = { hasUI: true } as Parameters<typeof showGuardrailDialog>[0];
    const result = await showGuardrailDialog(ctx, TITLE, OPTIONS, OPTIONS[0], undefined);
    expect(result).toBe(expected);
  });

  test("propagates null unchanged (user cancelled / no-UI fallback)", async () => {
    const selectWithNoteModule = await import("avtc-pi-ui-components");
    vi.spyOn(selectWithNoteModule, "showSelectWithNote").mockResolvedValue(null);

    const ctx = { hasUI: false } as Parameters<typeof showGuardrailDialog>[0];
    const result = await showGuardrailDialog(ctx, TITLE, OPTIONS, OPTIONS[1], undefined);
    expect(result).toBeNull();
  });
});
