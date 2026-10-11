---
name: smart-build
description: Shape a feature or change into an agreed plan through a short, focused interview, then build it. A softer grill-me — asks only decisions that matter, always via selectable options, decides the obvious itself, and keeps the plan short. Suggests an implementation doc when the work spans several sessions or agents. Use when the user types /smart-build, says "smart build", "plan this with me then build", "help me scope this", or hands over a feature that needs a few decisions before coding.
---

# Smart build

Interview the user just enough to build the right thing, confirm a short plan, then build it. The user's time and attention are the scarce resource: every question and every line of plan text has to earn its place.

## 1. Look before asking

Explore the code, docs, CLAUDE.md and memory first. Anything they answer is not a question. For a large area, use an `Explore` subagent so the main context stays clean.

## 2. Ask only what matters

Sort each open decision:

- **Obvious or conventional** (naming, file placement, matching an existing pattern, a standard library choice, reversible details): decide it yourself. Collect these as one-line `Assuming X — because Y` notes to show with the plan.
- **Shapes the outcome** (scope, user-facing behaviour, data model, irreversible or costly choices, trade-offs with no clear winner): ask.

Usually 1–5 questions are enough. If you are past ~6, you are probably asking things you should decide.

### How to ask

- **Always use `AskUserQuestion`.** Never list options as plain text in chat — a picker is faster to answer and can't be skimmed past.
- Put the recommended option first, labelled `(Recommended)`.
- Use `multiSelect: true` when the choices are not mutually exclusive (e.g. "which of these should ship in v1?"). Otherwise single-select.
- Batch up to 4 independent questions in one call. Ask dependent ones after their parent is answered.
- **Option quality**: label is 1–5 words; description is one clear sentence saying what the option means *and* its main trade-off. Don't pad to look thorough, and don't cut so short the user has to guess ("Fast" alone tells them nothing; "Cache in memory — fastest, lost on restart" does).
- Use `preview` when comparing concrete artefacts (UI mockups, API shapes, code snippets).
- If the user answers free-form or pushes back, explain in 2–4 lines, then re-ask with adjusted options.

## 3. Present a short plan

Keep it scannable in under 30 seconds — long plans get skipped, and that wastes the tokens spent writing them.

```
**Goal:** <one line>

**Steps**
1. <step> → verify: <check>
2. ...

**Assumed:** <X — because Y>, ...   (only non-trivial ones)
**Out of scope:** <only if likely to be expected>
```

No restating the user's request, no background essay, no alternatives you didn't pick. Aim for ≤ 15 lines.

Then confirm with `AskUserQuestion`: "Is this how it should be built?" with options like *Build it (Recommended)* / *Adjust the plan* / *Rethink the approach*. Do not start building before a yes.

## 4. Big work: suggest an implementation doc

If the work won't fit one session, or should be split across parallel agents, offer (via `AskUserQuestion`) to write an implementation doc first.

- Path: `docs/impl/<slug>.md` in the target repo (or the repo root of the main package in a monorepo).
- Content, kept tight: goal, decisions made (with the one-line why), ordered work items with `verify:` and `depends on:`, a status checkbox per item, open risks.
- It is the shared source of truth between sessions and agents: tick items off as they land, so a fresh session can resume from it alone.
- **It is temporary.** Delete it in the final change that completes the work, and say so when you do. Durable decisions belong in the project's ADRs/decision log, not here.
- For multi-agent execution, hand over to `/orchestrate` if it is available, pointing it at the doc.

## 5. Build

Implement against the confirmed plan, following the project's CLAUDE.md and memory (commit style, tests, browser checks for UI). If something forces a real change of plan mid-build, stop and ask with `AskUserQuestion`; small adjustments you just mention in the final summary.
