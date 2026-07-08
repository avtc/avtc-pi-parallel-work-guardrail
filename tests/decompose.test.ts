// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 avtc <tarasenkov@gmail.com>

import { describe, expect, test } from "vitest";
import { decompose, decomposeWithCwd, extractCdTarget } from "../src/decompose.js";

describe("decompose", () => {
  test("simple command returns single-element array", () => {
    expect(decompose("git stash")).toEqual(["git stash"]);
  });

  test("splits on &&", () => {
    expect(decompose("cd dir && git stash")).toEqual(["cd dir", "git stash"]);
  });

  test("splits on ||", () => {
    expect(decompose("git stash || echo fail")).toEqual(["git stash", "echo fail"]);
  });

  test("splits on", () => {
    expect(decompose("git stash; git pull")).toEqual(["git stash", "git pull"]);
  });

  test("splits on |", () => {
    expect(decompose("git log | head")).toEqual(["git log", "head"]);
  });

  test("splits on & (background)", () => {
    expect(decompose("git push &")).toEqual(["git push"]);
  });

  test("does not split && inside double quotes", () => {
    expect(decompose('echo "hello && world"')).toEqual(['echo "hello && world"']);
  });

  test("does not split && inside single quotes", () => {
    expect(decompose("echo 'hello && world'")).toEqual(["echo 'hello && world'"]);
  });

  test("handles escaped space (backslash-space consumed as escape)", () => {
    // backslash-space is consumed as escape pair — both chars kept
    // trim() strips trailing whitespace so result is "echo hello\\"
    expect(decompose("echo hello\\ ")).toEqual(["echo hello\\"]);
  });

  test("splits compound command with escaped space before separator", () => {
    // The backslash-space is consumed as escape, then space before && triggers split
    expect(decompose("echo hello\\  && git stash")).toEqual(["echo hello\\", "git stash"]);
  });

  test("splits multi-line as semicolons", () => {
    expect(decompose("git stash\ngit pull")).toEqual(["git stash", "git pull"]);
  });

  test("splits CRLF as semicolons", () => {
    expect(decompose("git stash\r\ngit pull")).toEqual(["git stash", "git pull"]);
  });

  test("handles subshells recursively", () => {
    expect(decompose("(cd dir && git stash)")).toEqual(["cd dir", "git stash"]);
  });

  test("handles nested subshells", () => {
    expect(decompose("(echo start && (cd dir && git stash))")).toEqual(["echo start", "cd dir", "git stash"]);
  });

  test("handles command substitution as opaque", () => {
    expect(decompose("echo $(git stash)")).toEqual(["echo $(git stash)"]);
  });

  test("handles backtick substitution as opaque", () => {
    expect(decompose("echo `git stash`")).toEqual(["echo `git stash`"]);
  });

  test("strips whitespace from subcommands", () => {
    expect(decompose("  git stash  &&  git pull  ")).toEqual(["git stash", "git pull"]);
  });

  test("filters empty subcommands", () => {
    expect(decompose("git stash && && git pull")).toEqual(["git stash", "git pull"]);
  });

  test("empty string returns empty array", () => {
    expect(decompose("")).toEqual([]);
  });

  test("whitespace-only string returns empty array", () => {
    expect(decompose("   ")).toEqual([]);
  });

  test("multi-char separators checked before single-char", () => {
    expect(decompose("git stash && echo ok")).toEqual(["git stash", "echo ok"]);
    expect(decompose("git stash || echo fail")).toEqual(["git stash", "echo fail"]);
  });

  test("complex compound command", () => {
    expect(decompose("cd dir && git stash; git pull || echo fail")).toEqual([
      "cd dir",
      "git stash",
      "git pull",
      "echo fail",
    ]);
  });
});

