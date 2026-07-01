#!/usr/bin/env python3
"""
H1 Contracts-block hook (Layer 1 — fast feedback) for the token-governance system.
See C:/Dev/Project-Mnemosyne/docs/TOKEN-GOVERNANCE-SYSTEM.md (§5 H1, §13.2 / §13.5, §18.1 G4).

PreToolUse hook on the Bash tool. Blocks `git add` / `git commit` that would stage or
commit contract / legal / invoice files which must never enter a git repo (they belong in
the out-of-repo C:\\Dev\\<Project>\\contracts\\ folder, or in Mnemosyne per §14).

Two detection methods:
  A. Scan the path ARGUMENTS of `git add` invocations in the command for forbidden
     patterns (catches explicit `git add docs/MOU.pdf`, `git add contracts/`). Scoped
     to `git add` segments only — never the free text of a `git commit -m "..."`
     message, so a commit message that happens to mention "MOU" or "SOW" as a word
     does not get false-blocked (P5-H1FIX, thread 0024).
  B. Best-effort: inspect already-staged files via `git diff --cached --name-only`
     (catches `git commit` after a broad `git add -A`). CWD inferred from a leading
     `cd <dir>` in the command, else the hook's own CWD. Fails open on any error.

This is LAYER 1 only — fast, in-session feedback. It is intentionally bypassable; the
canonical gates are the local pre-commit hook (Layer 2) and CI + protected branch (Layer 3).
So on any internal error this hook FAILS OPEN (allows) to avoid blocking legitimate work.
"""

import sys
import os
import re
import json
import shlex
import subprocess


def is_forbidden(path: str) -> bool:
    """True if a repo-relative path matches a forbidden contract/legal pattern.

    Patterns (from the governance spec / global gitignore convention):
      **/contracts/**   -> any path with a `contracts` directory component
      **/MOU*           -> basename starts with MOU  (case-sensitive: avoid 'mouse.js')
      **/SOW*           -> basename starts with SOW
      **/INVOICE*       -> basename starts with INVOICE
    (docs/MOU* etc. are subsumed by the basename rules.)
    """
    norm = path.replace("\\", "/").strip().strip('"').strip("'")
    if not norm:
        return False
    parts = [p for p in norm.split("/") if p and p not in (".", "..")]
    # contracts/ directory anywhere in the path
    if any(p == "contracts" for p in parts):
        return True
    base = parts[-1] if parts else norm
    # Case-sensitive uppercase prefixes — matches the MOU_/SOW_/INVOICE_ naming
    # convention without false-positiving on code like mouse.ts / software.go.
    if re.match(r"^(MOU|SOW|INVOICE)", base):
        return True
    return False


def find_hits_in_git_add(command: str):
    """Method A: pull path arguments out of `git add` segments only.

    Never inspects `git commit` (or anything else) — a commit MESSAGE is free text,
    not a path, and scanning it caused false positives on clean commits whose message
    happened to contain a word like "MOU" or "SOW" (P5-H1FIX).
    """
    hits = []
    for segment in re.split(r"&&|\|\||;|\|", command):
        # (\w+=\S+\s+)* tolerates env-var-prefixed invocations like `VAR=x git add contracts/a.pdf`
        # (thread 0024 QC P2, optional — Method B/staged-scan already catches these as defense in depth).
        m = re.match(r"\s*(?:\w+=\S+\s+)*git\s+add\b(.*)", segment)
        if not m:
            continue
        try:
            tokens = shlex.split(m.group(1), posix=True)
        except ValueError:
            tokens = m.group(1).split()
        for tok in tokens:
            if tok.startswith("-"):
                continue
            if is_forbidden(tok):
                hits.append(tok)
    return hits


def infer_cwd(command: str) -> str:
    """Best-effort: extract the dir from a leading `cd <dir> &&|;` clause."""
    m = re.match(r"""\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))""", command)
    if m:
        d = next(g for g in m.groups() if g is not None)
        if os.path.isdir(d):
            return d
    return os.getcwd()


def find_hits_in_staged(command: str):
    """Method B: forbidden files already staged. Fails open (returns [] on error)."""
    try:
        cwd = infer_cwd(command)
        out = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=cwd, capture_output=True, text=True, timeout=8,
        )
        if out.returncode != 0:
            return []
        return [ln for ln in out.stdout.splitlines() if ln.strip() and is_forbidden(ln)]
    except Exception:
        return []


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # fail open

    if data.get("tool_name") != "Bash":
        sys.exit(0)
    command = (data.get("tool_input") or {}).get("command", "") or ""

    # Only care about commands that stage or commit.
    if not re.search(r"\bgit\s+(add|commit)\b", command):
        sys.exit(0)

    hits = sorted(set(find_hits_in_git_add(command) + find_hits_in_staged(command)))
    if not hits:
        sys.exit(0)

    reason = (
        "H1 contracts-block: this git operation would put contract/legal/invoice files "
        "into a repo, which is forbidden (see TOKEN-GOVERNANCE-SYSTEM.md §14 + the "
        "no-contracts-in-repos rule).\n\n"
        "Blocked path(s): " + ", ".join(hits) + "\n\n"
        "These belong OUT of git — in C:\\Dev\\<Project>\\contracts\\ (and/or Mnemosyne, "
        "the sanctioned encrypted store). Unstage them (git restore --staged <path>), move "
        "them out of the repo, and confirm they are gitignored before retrying.\n"
        "[Layer 1 / fast feedback — also enforced by local pre-commit + CI.]"
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
