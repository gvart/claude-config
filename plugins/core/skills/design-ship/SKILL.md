---
name: design-ship
description: Ship a polished frontend/UX feature or redesign end-to-end with rigor — explore the codebase, self-grill the design decision tree, implement via the ui-ux-designer agent, validate live with Playwright, then self code-review and fix. Use for non-trivial UI/UX builds, redesigns, dashboards, "make this screen great / monitor X", or any "implement this feature properly" request where quality matters more than speed.
---

# Design-Ship: deliver a polished UI feature with rigor

A disciplined pipeline for non-trivial frontend/UX work. It trades speed for a
genuinely good, verified result by composing: self-grilling (resolve the design
yourself), delegated implementation (ui-ux-designer agent), independent live
validation (Playwright), and adversarial review (code-quality-reviewer agent).

**Use it when** the user asks to build/redesign a screen, "make this page great,"
build a dashboard or monitoring view, or implement a meaningful frontend feature
and cares about the outcome. **Skip it** for one-line tweaks, copy changes, or
pure bugfixes — those don't need the ceremony.

The whole point: **don't hand-wave any phase.** Each one has a concrete bar.

---

## Phase 0 — Ground yourself in reality (always first)

Never design against your imagination. Read, in this order:
- The **design system** — tokens, fonts, spacing, the house rules (CLAUDE.md /
  AGENTS.md / a `genesara.css`-style token file). Note hard constraints (e.g.
  "no new tokens", "hairlines not shadows", "no UI framework").
- **Existing components** you can reuse — don't rebuild what's there. Find the
  pattern to generalize (e.g. an existing floating panel → a reusable one).
- The **data layer** — types, queries/hooks, mocks. Know exactly what data is
  available vs. what's currently shown. Gaps here are often the real feature.
- Any **design reference / prototype** the repo ships (a `design/` dir, Figma
  export, prototype HTML). It encodes intent — match it.

Output of this phase: you can name the tokens, the reusable components, the data
sources (with file paths), and the constraints. If you can't, keep reading.

## Phase 1 — Self-grill the design

Invoke the **grill-me** skill, but **answer the questions yourself** — you are
both interviewer and interviewee. Walk every branch of the decision tree and
resolve it with a recommended answer grounded in the code (explore instead of
guessing). Cover at least:
- **Who is the user and what is the primary job?** (the one thing this screen
  exists to do — e.g. "follow one agent live").
- **What is the hero?** The single most important element; everything else
  supports it.
- **Always-visible vs. on-demand?** What must never be hidden vs. what can live
  behind a click / in a secondary surface.
- **Interaction model** — navigation, windows/panels, what opens how.
- **Edge cases** — loading, empty, error/404, never-populated, responsive /
  small-viewport, performance (e.g. don't mount two heavy canvases at once).
- **Reuse vs. build** — which existing classes/components carry the design.

Converge on a **tight written spec** including an **ASCII layout sketch**. This
spec is the contract for Phase 3 — if it's vague, the result will be too.

## Phase 2 — Confirm scope (only genuine forks)

Use AskUserQuestion **only** where the answer materially changes what you build:
scope (which pieces), visual direction, or depth (cheap vs. ambitious). 1–3 sharp
questions, recommended option first, obvious defaults chosen silently. Don't ask
about anything you resolved in Phase 1.

## Phase 3 — Implement via the ui-ux-designer agent (over-specify the brief)

Delegate the build to the **ui-ux-designer** agent. A vague brief yields a vague
result, so the brief MUST contain:
- **Repo + exact files** to touch (and which to leave alone — e.g. don't change
  `api/*` or `mocks/*`).
- **Hard design-system constraints** quoted: the token names, "no new tokens",
  hairline/shadow/corner rules, fonts. Tell it to read CLAUDE.md / AGENTS.md.
- **The target layout** from your spec (paste the ASCII sketch) and the
  component APIs to build (props of any new primitive).
- **Data sources with file refs** — reuse the existing queries/hooks; name them.
- **A "preserve / no-regressions" list** — every field/behavior that must still
  work after the refactor.
- **Explicit Playwright acceptance criteria** the agent must self-verify, with
  the headline criterion stated as a measurable assertion (e.g. "no page scroll:
  documentElement.scrollHeight ≤ innerHeight at 1440×900 and 1280×800").
- **Housekeeping:** don't `git commit`; clean up dev servers and screenshot
  artifacts; report files changed + the validation evidence.

Give it a model appropriate to the difficulty. Remember it starts with a fresh
context — everything it needs goes in the prompt.

## Phase 4 — Validate with Playwright yourself (don't just trust the agent)

Independently verify with the Playwright MCP:
- Start a dev server on a **free port** (don't clobber the user's running one).
  Seed auth/session if the route is gated (sessionStorage/localStorage, or drive
  the login form). Use the richest fixture/agent available.
- Assert **measurable** criteria via `browser_evaluate`: element counts, the
  no-scroll math, interaction outcomes (open/close/drag/keyboard), lazy
  mount/unmount (e.g. canvas count 1→2→1).
- **Exercise interactions** — click, drag (`browser_drag`), keys
  (`browser_press_key`, Esc). Don't assume; trigger and read back.
- **Screenshot and actually look at it** — `browser_take_screenshot` + Read the
  image. Numbers don't catch ugly.
- **Console errors must be 0.** Re-run `typecheck` + `build`.
- Test the **responsive/fallback** path too (small viewport, etc.).
- If you injected temp fixture data to exercise a branch, **revert it** after.

## Phase 5 — Self code review + fix

Run the **code-quality-reviewer** agent on the diff. It's read-only — *you* apply
the fixes. Make it effective:
- Give it the **scope** (files), the **context** (framework, constraints,
  CLAUDE.md), and an **"already verified — don't re-report" list** so it focuses
  on what you haven't checked.
- Point it at the usual suspects: hook dependency arrays / stale closures,
  event-listener & pointer leaks, re-renders of heavy subtrees (memoize),
  edge cases, **data-exposure regressions**, design-system violations / **dead
  code the refactor orphaned**, and a11y (roles, focus, keyboard).

Triage by severity. **Fix the real ones** (perf, correctness, edge cases,
orphaned CSS/imports); skip pure nitpicks. **Re-validate** (Phase 4) after fixing
— a fix isn't done until it's re-checked.

## Phase 6 — Land it clean

- `typecheck` + `build` green.
- Revert temp test data; remove screenshot artifacts you created; stop dev
  servers you started.
- **Don't commit unless asked** (respect house rules — no AI co-author trailers).
- Summarize: what shipped, the **validation evidence** (the measured no-scroll
  numbers, console-error count), the **review findings you fixed**, and any
  **known caveats / follow-ups** (stubs, engine-side asks, optional extras).

---

## Why this works (the guardrails)

- **Explore before designing, reuse before building, over-specify the brief,
  verify independently, review adversarially, clean up after yourself.**
- Subagents have fresh context — inline everything they need; never assume they
  see what you see.
- Hold a concrete quality bar at every gate: a measurable layout assertion,
  0 console errors, no data regressions, strict design-system adherence.
- You stay in the loop between phases. Read each agent's result and decide the
  next move — don't fire-and-forget.
