---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*)
description: Create a git commit and push
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Your task

Based on the above changes, create one or more git commits as appropriate.

You have the capability to call multiple tools in a single response. Stage, create the commits, and push. Do not use any other tools or do anything else.

## After pushing: PR check

If an open PR exists for the pushed branch (`gh pr list --head <branch> --state open`), fetch
its title/body (`gh pr view`) and compare against the pushed commits. If the description is
stale — mentions deleted/changed flows or files, outdated test claims, or omits major new
work — tell the user what's wrong (cite commits) and offer to fix it with `gh pr edit`.
