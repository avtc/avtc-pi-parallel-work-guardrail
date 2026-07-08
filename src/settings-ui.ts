// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * The single, canonical parallel-work-guardrail settings handle.
 *
 * Registered once here (rather than in `extension.ts`) so every module reads settings through the
 * same accessor. {@link initGuardrailSettings} is called from the extension's activate function
 * (where `pi` is available); until then the handle is `undefined`, which is fine because all reads
 * happen at runtime (after activate). Callers read {@link getGuardrailSettings}; no consumer
 * re-parses or re-normalizes the env var.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSettingsCommand, type SettingsHandle } from "avtc-pi-settings-ui";
import { GUARDRAIL_SCHEMA, GUARDRAIL_SETTINGS_ENV_VAR, type GuardrailSettings } from "./schema.js";

let handle: SettingsHandle<GuardrailSettings> | undefined;

/**
 * Test-only override for the settings read (DI/mock pattern): when set, {@link getGuardrailSettings}
 * returns this instead of the real handle. Set up in tests before the SUT runs; cleared by
 * {@link _resetGetGuardrailSettings}.
 */
let _getSettingsOverride: (() => GuardrailSettings) | null = null;

/** Test-only: inject a mock settings source (pass `null` to restore the real handle). */
export function _setGetGuardrailSettings(fn: (() => GuardrailSettings) | null): void {
  _getSettingsOverride = fn;
}

/** Test-only: clear the mock override (restore real-handle reads). */
export function _resetGetGuardrailSettings(): void {
  _getSettingsOverride = null;
}

/**
 * Register the /parallel-work-guardrail:settings command + modal and create the settings handle.
 * Must be called from the extension's activate function (needs `pi`). Loads settings immediately
 * (registration time) and on every session_start.
 */
export function initGuardrailSettings(pi: ExtensionAPI): void {
  handle = registerSettingsCommand<GuardrailSettings>(pi, GUARDRAIL_SCHEMA, {
    commandName: "parallel-work-guardrail:settings",
    title: "Parallel Work Guardrail Settings",
    titleRight: "avtc-pi-parallel-work-guardrail",
    envVar: GUARDRAIL_SETTINGS_ENV_VAR,
  });
}

/** Read the current guardrail settings (normalized by the schema). */
export function getGuardrailSettings(): GuardrailSettings {
  if (_getSettingsOverride) return _getSettingsOverride();
  if (!handle) throw new Error("guardrail settings not initialized — initGuardrailSettings not called");
  return handle.getSettings();
}
