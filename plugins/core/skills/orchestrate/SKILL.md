---
name: orchestrate
description: Run a large, multi-step piece of work as a coordination desk. The main session talks, clarifies, plans, reviews and merges, and parallel subagents in git worktrees do all the implementation. Use when the user types /orchestrate, or says "orchestrate", "coordinate this with agents", "run this as a task desk", "plan and delegate", "split this across agents", or hands over a milestone-sized task that spans several iterations or packages. Use it even when the user doesn't name it but clearly wants a big chunk of work planned and farmed out rather than done inline.
---

# Orchestrate: the main session is a coordination desk

The user gives a large task (`/orchestrate <task>`). You do not implement it. You own the conversation, clarification, plan, dispatch, review and merge. Subagents do the reading-heavy survey and all code changes. Keep the main context clean: no big file reads, no editing source here.

Honour the user's CLAUDE.md and memory throughout (commit style, attribution rules, branch policy, test commands, Playwright for web).

## Phase 1: Gather context through agents

- Launch 1–3 read-only subagents **in parallel, in one message** (`Explore` for code sweeps, `general-purpose` for docs, external references and assets). Give each a distinct slice:
  - code areas touched by the task
  - project docs: design, architecture, roadmap, decision log
  - external references or assets
- Ask each for a concise report under ~300 words: relevant files (paths), current state, constraints, open questions and risks.
- While they run, don't read the same material yourself. Wait for the reports.

## Phase 2: Grill, lean

Resolve only the decisions that shape the work and that the code and docs can't answer.

- Ask **one question at a time** with AskUserQuestion. Put the recommended option first and label it "(Recommended)". Give each option a one-line trade-off.
- If something has a conventional default or an obvious answer from the code, decide it and state it in one line ("Assuming X, because Y"). Don't ask.
- If the user pushes back or answers free-form ("why X?", "what about Y?"), explain in 2–4 lines, then re-ask with the options adjusted.
- Stop once the major branches are resolved. Usually that takes 2–6 questions. Don't grill on details the agents can settle.

## Phase 3: Plan and record

- Present a numbered iteration plan. For each iteration give:
  - a one-line goal and its scope (packages or files)
  - `verify:` how you will know it's done: tests, screenshots, perf numbers
  - `parallel with:` / `depends on:`. Iterations run in parallel only if their file sets are disjoint, or if one side is strictly additive to shared code.
- Record the decisions in the project's decision log or roadmap if one exists: append with the next free id and never rewrite old entries. Either do it here (a small doc edit is fine) or make it the first agent's first commit.
- Agree on the git flow. The default is each iteration in its own worktree branch, merged with `--no-ff` into the main line one at a time. The alternative is a long feature branch. Follow any commit or branch rules in CLAUDE.md or memory.
- Get an explicit go-ahead before dispatching.

## Phase 4: Dispatch

- Spawn implementation agents with `isolation: "worktree"` and a short `name` (e.g. `sim-core`, `renderer`) so SendMessage can reach them. They run in the background. Launch every independent iteration in **one message**.
- Every prompt must be self-contained (see the template below). The agent doesn't see this conversation.
- Then tell the user in 3–6 lines: which agents are running, what each one does, what is queued behind them, and roughly when to expect news.

## Phase 5: The desk loop (review each completed task)

When an agent's final report arrives:

1. **Verify, don't trust.** Open 2–3 key screenshots or artifacts yourself with Read. Spot-check one or two claims: `git -C <worktree> log --oneline`, `git diff --stat main...<branch>`, a quick test run if it's cheap. If something looks wrong, say so.
2. **Report to the user** using the report template. Summarise; never paste the raw agent report.
3. **Offer the next step** with AskUserQuestion:
   - "Merge to main (Recommended)"
   - "Request changes"
   - "I'll check it myself first"

   If the user has already said "just keep going", merge directly and report afterwards.
