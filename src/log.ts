// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Shared logger for avtc-pi-parallel-work-guardrail.
 *
 * Writes to ~/.pi/logs/avtc-pi-parallel-work-guardrail/<date>.log (best-effort).
 * Module-scoped children (e.g. log.child("guardrail")) add per-module tags.
 */
import { createLogger } from "avtc-pi-logger";

/** No custom logger options — use library defaults (default base dir, no debug, etc.). */
const NO_LOGGER_OPTIONS: Parameters<typeof createLogger>[1] = null;

export const log = createLogger("avtc-pi-parallel-work-guardrail", NO_LOGGER_OPTIONS);
