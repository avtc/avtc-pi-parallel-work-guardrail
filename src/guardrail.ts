// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Core guardrail check logic.
 *
 * Stateless functions that check commands for disruptive patterns
 * and handle the block/ask/whitelist decision.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SelectWithNoteOption, SelectWithNoteResult } from "avtc-pi-ui-components";
import { decomposeWithCwd, type Subcommand } from "./decompose.js";
import { isInWorktree } from "./git-utils.js";
import { showGuardrailDialog } from "./guardrail-dialog.js";
import { log } from "./log.js";
import { type DisruptiveMatch, matchDisruptive } from "./patterns.js";
import { GUARDRAIL_ASK_TIMEOUT_MS, type GuardrailMode } from "./schema.js";
import type { GuardrailResult, GuardrailWhitelistCheck } from "./types.js";

const guardrailLog = log.child("guardrail");

/** Default: non-strict matching (allow partial matches) */
const NON_STRICT_MATCH = false;

const GUARDRAIL_INSTRUCTION =
  "\n\n## Parallel work guardrail\n" +
  "Do not use git operations that disrupt parallel work on the branch. " +
  "This includes: git stash (all variants), git checkout (all variants), " +
  "git restore (all variants), git switch (all variants), " +
  "git reset --hard/--mixed, git rebase, git commit --amend, " +
  "git push, git merge, git pull. " +
  "Do NOT work around these restrictions — working tree modifications by any means risk overwriting other agents' changes. " +
  "You may only use these operations when absolutely necessary or when the user explicitly requests them. " +
  "The user will decide whether to allow or block each attempt.";

export { GUARDRAIL_INSTRUCTION };

/**
 * Check a command for disruptive patterns.
 * Uses worktree detection: if cwd is inside .worktrees/, 4 categories are relaxed.
 */
export function checkCommand(command: string, baseCwd: string): DisruptiveMatch | null {
  const subcommands: Subcommand[] = decomposeWithCwd(command, baseCwd);
  for (const sub of subcommands) {
    // Cheap pre-check first: isWorktree=false is the strictest (superset) mode — every
    // category is considered. Relaxing (isWorktree=true) only removes categories, so if
    // nothing matches here, nothing can match in worktree mode either. This avoids the
    // expensive `git rev-parse` worktree detection for ordinary commands (grep, ls, node, …)
    // that are never guarded.
    const strictMatch = matchDisruptive(sub.command, NON_STRICT_MATCH);
    if (!strictMatch) continue;

    // A disruptive pattern matched in strict mode — only now do we need the real worktree
    // status, because worktree membership relaxes some categories.
    const isWorktree = isInWorktree((sub.effectiveCwd ?? baseCwd).replace(/\\/g, "/"));
    const match = matchDisruptive(sub.command, isWorktree);
    if (match) return match;
  }
  return null;
}

/** Check if any whitelist hook allows bypassing the guardrail for this match.
 *  AND semantics: all checks must return true. Empty array = not whitelisted. */
function isWhitelistBypass(match: DisruptiveMatch, whitelistChecks: GuardrailWhitelistCheck[]): boolean {
  return whitelistChecks.length > 0 && whitelistChecks.every((fn) => fn(match.categoryId));
}

/**
 * Shared post-match handler for tool_call.
 * Returns the guardrail result indicating block/allow/whitelist-bypass.
 */
export async function handleDisruptiveMatch(
  match: DisruptiveMatch,
  command: string,
  mode: GuardrailMode,
  ctx: ExtensionCommandContext,
  source: "tool_call",
  whitelistChecks: GuardrailWhitelistCheck[],
): Promise<GuardrailResult> {
  // Whitelist bypass
  if (isWhitelistBypass(match, whitelistChecks)) {
    return null;
  }

  if (mode === "block") {
    guardrailLog.info(`[parallel-work-guardrail] Blocked ${source}: ${command}`);
    return { blocked: true, reason: match.reason };
  }

  // Ask family (ask / ask-allow-15m / ask-block-15m): show dialog.
  // defaultOption is the highlighted option AND the resolution when the user can't / doesn't
  // respond (no-UI fallback +, when timeoutMs > 0, the timeout default). ask-allow-15m makes
  // "Allow" the default; ask / ask-block-15m make "Block" the default (safe no-response outcome).
  // The two ask-with-timeout modes arm a deadline so an unattended session is not stuck on a prompt.
  const allowByDefault = mode === "ask-allow-15m";
  const options: SelectWithNoteOption[] = [
    { label: "Allow once", value: "allow" },
    { label: "Block once", value: "block" },
  ];
  const defaultOption = allowByDefault ? options[0] : options[1];
  const isTimeoutMode = mode === "ask-allow-15m" || mode === "ask-block-15m";
  // undefined = no timeout (ask: wait for the human indefinitely); GUARDRAIL_ASK_TIMEOUT_MS = auto-resolve.
  const timeoutMs: number | undefined = isTimeoutMode ? GUARDRAIL_ASK_TIMEOUT_MS : undefined;
  if (isTimeoutMode) {
    guardrailLog.info(
      `[parallel-work-guardrail] Prompting ${source} (will auto-${defaultOption.value} after ${GUARDRAIL_ASK_TIMEOUT_MS / 60_000}m with no response): ${command}`,
    );
  }

  let result: SelectWithNoteResult | null;
  try {
    result = await showGuardrailDialog(
      ctx as unknown as Parameters<typeof showGuardrailDialog>[0],
      `${match.reason}: ${match.matchedCommand}. Allow?`,
      options,
      defaultOption,
      timeoutMs,
    );
  } catch (e: unknown) {
    guardrailLog.warn(
      `[parallel-work-guardrail] Dialog error, blocking ${source}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { blocked: true, reason: match.reason };
  }

  if (!result || result.value === "block") {
    const noteSuffix = result?.note ? `\nUser note: ${result.note}` : "";
    guardrailLog.info(`[parallel-work-guardrail] Blocked ${source}${noteSuffix}: ${command}`);
    return { blocked: true, reason: match.reason + noteSuffix };
  }

  return { blocked: false, note: result.note || undefined };
}
