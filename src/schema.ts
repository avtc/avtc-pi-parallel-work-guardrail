// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Parallel Work Guardrail settings schema.
 *
 * Defines the one guardrail setting (parallelWorkGuardrail) using avtc-pi-settings-ui's SettingsSchema format.
 */

import { type SettingsSchema, settingsFilePaths } from "avtc-pi-settings-ui";

/** Guardrail modes.
 *  - off: skip all checks
 *  - ask: prompt user (waits indefinitely for a human response)
 *  - block: auto-block every disruptive command
 *  - ask-allow-15m: prompt user; if no response within ASK_TIMEOUT_MS, auto-allow
 *  - ask-block-15m: prompt user; if no response within ASK_TIMEOUT_MS, auto-block */
export type GuardrailMode = "off" | "ask" | "block" | "ask-allow-15m" | "ask-block-15m";

/** Ordered list of valid mode values (also drives settings UI presets). */
export const GUARDRAIL_MODE_VALUES: GuardrailMode[] = ["off", "ask", "block", "ask-allow-15m", "ask-block-15m"];

/** Human-readable labels for the preset buttons, aligned with GUARDRAIL_MODE_VALUES. */
export const GUARDRAIL_MODE_LABELS = ["Off", "Ask", "Block", "Ask + Allow after 15m", "Ask + Block after 15m"] as const;

/** Auto-resolve timeout for the ask-with-timeout modes (15 minutes). */
export const GUARDRAIL_ASK_TIMEOUT_MS = 15 * 60_000;

/** Type guard: true when `value` is one of the known guardrail modes. */
export function isGuardrailMode(value: unknown): value is GuardrailMode {
  return typeof value === "string" && (GUARDRAIL_MODE_VALUES as readonly string[]).includes(value);
}

/** The guardrail settings (shape declared here; the default lives in {@link GUARDRAIL_SCHEMA}). */
export interface GuardrailSettings {
  parallelWorkGuardrail: GuardrailMode;
}

export const GUARDRAIL_SCHEMA: SettingsSchema = {
  settings: [
    {
      id: "parallelWorkGuardrail",
      label: "Guardrail mode",
      description:
        "Controls how the guardrail responds to disruptive git operations in worktrees: off (skip all checks), ask (prompt user, waits indefinitely), block (auto-block), ask + allow/block after 15m (prompt user, auto-resolve after 15 minutes of no response)",
      type: "string",
      defaultValue: "ask",
      presets: GUARDRAIL_MODE_VALUES.map((value, i) => [GUARDRAIL_MODE_LABELS[i], value] as const),
    },
  ],
  tabs: [
    {
      label: "Guardrails",
      settingIds: ["parallelWorkGuardrail"],
    },
  ],
  ...settingsFilePaths("avtc-pi-parallel-work-guardrail"),
};

/** Env var name for cross-process settings propagation. */
export const GUARDRAIL_SETTINGS_ENV_VAR = "PI_SETTINGS_PARALLEL_WORK_GUARDRAIL";
