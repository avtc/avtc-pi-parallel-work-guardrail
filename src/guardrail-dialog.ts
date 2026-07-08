// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Guardrail dialog helper.
 *
 * Delegates to avtc-pi-ui-components' select-with-note, which handles:
 * - UI bridge forwarding (subagent → root session)
 * - Notification attention (when pi-notification is installed)
 * - Timeout auto-resolve to defaultOption (for the ask-with-timeout modes)
 *
 * avtc-pi-ui-components is a standalone extension loaded by pi — no extra wiring needed.
 *
 * The ask-with-timeout modes (ask-allow-15m / ask-block-15m) need the dialog to
 * auto-resolve after a deadline so an unattended session is not stuck on a prompt.
 * select-with-note implements this directly: when timeoutMs > 0, the dialog resolves
 * with defaultOption after timeoutMs. This helper just selects defaultOption per mode
 * (allow for ask-allow-15m, block otherwise) and forwards timeoutMs.
 */

import type { SelectWithNoteOption, SelectWithNoteResult } from "avtc-pi-ui-components";
import { showSelectWithNote } from "avtc-pi-ui-components";

/** ctx shape required by showSelectWithNote (sourced from its own signature to avoid cross-package ExtensionUIContext mismatch). */
type GuardrailDialogCtx = Parameters<typeof showSelectWithNote>[0];

/**
 * Show the guardrail dialog with notification.
 * Handles local UI or subagent forwarding automatically.
 *
 * @param defaultOption - option to highlight AND to resolve with when the user can't / doesn't
 * respond (no-UI fallback and, when timeoutMs > 0, the timeout default). ask-allow-15m passes
 * "Allow once" here; ask / ask-block-15m pass "Block once".
 * @param timeoutMs - when defined and > 0, auto-resolve the local dialog with defaultOption after this many ms;
 * undefined = wait for the human indefinitely
 */
export async function showGuardrailDialog(
  ctx: GuardrailDialogCtx,
  title: string,
  options: SelectWithNoteOption[],
  defaultOption: SelectWithNoteOption,
  timeoutMs: number | undefined,
): Promise<SelectWithNoteResult | null> {
  return showSelectWithNote(ctx, title, options, defaultOption, "guardrail", timeoutMs);
}
