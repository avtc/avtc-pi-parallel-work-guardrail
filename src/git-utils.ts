// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Git utility for worktree detection.
 *
 * Detects whether the current working directory is inside a git worktree
 * created by workflow-monitor (living at {repoRoot}/.worktrees/{slug}).
 */

import { type ExecSyncOptionsWithStringEncoding, execSync as realExecSync } from "node:child_process";

/**
 * Check if cwd is a git worktree created by workflow-monitor.
 *
 * Design: git worktrees live at {repoRoot}/.worktrees/{slug}.
 * Detection: resolve repo root via `git rev-parse --show-toplevel`,
 * then check if cwd starts with {repoRoot}/.worktrees/.
 * This ensures .worktrees/ in OTHER repos are not false positives.
 */
export function isInWorktree(cwd: string): boolean {
  return isInWorktreeWithExec(cwd, realExecSync);
}

/**
 * Injectable version for testing — accepts a custom exec function.
 */
export function isInWorktreeWithExec(
  cwd: string,
  execSync: (cmd: string, opts: ExecSyncOptionsWithStringEncoding) => string,
): boolean {
  try {
    // stdio: stderr is piped (not inherited) so a non-git cwd does not leak
    // "fatal: not a git repository" to the parent console.
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedRoot = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalizedCwd.startsWith(`${normalizedRoot}/.worktrees/`);
  } catch {
    return false;
  }
}