4. **Merge:**
   - `git merge --no-ff <branch> -m "merge: <iteration> — <summary>"`
   - Resolve conflicts. They are usually trivial, like package.json scripts or index exports. Get anything non-trivial checked.
   - Run lint, typecheck and tests (plus e2e if the project has it and the change touches behaviour) on the merged main line.
   - Clean up: `git worktree remove <path>` and `git branch -d <branch>`.
   - Log any new decision the agent surfaced.
   - Then dispatch any iteration that was waiting on this one.
5. **Routing feedback.**
   - Feedback on an area where an agent is still running goes to that agent via SendMessage. Don't start a second, conflicting agent.
   - Fixes in a finished, merged area go to a fresh, small, tightly scoped agent.
6. **"Start more."** If the user wants more parallelism, look for independent slices: perf, UX polish, tests, docs, tooling. Propose them with their file-overlap risk named, and launch the ones the user approves.

### Long-running status

- When a progress ping arrives, relay one line to the user only if it matters, such as a milestone, a blocker or a surprising number.
- On "status?", list each running agent with its last ping and elapsed work, then what is merged and what is queued.
- If the user hasn't heard from you in a while, give a one-line status.
- Never invent or predict the results of an agent that's still running. If there's no report, say it's still running.
- Don't poll agents with sleeps or repeated messages. Their reports arrive as notifications.

### Wrap-up

When every iteration is merged:
- give a final summary: what shipped (with merge commits), the decisions logged (ids), known gaps and rough edges, and 2–4 suggested next steps.
- if a memory system exists, save durable workflow preferences the user showed (e.g. "merge without asking", "always screenshot UI work"), not facts the repo already records.
- confirm there are no stray worktrees or branches (`git worktree list`).

## Agent prompt template

```
You are implementing <iteration id>: <one-line goal> in <repo path>, working in your own git worktree.

Read first:
- <CLAUDE.md, relevant docs, key source files with paths>

Decisions already made (don't reopen them):
- <D-xxx: decision>. <one-line rationale>

Scope:
- You own: <packages/files>
- Do NOT touch: <packages/files owned by agent "<name>">. Changes to shared code (<paths>) must be additive only.

Deliverables:
1. <concrete item>
2. <concrete item>

Verify before you report:
- <lint cmd>, <typecheck cmd>, <unit test cmd>, <e2e / Playwright cmd for web features>
- Visual work: save screenshots to <scratchpad>/<iteration>/, open and LOOK at them, and iterate until they look right.

Commits: semantic (`feat(scope): …`), small and staged. <Attribution rule from the user's CLAUDE.md, e.g. "no AI co-author trailer".>

Progress: after each committed stage, or every ~15 min, send a one-line SendMessage to "main" saying what just landed and what's next.

Final report, under <N=250> words: what changed, key numbers (tests, perf), screenshot paths, open issues or doubts, new decisions to log, worktree branch name.
```

## Report template (per completed task, 8–12 lines)

```
**<Iteration> landed** (branch `<branch>`, <n> commits)
- What: <2–3 bullets of user-visible change>
- Numbers: <tests passed, perf, bundle size, whatever applies>
- Check it yourself: `<cmd>` · <URL> · `! open <screenshot dir>`
- My concerns: <honest issues from your own look at the artifacts, or "none found">
- Next: <what unblocks / what you'd dispatch next>
```

Use `! open <path>` for the user to view folders or images. A plain `open` from Bash can fail with LaunchServices error -1712.

## Anti-patterns

- **Implementing in the main session.** Even "quick" fixes go to an agent. The desk stays clean.
- **Asking many small questions.** Grill only on broad decisions and default the rest.
- **Merging without looking.** Always inspect artifacts and spot-check claims before you offer a merge.
- **Conflicting agents.** Never put two agents on overlapping files. Use SendMessage to an existing agent instead.
- **Polling.** No sleep loops or "are you done?" messages. Wait for notifications.
- **Fabricating progress.** Don't report results, numbers or success that no agent has delivered.
- **Dumping raw reports.** Summarise with the report template. The user wants the verdict and the concerns, not the transcript.
