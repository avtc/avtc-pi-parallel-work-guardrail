// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * GuardrailOptions — removed. Use addWhitelistCheck hook via PiGuardrailApi.
 *
 * Hook types for the parallel work guardrail.
 */

/** Whitelist check. AND semantics — all checks must return true for bypass. */
export type GuardrailWhitelistCheck = (categoryId: string) => boolean;

/** Discriminated union for guardrail results.
 *  - blocked=true: command was blocked, reason provided
 *  - blocked=false: command was allowed, optional note
 *  - null: no guardrail action (whitelist bypass) */
export type GuardrailResult = { blocked: true; reason: string } | { blocked: false; note?: string } | null;