describe("extractCdTarget", () => {
  test("extracts simple directory", () => {
    expect(extractCdTarget("cd /tmp")).toBe("/tmp");
  });

  test("extracts quoted path", () => {
    expect(extractCdTarget('cd "E:/some/path"')).toBe("E:/some/path");
    expect(extractCdTarget("cd 'E:/some/path'")).toBe("E:/some/path");
  });

  test("extracts relative path", () => {
    expect(extractCdTarget("cd src/lib")).toBe("src/lib");
  });

  test("returns null for non-cd command", () => {
    expect(extractCdTarget("git stash")).toBeNull();
    expect(extractCdTarget("ls -la")).toBeNull();
  });

  test("returns CD_UNRESOLVABLE for cd - (previous dir)", () => {
    expect(extractCdTarget("cd -")).toBe("__CD_UNRESOLVABLE__");
  });

  test("expands tilde", () => {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    expect(extractCdTarget("cd ~")).toBe(home);
    expect(extractCdTarget("cd ~/projects")).toBe(`${home}/projects`);
  });
});

describe("decomposeWithCwd", () => {
  const baseCwd = "E:/repo";

  test("returns null effectiveCwd when no cd", () => {
    const result = decomposeWithCwd("git stash", baseCwd);
    expect(result).toEqual([{ command: "git stash", effectiveCwd: null }]);
  });

  test("tracks cd to absolute path", () => {
    const result = decomposeWithCwd("cd E:/repo/.worktrees/feat && git checkout -- file.ts", baseCwd);
    expect(result).toEqual([{ command: "git checkout -- file.ts", effectiveCwd: "E:/repo/.worktrees/feat" }]);
  });

  test("tracks cd with quoted path", () => {
    const result = decomposeWithCwd('cd "E:/repo/.worktrees/feat" && git stash', baseCwd);
    expect(result).toEqual([{ command: "git stash", effectiveCwd: "E:/repo/.worktrees/feat" }]);
  });

  test("tracks relative cd", () => {
    const result = decomposeWithCwd("cd .worktrees/feat && git stash", baseCwd);
    expect(result).toEqual([{ command: "git stash", effectiveCwd: "E:/repo/.worktrees/feat" }]);
  });

  test("tracks multiple cd commands", () => {
    const result = decomposeWithCwd("cd .worktrees/feat && git stash && cd E:/repo && git status", baseCwd);
    expect(result).toEqual([
      { command: "git stash", effectiveCwd: "E:/repo/.worktrees/feat" },
      { command: "git status", effectiveCwd: "E:/repo" },
    ]);
  });

  test("cd back to main repo resets effectiveCwd", () => {
    const result = decomposeWithCwd("cd .worktrees/feat && git checkout -- . && cd E:/repo && git status", baseCwd);
    expect(result).toEqual([
      { command: "git checkout -- .", effectiveCwd: "E:/repo/.worktrees/feat" },
      { command: "git status", effectiveCwd: "E:/repo" },
    ]);
  });

  test("skips cd-only commands from results", () => {
    const result = decomposeWithCwd("cd /tmp", baseCwd);
    expect(result).toEqual([]);
  });

  test("handles compound command without cd", () => {
    const result = decomposeWithCwd("git stash && git pull", baseCwd);
    expect(result).toEqual([
      { command: "git stash", effectiveCwd: null },
      { command: "git pull", effectiveCwd: null },
    ]);
  });

  test("cd.. normalizes to parent", () => {
    const result = decomposeWithCwd("cd .. && git status", "E:/repo/sub");
    expect(result).toEqual([{ command: "git status", effectiveCwd: "E:/repo" }]);
  });

  test("cd../.. normalizes multiple levels", () => {
    const result = decomposeWithCwd("cd ../.. && git status", "E:/repo/a/b");
    expect(result).toEqual([{ command: "git status", effectiveCwd: "E:/repo" }]);
  });

  test("cd. keeps same directory", () => {
    const result = decomposeWithCwd("cd . && git status", baseCwd);
    expect(result).toEqual([{ command: "git status", effectiveCwd: "E:/repo" }]);
  });

  test("cd / resolves to root", () => {
    const result = decomposeWithCwd("cd / && ls", baseCwd);
    expect(result).toEqual([{ command: "ls", effectiveCwd: "E:/" }]);
  });

  test("cd ~ resolves to home", () => {
    const home = (process.env.HOME || process.env.USERPROFILE || "").replace(/\\/g, "/");
    const result = decomposeWithCwd("cd ~ && git status", baseCwd);
    expect(result).toEqual([{ command: "git status", effectiveCwd: home }]);
  });

  test("cd - returns null effectiveCwd (cannot resolve OLDPWD)", () => {
    const result = decomposeWithCwd("cd - && git status", baseCwd);
    // cd - cannot be resolved since we don't have OLDPWD
    expect(result).toEqual([{ command: "git status", effectiveCwd: null }]);
  });

  test("trailing slashes are normalized by path.resolve", () => {
    const result = decomposeWithCwd("cd .worktrees/feat/ && git status", baseCwd);
    expect(result).toEqual([{ command: "git status", effectiveCwd: "E:/repo/.worktrees/feat" }]);
  });

  test("cd with multiple spaces between cd and path", () => {
    const result = decomposeWithCwd("cd   .worktrees/feat && git status", baseCwd);
    expect(result).toEqual([{ command: "git status", effectiveCwd: "E:/repo/.worktrees/feat" }]);
  });

  test("bare cd (no args) is not a cd command — stays in results", () => {
    const result = decomposeWithCwd("cd && git status", baseCwd);
    expect(result).toEqual([
      { command: "cd", effectiveCwd: null },
      { command: "git status", effectiveCwd: null },
    ]);
  });

  test("cd - recovery: subsequent cd resolves normally", () => {
    const result = decomposeWithCwd("cd - && cd .worktrees/feat && git status", baseCwd);
    // cd - resets to null, then cd .worktrees/feat resolves from baseCwd
    expect(result).toEqual([{ command: "git status", effectiveCwd: "E:/repo/.worktrees/feat" }]);
  });

  test("cd - in middle of compound command", () => {
    const result = decomposeWithCwd("cd .worktrees/feat && git status && cd - && git checkout -- file.ts", baseCwd);
    expect(result).toEqual([
      { command: "git status", effectiveCwd: "E:/repo/.worktrees/feat" },
      { command: "git checkout -- file.ts", effectiveCwd: null }, // cd - reset to unknown
    ]);
  });

  test("cd with $VAR returns CD_UNRESOLVABLE", () => {
    expect(extractCdTarget("cd $WORKTREE_PATH")).toBe("__CD_UNRESOLVABLE__");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell env-var syntax under test, not a template
    expect(extractCdTarget("cd ${WORKTREE_PATH}")).toBe("__CD_UNRESOLVABLE__");
    expect(extractCdTarget("cd prefix$VAR/suffix")).toBe("__CD_UNRESOLVABLE__");
  });

  test("cd with $VAR resets cwd to null", () => {
    const result = decomposeWithCwd("cd .worktrees/feat && cd $VAR && git status", baseCwd);
    expect(result).toEqual([
      { command: "git status", effectiveCwd: null }, // cd $VAR reset to unknown
    ]);
  });

  test("decomposeWithCwd with || separator", () => {
    const result = decomposeWithCwd("cd .worktrees/feat && git status || git status", baseCwd);
    expect(result).toEqual([
      { command: "git status", effectiveCwd: "E:/repo/.worktrees/feat" },
      { command: "git status", effectiveCwd: "E:/repo/.worktrees/feat" },
    ]);
  });

  test("empty input returns empty array", () => {
    expect(decomposeWithCwd("", baseCwd)).toEqual([]);
    expect(decomposeWithCwd("   ", baseCwd)).toEqual([]);
  });
});
