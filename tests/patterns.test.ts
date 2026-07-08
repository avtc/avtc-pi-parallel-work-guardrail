// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, test } from "vitest";
import { getCategories, matchDisruptive } from "../src/patterns.js";

describe("getCategories", () => {
  test("returns all 10 categories", () => {
    const cats = getCategories();
    expect(cats).toHaveLength(10);
    const ids = cats.map((c) => c.id);
    expect(ids).toContain("stash");
    expect(ids).toContain("checkout-restore");
    expect(ids).toContain("branch-switch");
    expect(ids).toContain("reset-hard");
    expect(ids).toContain("rebase");
    expect(ids).toContain("amend");
    expect(ids).toContain("merge");
    expect(ids).toContain("push");
    expect(ids).toContain("redirect-workaround");
    expect(ids).toContain("plumbing-restore");
  });
});

describe("matchDisruptive — stash category", () => {
  test("blocks git stash (push)", () => {
    const m = matchDisruptive("git stash", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("stash");
    expect(m.label).toBe("Stash");
    expect(m.reason).toContain("Stash");
  });

  test("blocks git stash pop", () => {
    expect(matchDisruptive("git stash pop", false)).not.toBeNull();
  });

  test("blocks git stash drop", () => {
    expect(matchDisruptive("git stash drop", false)).not.toBeNull();
  });

  test("blocks git stash clear", () => {
    expect(matchDisruptive("git stash clear", false)).not.toBeNull();
  });

  test("blocks git stash branch", () => {
    expect(matchDisruptive("git stash branch new-branch", false)).not.toBeNull();
  });

  test("allows git stash list (read-only)", () => {
    expect(matchDisruptive("git stash list", false)).toBeNull();
  });

  test("allows git stash show (read-only)", () => {
    expect(matchDisruptive("git stash show", false)).toBeNull();
  });

  test("allows git stash apply (working tree only)", () => {
    expect(matchDisruptive("git stash apply", false)).toBeNull();
  });

  test("stash is NOT relaxed in worktree", () => {
    expect(matchDisruptive("git stash", true)).not.toBeNull();
  });

  test("blocks git stash with whitespace variants", () => {
    expect(matchDisruptive("git  stash", false)).not.toBeNull();
    expect(matchDisruptive("git\tstash", false)).not.toBeNull();
  });

  test("blocks git stash with flags", () => {
    expect(matchDisruptive("git stash -u", false)).not.toBeNull();
    expect(matchDisruptive('git stash push -m "msg"', false)).not.toBeNull();
    expect(matchDisruptive("git stash -p", false)).not.toBeNull();
  });

  test("blocks git stash with global flags", () => {
    expect(matchDisruptive("git -C /some/path stash", false)).not.toBeNull();
    expect(matchDisruptive("git -c core.autocrlf=false stash", false)).not.toBeNull();
  });
});

describe("matchDisruptive — checkout-restore category", () => {
  test("blocks git checkout -- file.ts (path restore)", () => {
    const m = matchDisruptive("git checkout -- file.ts", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("checkout-restore");
    expect(m.label).toBe("Checkout/restore");
    expect(m.reason).toContain("Checkout/restore");
  });

  test("blocks git checkout --. (restore all)", () => {
    const m = matchDisruptive("git checkout -- .", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("checkout-restore");
  });

  test("blocks git checkout HEAD", () => {
    expect(matchDisruptive("git checkout HEAD -- .", false)).not.toBeNull();
  });

  test("blocks git checkout -- *", () => {
    expect(matchDisruptive("git checkout -- *", false)).not.toBeNull();
  });

  test("blocks git checkout abc123 -- file.ts", () => {
    expect(matchDisruptive("git checkout abc123 -- file.ts", false)).not.toBeNull();
  });

  test("blocks git restore", () => {
    expect(matchDisruptive("git restore .", false)).not.toBeNull();
  });

  test("blocks git restore file.ts (specific file)", () => {
    expect(matchDisruptive("git restore file.ts", false)).not.toBeNull();
  });

  test("blocks git restore --staged", () => {
    expect(matchDisruptive("git restore --staged .", false)).not.toBeNull();
  });

  test("blocks git restore --source=HEAD~1", () => {
    expect(matchDisruptive("git restore --source=HEAD~1 .", false)).not.toBeNull();
  });

  test("relaxed in worktree", () => {
    expect(matchDisruptive("git checkout -- file.ts", true)).toBeNull();
    expect(matchDisruptive("git restore .", true)).toBeNull();
  });
});

describe("matchDisruptive — branch-switch category", () => {
  test("blocks git checkout <branch>", () => {
    const m = matchDisruptive("git checkout main", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("branch-switch");
    expect(m.label).toBe("Branch switch");
    expect(m.reason).toContain("branch");
  });

  test("blocks git checkout -b (new branch)", () => {
    expect(matchDisruptive("git checkout -b feature", false)).not.toBeNull();
  });

  test("blocks git checkout -B (force new branch)", () => {
    expect(matchDisruptive("git checkout -B feature", false)).not.toBeNull();
  });

  test("blocks git switch <branch>", () => {
    expect(matchDisruptive("git switch main", false)).not.toBeNull();
  });

  test("blocks git switch - (previous branch)", () => {
    expect(matchDisruptive("git switch -", false)).not.toBeNull();
  });

  test("blocks git switch -c (new branch)", () => {
    expect(matchDisruptive("git switch -c feature", false)).not.toBeNull();
  });

  test("blocks git switch -C (force new branch)", () => {
    expect(matchDisruptive("git switch -C feature", false)).not.toBeNull();
  });

  test("relaxed in worktree", () => {
    expect(matchDisruptive("git checkout main", true)).toBeNull();
    expect(matchDisruptive("git checkout -b feature", true)).toBeNull();
    expect(matchDisruptive("git switch main", true)).toBeNull();
    expect(matchDisruptive("git switch -c feature", true)).toBeNull();
  });
});

describe("matchDisruptive — reset-hard category", () => {
  test("blocks git reset --hard", () => {
    const m = matchDisruptive("git reset --hard", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("reset-hard");
    expect(m.label).toBe("Destructive reset");
    expect(m.reason).toContain("Resets");
  });

  test("blocks git reset --hard HEAD~1", () => {
    expect(matchDisruptive("git reset --hard HEAD~1", false)).not.toBeNull();
  });

  test("blocks git reset --mixed HEAD~1", () => {
    expect(matchDisruptive("git reset --mixed HEAD~1", false)).not.toBeNull();
  });

  test("allows git reset (bare — no-op)", () => {
    expect(matchDisruptive("git reset", false)).toBeNull();
  });

  test("allows git reset HEAD (explicit HEAD)", () => {
    expect(matchDisruptive("git reset HEAD", false)).toBeNull();
  });

  test("allows git reset --mixed (bare, no ref)", () => {
    expect(matchDisruptive("git reset --mixed", false)).toBeNull();
  });

  test("blocks git reset HEAD~1 (non-HEAD ref)", () => {
    expect(matchDisruptive("git reset HEAD~1", false)).not.toBeNull();
  });

  test("NOT relaxed in worktree", () => {
    expect(matchDisruptive("git reset --hard", true)).not.toBeNull();
  });
});

describe("matchDisruptive — rebase category", () => {
  test("blocks git rebase", () => {
    const m = matchDisruptive("git rebase main", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("rebase");
    expect(m.label).toBe("Rebase");
    expect(m.reason).toContain("rewrite");
  });

  test("blocks git pull --rebase", () => {
    expect(matchDisruptive("git pull --rebase", false)).not.toBeNull();
  });

  test("allows git rebase --abort", () => {
    expect(matchDisruptive("git rebase --abort", false)).toBeNull();
  });

  test("allows git rebase --continue", () => {
    expect(matchDisruptive("git rebase --continue", false)).toBeNull();
  });

  test("allows git rebase --skip", () => {
    expect(matchDisruptive("git rebase --skip", false)).toBeNull();
  });

  test("allows git rebase --edit-todo", () => {
    expect(matchDisruptive("git rebase --edit-todo", false)).toBeNull();
  });

  test("NOT relaxed in worktree", () => {
    expect(matchDisruptive("git rebase main", true)).not.toBeNull();
  });
});

describe("matchDisruptive — amend category", () => {
  test("blocks git commit --amend", () => {
    const m = matchDisruptive("git commit --amend", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("amend");
  });

  test("allows git commit (normal)", () => {
    expect(matchDisruptive('git commit -m "fix"', false)).toBeNull();
  });

  test("relaxed in worktree", () => {
    expect(matchDisruptive("git commit --amend", true)).toBeNull();
  });
});

describe("matchDisruptive — merge category", () => {
  test("blocks git merge", () => {
    const m = matchDisruptive("git merge main", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("merge");
  });

  test("blocks git pull", () => {
    expect(matchDisruptive("git pull", false)).not.toBeNull();
  });

  test("relaxed in worktree", () => {
    expect(matchDisruptive("git merge main", true)).toBeNull();
    expect(matchDisruptive("git pull", true)).toBeNull();
  });

  test("allows git merge --abort", () => {
    expect(matchDisruptive("git merge --abort", false)).toBeNull();
  });
});

describe("matchDisruptive — push category", () => {
  test("blocks git push", () => {
    const m = matchDisruptive("git push", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("push");
    expect(m.label).toBe("Push");
    expect(m.reason).toContain("remote");
  });

  test("blocks git push origin main", () => {
    expect(matchDisruptive("git push origin main", false)).not.toBeNull();
  });

  test("NOT relaxed in worktree", () => {
    expect(matchDisruptive("git push", true)).not.toBeNull();
  });
});

describe("matchDisruptive — redirect-workaround category", () => {
  test("blocks git show HEAD:file > file (the agent bypass)", () => {
    const m = matchDisruptive("git show HEAD:file > file", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("redirect-workaround");
    expect(m.label).toBe("Redirect workaround");
    expect(m.reason).toContain("circumvents");
  });

  test("blocks git show HEAD:file >> file (append redirect)", () => {
    expect(matchDisruptive("git show HEAD:file >> file", false)).not.toBeNull();
  });

  test("blocks git show HEAD:file >file (no space)", () => {
    expect(matchDisruptive("git show HEAD:file >file", false)).not.toBeNull();
  });

  test("blocks git show HEAD:file 1> file (fd redirect)", () => {
    expect(matchDisruptive("git show HEAD:file 1> file", false)).not.toBeNull();
  });

  test("blocks git show HEAD:file 1>>file (fd append redirect, no space)", () => {
    expect(matchDisruptive("git show HEAD:file 1>>file", false)).not.toBeNull();
  });

  test("blocks git cat-file -p REF > file", () => {
    const m = matchDisruptive("git cat-file -p REF > file", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("redirect-workaround");
  });

  test("blocks git cat-file -p REF >> file", () => {
    expect(matchDisruptive("git cat-file -p REF >> file", false)).not.toBeNull();
  });

  test("blocks git show with flags and redirect", () => {
    expect(matchDisruptive("git show --format=raw HEAD:file > file", false)).not.toBeNull();
  });

  test("blocks git show 2>/dev/null 1>file (mixed redirects)", () => {
    expect(matchDisruptive("git show HEAD:file 2>/dev/null 1>file", false)).not.toBeNull();
  });

  test("blocks the actual agent bypass pattern", () => {
    expect(
      matchDisruptive(
        "git show HEAD:extensions/workflow-monitor/agent-lifecycle.ts > extensions/workflow-monitor/agent-lifecycle.ts",
        false,
      ),
    ).not.toBeNull();
  });

  test("blocks git show HEAD:file > /dev/null (redirect to devnull still blocked)", () => {
    expect(matchDisruptive("git show HEAD:file > /dev/null", false)).not.toBeNull();
  });

  test("allows git show HEAD:file (no redirect — read-only)", () => {
    expect(matchDisruptive("git show HEAD:file", false)).toBeNull();
  });

  test("allows git cat-file -p REF (no redirect — read-only)", () => {
    expect(matchDisruptive("git cat-file -p REF", false)).toBeNull();
  });

  test("allows git cat-file -t REF (no redirect — read-only type query)", () => {
    expect(matchDisruptive("git cat-file -t REF", false)).toBeNull();
  });

  test("allows git show --stat (no redirect)", () => {
    expect(matchDisruptive("git show --stat", false)).toBeNull();
  });

  test("allows git show HEAD:file 2>/dev/null (stderr redirect only)", () => {
    expect(matchDisruptive("git show HEAD:file 2>/dev/null", false)).toBeNull();
  });

  test("allows git show HEAD:file 2>&1 (stderr to stdout)", () => {
    expect(matchDisruptive("git show HEAD:file 2>&1", false)).toBeNull();
  });

  test("blocks with global flags: git -C /path show HEAD:file > file", () => {
    expect(matchDisruptive("git -C /path show HEAD:file > file", false)).not.toBeNull();
  });

  test("relaxed in worktree", () => {
    expect(matchDisruptive("git show HEAD:file > file", true)).toBeNull();
    expect(matchDisruptive("git cat-file -p REF > file", true)).toBeNull();
  });
});

describe("matchDisruptive — plumbing-restore category", () => {
  test("blocks git checkout-index -f -- file.ts", () => {
    const m = matchDisruptive("git checkout-index -f -- file.ts", false);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.categoryId).toBe("plumbing-restore");
    expect(m.label).toBe("Plumbing restore");
    expect(m.reason).toContain("plumbing");
  });

  test("blocks git checkout-index -a (restore all)", () => {
    expect(matchDisruptive("git checkout-index -a", false)).not.toBeNull();
  });

  test("blocks git read-tree --reset -u HEAD", () => {
    expect(matchDisruptive("git read-tree --reset -u HEAD", false)).not.toBeNull();
  });

  test("blocks git read-tree -u --reset HEAD (alt flag order)", () => {
    expect(matchDisruptive("git read-tree -u --reset HEAD", false)).not.toBeNull();
  });

  test("allows git read-tree HEAD (no --reset)", () => {
    expect(matchDisruptive("git read-tree HEAD", false)).toBeNull();
  });

  test("allows git read-tree --reset HEAD (no -u, index-only)", () => {
    expect(matchDisruptive("git read-tree --reset HEAD", false)).toBeNull();
  });

  test("allows git read-tree -u HEAD (no --reset, has -u)", () => {
    expect(matchDisruptive("git read-tree -u HEAD", false)).toBeNull();
  });

  test("allows git write-tree (read-only)", () => {
    expect(matchDisruptive("git write-tree", false)).toBeNull();
  });

  test("blocks with global flags: git -C /path checkout-index -a", () => {
    expect(matchDisruptive("git -C /path checkout-index -a", false)).not.toBeNull();
  });

  test("relaxed in worktree", () => {
    expect(matchDisruptive("git checkout-index -a", true)).toBeNull();
    expect(matchDisruptive("git read-tree --reset -u HEAD", true)).toBeNull();
  });

  test("blocks git checkout-index -- file.ts (no flags)", () => {
    expect(matchDisruptive("git checkout-index -- file.ts", false)).not.toBeNull();
  });

  test("blocks git checkout-index file.ts (bare filename)", () => {
    expect(matchDisruptive("git checkout-index file.ts", false)).not.toBeNull();
  });

  test("blocks with global flags: git -C /path read-tree --reset -u HEAD", () => {
    expect(matchDisruptive("git -C /path read-tree --reset -u HEAD", false)).not.toBeNull();
  });
});

describe("matchDisruptive — non-git commands", () => {
  test("allows npm install", () => {
    expect(matchDisruptive("npm install", false)).toBeNull();
  });

  test("allows ls", () => {
    expect(matchDisruptive("ls -la", false)).toBeNull();
  });

  test("allows git log (safe)", () => {
    expect(matchDisruptive("git log", false)).toBeNull();
  });

  test("allows git status", () => {
    expect(matchDisruptive("git status", false)).toBeNull();
  });

  test("allows git diff", () => {
    expect(matchDisruptive("git diff", false)).toBeNull();
  });

  test("allows git add", () => {
    expect(matchDisruptive("git add .", false)).toBeNull();
  });

  test("allows git commit (normal)", () => {
    expect(matchDisruptive('git commit -m "message"', false)).toBeNull();
  });
});

describe("matchDisruptive — matchedCommand", () => {
  test("returns the matched subcommand in result", () => {
    const m = matchDisruptive("git stash", false);
    expect((m as { matchedCommand: string }).matchedCommand).toBe("git stash");
  });
});

describe("matchDisruptive — reason suffix", () => {
  test("appends disruptive suffix to non-push categories", () => {
    const m = matchDisruptive("git stash", false);
    expect((m as { reason: string }).reason).toContain("— disruptive to parallel agents");
  });

  test("appends disruptive suffix to redirect-workaround", () => {
    const m = matchDisruptive("git show HEAD:file > file", false);
    expect((m as { reason: string }).reason).toContain("— disruptive to parallel agents");
  });

  test("does NOT append disruptive suffix to push category", () => {
    const m = matchDisruptive("git push", false);
    expect((m as { reason: string }).reason).toBe("Push affects the remote repository and all collaborators");
    expect((m as { reason: string }).reason).not.toContain("— disruptive to parallel agents");
  });
});

describe("matchDisruptive — edge cases", () => {
  test("returns null for empty string", () => {
    expect(matchDisruptive("", false)).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(matchDisruptive("   ", false)).toBeNull();
  });
});
