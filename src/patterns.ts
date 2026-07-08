// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

/**
 * Disruptive git command pattern definitions and matching logic.
 * Each category groups related git operations that disrupt parallel work.
 */

export interface DisruptiveCategory {
  id: string;
  label: string;
  patterns: RegExp[];
  reason: string;
  relaxedInWorktree: boolean;
  /** If true, DISRUPTIVE_SUFFIX is NOT appended to reason in matchDisruptive. */
  skipSuffix?: boolean;
}

export interface DisruptiveMatch {
  categoryId: string;
  label: string;
  reason: string;
  matchedCommand: string;
}

// Git global flags that may appear between "git" and the subcommand.
// These take a value argument: -C <path>, --git-dir=<path>, --work-tree=<path>
const GIT_GLOBAL_FLAGS_RE =
  /(?:\s+(?:-[Cc]\s+\S+(?:=\S+)?|--git-dir(?:=\S+|\s+\S+)|--work-tree(?:=\S+|\s+\S+)|--no-replace-objects|--literal-pathspecs))*/;

// Helper: build regex that matches "git" + optional global flags + subcommand
function gitCmd(subcmdPattern: string): RegExp {
  return new RegExp(`^git${GIT_GLOBAL_FLAGS_RE.source}\\s+${subcmdPattern}`);
}

const DISRUPTIVE_SUFFIX = " — disruptive to parallel agents";

const CATEGORIES: DisruptiveCategory[] = [
  {
    id: "stash",
    label: "Stash",
    patterns: [
      // git stash (push) — bare "git stash" or "git stash push"
      // Exclude read-only: list, show. Exclude apply (working tree only).
      // Match "git stash" (bare), "git stash push", "git stash -u", etc.
      // Only exclude if the next word after stash is list/show/apply
      gitCmd("stash(?:\\s+push)?(?:\\s(?!list\\b|show\\b|apply\\b)|$)"),
      gitCmd("stash\\s+pop(?:\\s|$)"),
      gitCmd("stash\\s+drop(?:\\s|$)"),
      gitCmd("stash\\s+clear(?:\\s|$)"),
      gitCmd("stash\\s+branch(?:\\s|$)"),
    ],
    reason: "Stash operations share a repo-wide ref",
    relaxedInWorktree: false,
  },
  {
    id: "checkout-restore",
    label: "Checkout/restore",
    patterns: [
      // git checkout with -- anywhere (path restoration) — discards working tree changes
      gitCmd("checkout\\s+.*--"),
      // git restore — always blocks (discards working tree changes)
      gitCmd("restore\\s+"),
    ],
    reason: "Checkout/restore discards working tree changes",
    relaxedInWorktree: true,
  },
  {
    id: "branch-switch",
    label: "Branch switch",
    patterns: [
      // git checkout (all variants including -b/-B) — switches branch context
      gitCmd("checkout\\s+"),
      // git switch (all variants including -c/-C) — switches branch context
      gitCmd("switch\\s+"),
    ],
    reason: "Switching branches disrupts the current work context",
    relaxedInWorktree: true,
  },
  {
    id: "reset-hard",
    label: "Destructive reset",
    patterns: [
      // --hard always blocked
      gitCmd("reset\\s+.*--hard(?:\\s|$)"),
      // --mixed with any non-HEAD ref
      gitCmd("reset\\s+--mixed\\s+(?!HEAD(?:$|\\s))\\S+(?:\\s|$)"),
      // bare reset with non-HEAD ref
      gitCmd("reset\\s+(?!HEAD(?:$|\\s))(?!-)(?!--)(?!\\s*$)\\S+(?:\\s|$)"),
    ],
    reason: "Resets discard working tree or staging changes",
    relaxedInWorktree: false,
  },
  {
    id: "rebase",
    label: "Rebase",
    patterns: [
      // git rebase (but not --abort/--continue/--skip/--edit-todo)
      gitCmd("rebase\\s+(?!--abort|--continue|--skip|--edit-todo)"),
      gitCmd("pull\\s+.*--rebase(?:\\s|$)"),
    ],
    reason: "Rebase rewrites commit history",
    relaxedInWorktree: false,
  },
  {
    id: "amend",
    label: "Amend",
    patterns: [gitCmd("commit\\s+.*--amend(?:\\s|$)")],
    reason: "Amend rewrites the tip commit",
    relaxedInWorktree: true,
  },
  {
    id: "merge",
    label: "Merge",
    patterns: [gitCmd("merge(?!-)(?!.*--abort)(?:\\s|$)"), gitCmd("pull(?!\\s+.*--rebase)(?:\\s|$)")],
    reason: "Merge/pull changes the branch head",
    relaxedInWorktree: true,
  },
  {
    id: "push",
    label: "Push",
    patterns: [gitCmd("push(?:\\s|$)")],
    reason: "Push affects the remote repository and all collaborators",
    relaxedInWorktree: false,
    skipSuffix: true,
  },
  {
    id: "redirect-workaround",
    label: "Redirect workaround",
    patterns: [
      // git show/cat-file with stdout redirection (>, >>, 1>) — writes git object content to working tree
      // \s before > ensures we don't match 2>/dev/null or &> — only bare > >> or 1>
      gitCmd("show\\s+.*\\s(?:>>|1?>>?)"),
      gitCmd("cat-file\\s+.*\\s(?:>>|1?>>?)"),
    ],
    reason: "Redirecting git output to files circumvents checkout/restore restrictions",
    relaxedInWorktree: true,
  },
  {
    id: "plumbing-restore",
    label: "Plumbing restore",
    patterns: [
      // git checkout-index — low-level equivalent of git restore
      gitCmd("checkout-index\\s+"),
      // git read-tree with both --reset and -u (any order) — low-level equivalent of git reset --hard
      gitCmd("read-tree\\s+(?=.*--reset)(?=.*-u)"),
    ],
    reason: "Low-level git plumbing that modifies the working tree",
    relaxedInWorktree: true,
  },
];

/** Normalize a subcommand for matching: collapse whitespace, strip leading/trailing. */
function normalize(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

/**
 * Check if a single subcommand matches any disruptive pattern.
 */
export function matchDisruptive(subcommand: string, isWorktree: boolean): DisruptiveMatch | null {
  const normalized = normalize(subcommand);
  if (!normalized) return null;

  for (const category of CATEGORIES) {
    if (isWorktree && category.relaxedInWorktree) continue;
    for (const pattern of category.patterns) {
      if (pattern.test(normalized)) {
        return {
          categoryId: category.id,
          label: category.label,
          reason: category.skipSuffix ? category.reason : category.reason + DISRUPTIVE_SUFFIX,
          matchedCommand: normalized,
        };
      }
    }
  }
  return null;
}

/**
 * Get all disruptive categories (useful for testing).
 */
export function getCategories(): DisruptiveCategory[] {
  return [...CATEGORIES];
}
