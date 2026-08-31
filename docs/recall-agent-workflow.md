# Agent workflow: milestone prompts, context, reports, model routing

Companion to [../AGENTS.md](../AGENTS.md). AGENTS.md holds the rules every agent must follow in
every session; this document holds the reusable structures a founder or agent reaches for when
starting, resuming, or closing a milestone. Nothing here changes product behavior.

## 1. Milestone prompt structure

A good milestone prompt is bounded and decision-complete. Use these nine sections; drop any that is
genuinely empty rather than padding it.

1. **Outcome** — what is true when this is done, in plain English. One paragraph plus a short
   checklist. Say what must remain unchanged.
2. **Frozen decisions** — settled choices the agent must not reopen, including completed one-time
   operations that must never rerun.
3. **Read first** — the specific files and documents to inspect before designing, and an explicit
   instruction not to read the entire product history.
4. **Authorized scope** — what the agent may change, listed concretely, followed by what it may
   not. Name the authority levels from AGENTS.md that are granted: analysis, implementation,
   application, deployment, staging and commit, push. Grant push separately and explicitly —
   authorizing a commit never authorizes a push.
5. **Preserve** — unrelated work, existing safety requirements, authoritative documents, current
   production behavior.
6. **Implementation contract** — the substantive requirements, grouped by area.
7. **Acceptance checks** — the conditions that make it complete, written so they can be checked
   rather than argued.
8. **Stop conditions** — the states in which the agent must halt and report instead of proceeding.
   End with a line making routine decisions the agent's own.
9. **Final report** — point at the template in §4.

Two failure modes to avoid: a prompt that describes a state the repository is not actually in (the
agent should verify the checkpoint first and stop on mismatch), and a prompt so exhaustive that it
prescribes the implementation. Specify the outcome and the boundaries; leave the engineering.

### Starting checkpoint

For any substantial milestone, state the expected branch, HEAD, upstream, and working-tree
cleanliness, and require the agent to verify them before editing and stop on mismatch without
repairing anything automatically.

## 2. Clearing versus compacting

**Clear** the session when:

- the milestone is complete, committed, and pushed, and the next task is unrelated;
- the session is dominated by obsolete debugging or research;
- resolved questions keep getting reopened;
- an independent review needs fresh context.

**Compact** when:

- the milestone is unfinished;
- uncommitted work must continue;
- context is crowded but the current reasoning is still load-bearing;
- restarting would mean reconstructing substantial current reasoning.

## 3. Continuation packet

Write this before compacting. Keep it short — it is a handoff, not a history.

1. **Intended outcome**
2. **Frozen decisions**
3. **Completed work**
4. **Remaining work**
5. **Modified files**
6. **Commands already run** (and their results)
7. **Unresolved blockers**
8. **Not authorized** — actions explicitly out of bounds

After compaction, follow the recovery rule in [../AGENTS.md](../AGENTS.md): re-read the active plan,
inspect git status and the current diff, restate outcome / frozen decisions / completed work /
remaining work, and resolve any mismatch before editing.

## 4. Final report template

Nine sections, plain English first, technical detail only where it supports a decision.

1. **Verdict** — done, partially done, or blocked, in one line.
2. **What changed for the user** — observable behavior, not file names.
3. **Important implementation decisions** — only the ones a reviewer would want to challenge.
4. **Tests and QA results** — what was run and what it returned.
5. **Production or data actions taken** — or an explicit "none."
6. **Git status** — branch, whether anything was staged, committed, or pushed, working-tree state.
7. **Manual QA remaining** — what a human still has to check.
8. **Safe to checkpoint** — yes or no.
9. **Deferred work** (optional) — at most five evidence-backed items arising from this milestone.
   Omit the section entirely when the work produced none. Exclude settled product decisions,
   intentionally hidden or deferred features, unrelated repository warnings, speculative
   improvements, and anything not established during the authorized work.

Scale the report to the change. A documentation fix does not need nine populated sections; say what
changed, what was verified, and that nothing else moved.

## 5. Model routing

Principles, not a price list. Model names, pricing, limits, and availability change — verify
current official guidance before making a recommendation that depends on them, and do not encode
them as permanent architectural facts.

- **Fable** — the hardest, highest-leverage work: ambiguous architecture, subtle semantics,
  concurrency, security, expensive-to-reverse decisions, and difficult issues that survived a
  serious first fix.
- **Opus** — the main model: complex multi-file implementation, cross-system reasoning, executing
  an architecture, and difficult debugging.
- **Sonnet** — routine implementation, mechanical changes, tests, documentation, cleanup, and
  bounded fixes.
- **Fresh independent reviewer** — reserved for materially risky work. Constrain the review against
  speculative findings and overengineering: ask for defects that change behavior, not for a wish
  list.

Use each model's current recommended effort level unless project evidence supports a different
setting. Do not sacrifice quality to save Fable usage, and do not spend Fable on mechanical work.

Avoid subagents unless the work is genuinely independent or a bounded hard problem benefits from
fresh context. No agent swarms.
