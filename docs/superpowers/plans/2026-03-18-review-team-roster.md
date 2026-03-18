# Review Team Roster Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a reusable Claude Code slash command (`/review-feature`) that dispatches 47 specialized review teams + 3 CEO-level reviewers after every feature implementation, compiles deduplicated findings, and presents a final scorecard.

**Architecture:** A single Claude Code custom command file (`.claude/commands/review-feature.md`) orchestrates the entire workflow. It reads team definitions from the existing spec, dispatches all 47 teams as background agents, compiles results using deduplication/severity rules, then dispatches 3 CEO agents for executive synthesis. The spec at `docs/superpowers/specs/2026-03-18-review-team-roster-design.md` is the single source of truth for team definitions.

**Tech Stack:** Claude Code custom commands (`.claude/commands/`), Agent tool with `run_in_background: true`, git diff for change detection.

**Spec:** `docs/superpowers/specs/2026-03-18-review-team-roster-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `.claude/commands/review-feature.md` | Slash command — full dispatch workflow: detect changes, dispatch 47 teams, compile results, dispatch 3 CEOs, present scorecard |
| `.claude/CLAUDE.md` | Project-level instructions — review workflow reference, project conventions |

### Reference Files (already exist, not modified)
| File | Role |
|------|------|
| `docs/superpowers/specs/2026-03-18-review-team-roster-design.md` | Team roster spec — single source of truth for all 47 team definitions, 3 CEO definitions, report formats, severity definitions, rating rubric |

---

## Chunk 1: Slash Command & Project Config

### Task 1: Create the `.claude/commands/` directory

**Files:**
- Create: `.claude/commands/` (directory)

- [ ] **Step 1: Create the directory**

```bash
mkdir -p ".claude/commands"
```

- [ ] **Step 2: Verify**

```bash
ls -la .claude/commands/
```

Expected: empty directory exists.

---

### Task 2: Create the review-feature slash command

**Files:**
- Create: `.claude/commands/review-feature.md`

This is the core deliverable. The command file contains the procedural workflow; team definitions are read from the spec at runtime.

- [ ] **Step 1: Write the command file**

Create `.claude/commands/review-feature.md` with the following content:

~~~markdown
# Review Feature

Dispatch the full 47-team + 3-CEO review roster to evaluate the current feature changes on Yards Per Pass.

## Arguments

$ARGUMENTS = Description of the feature or changes to review (e.g., "Added dark mode toggle to all pages")

## Procedure

Follow these steps exactly. Do not skip steps or combine steps.

### Step 1: Determine What Changed

Identify what was changed using the description provided and git:

```bash
git diff --name-only HEAD~1
```

If the last commit doesn't capture the full feature (multi-commit feature), use:

```bash
git diff --name-only main...HEAD
```

Capture two pieces of information:
- **What changed:** $ARGUMENTS (the user's description)
- **Files modified:** The file list from git diff

If $ARGUMENTS is empty or missing, ask the user to describe what changed before proceeding.

### Step 2: Read the Team Roster Spec

Read the team roster spec to get all 47 team definitions and 3 CEO definitions:

```
docs/superpowers/specs/2026-03-18-review-team-roster-design.md
```

### Step 3: Dispatch All 47 Review Teams

For each of the 47 teams defined in the spec, dispatch a background Agent. Use `run_in_background: true` for every agent. Dispatch all 47 in a single message (multiple parallel Agent tool calls).

After dispatching, verify that exactly 47 agents were launched. If fewer, identify which teams were missed and dispatch them in a follow-up message.

Each agent receives this prompt (fill in the bracketed values):

```
You are Team N — [Team Name] reviewing a feature on the Yards Per Pass NFL analytics website.

**What changed:** [feature description from Step 1]
**Files modified:** [file list from Step 1]
**Codebase location:** C:\Users\jonra\OneDrive\Desktop\claude sandbox\football website\yards-per-pass\

Your review perspective: [Team-specific description from the spec]

Focus your review on the changed files and any code/pages they interact with.
Do NOT audit the entire codebase unless the change has site-wide implications
(e.g., shared component changes, design system updates, data pipeline changes).

Consider a change relevant to your perspective if it directly modifies, or could
indirectly affect, functionality within your review scope. When in doubt, report
as relevant with a brief note on why.

If this change is not relevant to your perspective, report in this format and stop:

Team: Team N — [Team Name]
Perspective: [One-line description]
Relevance: Not relevant to this change

If relevant, provide your report in this EXACT format:

Team: Team N — [Team Name]
Perspective: [One-line description]
Relevance: Relevant
Rating: X/10

### Findings
- **CRITICAL**: [Issue] — [file:line] — [why it matters]
- **IMPORTANT**: [Issue] — [file:line] — [why it matters]
- **MINOR**: [Issue] — [file:line] — [why it matters]

### What Would Make It a 10
- [Concrete fix 1]
- [Concrete fix 2]

Rating rubric:
- 9-10: Excellent — no meaningful improvements needed
- 7-8: Good — minor improvements only
- 5-6: Acceptable — notable issues exist
- 3-4: Significant problems — should fix before shipping
- 1-2: Broken or fundamentally flawed

Severity definitions:
- CRITICAL: Data is wrong, feature is broken, security vulnerability, or user sees an error. Must fix before shipping.
- IMPORTANT: Functionality works but is misleading, confusing, incomplete, or inconsistent. Should fix before shipping.
- MINOR: Polish, style, optimization, or nice-to-have. Can ship without fixing.

Be specific. Cite files and line numbers. Do not make assumptions — read the code.
```

### Step 4: Wait for All Teams to Complete

As agents complete, acknowledge each one briefly. Do NOT start compilation until all 47 have reported back. Track completion count (e.g., "23/47 teams reported").

If any agent fails to respond or returns an error, mark it as "No response — agent error" in the summary and proceed after all other agents complete. Do not block the entire review on a single unresponsive agent.

### Step 5: Compile the Summary

After all 47 teams have reported, compile the results following these rules:

1. **Filter "Not relevant" teams** — Collect all teams that reported "Not relevant." Present a single aggregate line:
   > *"N teams reported no findings relevant to this change: [Team 3, Team 7, ...]"*

2. **Deduplicate findings** — When multiple teams flag the same issue:
   - Keep the **highest severity level** (CRITICAL > IMPORTANT > MINOR)
   - Keep the **most specific description** (prefer the version with file:line references)
   - Add a note: *(Also flagged by: Team X, Team Y)*

3. **Sort findings** — CRITICAL → IMPORTANT → MINOR within the compiled list

4. **Rating table** — Show all relevant teams with their ratings, sorted by rating (lowest first). Include average score at the bottom.

5. **Flag disagreements** — When teams with overlapping scope give significantly different ratings (>2 points apart) or contradict each other's findings, flag it for CEO arbitration:
   > *"⚠️ Disagreement: Team X rated 8/10 but Team Y rated 5/10 on [overlapping area]. Flagging for CEO review."*

### Step 6: Dispatch 3 CEO Reviewers

After compilation, dispatch 3 CEO agents in parallel (all with `run_in_background: true`). Each CEO receives the compiled summary AND all 47 raw team reports.

**CEO 1 — Product / Consumer CEO:**
```
You are a CEO-level reviewer for the Yards Per Pass NFL analytics website.

Your persona: Head of a consumer sports media company (like The Athletic or ESPN Digital).
Your lens: "Would users come back? Is this easy to understand? Does this grow the audience?"

You evaluate: User experience, feature discoverability, engagement potential, casual fan accessibility, content shareability.

Below is the compiled summary from 47 specialized review teams, followed by the full individual team reports for reference.

[INSERT COMPILED SUMMARY HERE]

[INSERT ALL 47 RAW TEAM REPORTS HERE]

Rating rubric (use for your Final Score):
- 9-10: Excellent — no meaningful improvements needed
- 7-8: Good — minor improvements only
- 5-6: Acceptable — notable issues exist
- 3-4: Significant problems — should fix before shipping
- 1-2: Broken or fundamentally flawed

Provide your report in this EXACT format:

CEO: Product / Consumer CEO
Perspective: Would users come back? Is this easy to understand? Does this grow the audience?
Overall Assessment: [1-2 sentence summary]
Go / No-Go: [Ship it | Ship with fixes | Do not ship]

### Top 5 Priorities
1. [Priority] — [Why it matters from your perspective]
2. ...
3. ...
4. ...
5. ...

### Overrides / Escalations
- [Any findings the teams missed or under-weighted]

### Final Score: X/10
```

**CEO 2 — Analytics / Data CEO:**
```
You are a CEO-level reviewer for the Yards Per Pass NFL analytics website.

Your persona: Head of an analytics company (like PFF or TruMedia).
Your lens: "Is the data bulletproof? Would an analyst trust this? Could this embarrass us if someone fact-checks it on Twitter?"

You evaluate: Data accuracy, statistical methodology, industry-standard definitions, cross-source validation, credibility signals.

Below is the compiled summary from 47 specialized review teams, followed by the full individual team reports for reference.

[INSERT COMPILED SUMMARY HERE]

[INSERT ALL 47 RAW TEAM REPORTS HERE]

Rating rubric (use for your Final Score):
- 9-10: Excellent — no meaningful improvements needed
- 7-8: Good — minor improvements only
- 5-6: Acceptable — notable issues exist
- 3-4: Significant problems — should fix before shipping
- 1-2: Broken or fundamentally flawed

Provide your report in this EXACT format:

CEO: Analytics / Data CEO
Perspective: Is the data bulletproof? Would an analyst trust this? Could this embarrass us if someone fact-checks it on Twitter?
Overall Assessment: [1-2 sentence summary]
Go / No-Go: [Ship it | Ship with fixes | Do not ship]

### Top 5 Priorities
1. [Priority] — [Why it matters from your perspective]
2. ...
3. ...
4. ...
5. ...

### Overrides / Escalations
- [Any findings the teams missed or under-weighted]

### Final Score: X/10
```

**CEO 3 — Technical / Web CEO:**
```
You are a CEO-level reviewer for the Yards Per Pass NFL analytics website.

Your persona: Head of a web technology company (CTO-level technical depth).
Your lens: "Is this production-ready? Is it fast, secure, and maintainable? Would I be comfortable with this in a production environment?"

You evaluate: Performance, security, error handling, build health, caching strategy, code quality, infrastructure reliability, scalability.

Below is the compiled summary from 47 specialized review teams, followed by the full individual team reports for reference.

[INSERT COMPILED SUMMARY HERE]

[INSERT ALL 47 RAW TEAM REPORTS HERE]

Rating rubric (use for your Final Score):
- 9-10: Excellent — no meaningful improvements needed
- 7-8: Good — minor improvements only
- 5-6: Acceptable — notable issues exist
- 3-4: Significant problems — should fix before shipping
- 1-2: Broken or fundamentally flawed

Provide your report in this EXACT format:

CEO: Technical / Web CEO
Perspective: Is this production-ready? Is it fast, secure, and maintainable? Would I be comfortable with this in a production environment?
Overall Assessment: [1-2 sentence summary]
Go / No-Go: [Ship it | Ship with fixes | Do not ship]

### Top 5 Priorities
1. [Priority] — [Why it matters from your perspective]
2. ...
3. ...
4. ...
5. ...

### Overrides / Escalations
- [Any findings the teams missed or under-weighted]

### Final Score: X/10
```

### Step 7: Present the Final Scorecard

After all 3 CEOs have reported, present the final scorecard to the user:

#### Scorecard Format

```
# Feature Review Scorecard
**Feature:** [description]
**Date:** [today's date]
**Teams dispatched:** 47 | **Relevant:** N | **Not relevant:** M

---

## Go / No-Go Recommendation
[Apply these rules:]
- If ANY CEO says "Do not ship" → default is **Do not ship**
- If TWO or more CEOs say "Ship with fixes" → default is **Ship with fixes**
- Otherwise → **Ship it**

**Recommendation: [Ship it | Ship with fixes | Do not ship]**
*[User makes the final call]*

---

## CEO Assessments

| CEO | Score | Go/No-Go | Top Priority |
|-----|-------|----------|--------------|
| Product/Consumer | X/10 | ... | ... |
| Analytics/Data | X/10 | ... | ... |
| Technical/Web | X/10 | ... | ... |

---

## Findings by Severity

### CRITICAL (must fix)
1. [Finding] — [file:line] — [source team(s)]

### IMPORTANT (should fix)
1. [Finding] — [file:line] — [source team(s)]

### MINOR (can ship without)
1. [Finding] — [file:line] — [source team(s)]

---

## Rating Table

| Team | Rating | Top Finding |
|------|--------|------------|
| ... | X/10 | ... |
| **Average** | **X.X/10** | |

---

## Quick Wins
[Items from CRITICAL and IMPORTANT that can be fixed in <5 minutes each]

## Not Relevant
N teams reported no findings: [list]
```

Present this scorecard and ask the user how they'd like to proceed:
- Fix all CRITICALs now
- Fix CRITICALs + IMPORTANTs now
- Fix quick wins only
- Ship as-is
- Something else
~~~

- [ ] **Step 2: Verify the command file is readable**

```bash
wc -l .claude/commands/review-feature.md
```

Expected: file exists, ~200+ lines.

- [ ] **Step 3: Commit the command file**

```bash
git add .claude/commands/review-feature.md
git commit -m "feat: add /review-feature slash command for 47-team review dispatch"
```

---

### Task 3: Create project-level CLAUDE.md

**Files:**
- Create: `.claude/CLAUDE.md`

- [ ] **Step 1: Write the project CLAUDE.md**

Create `.claude/CLAUDE.md` with:

```markdown
# Yards Per Pass — Project Instructions

## Review Workflow

After implementing any feature, run `/review-feature "description of changes"` to dispatch the full 47-team + 3-CEO review roster.

Team roster spec: `docs/superpowers/specs/2026-03-18-review-team-roster-design.md`

## Project Conventions

- This is a Next.js 14 App Router project with TypeScript, Tailwind v4, and D3.js
- Data lives in Supabase (PostgreSQL with RLS)
- All stat computation happens in `scripts/ingest.py` — never compute stats client-side
- `lib/data/queries.ts` and `lib/data/run-gaps.ts` handle data fetching
- Supabase has a 1000-row server limit — use `fetchAllRows()` pagination for large tables
- After any DB data change, trigger ISR revalidation via the webhook at `/api/revalidate`
- `parseNumericFields` converts null → NaN (not 0) so display shows "—" for missing data
- Always run `tsc --noEmit && next build` before committing
```

- [ ] **Step 2: Commit the project CLAUDE.md**

```bash
git add .claude/CLAUDE.md
git commit -m "feat: add project-level CLAUDE.md with review workflow and conventions"
```

---

### Task 4: Validate the slash command

- [ ] **Step 1: Verify command is discoverable**

Start a new Claude Code session in the yards-per-pass directory and type `/review-feature`. It should appear as an available slash command. If it doesn't, check that the file is at `.claude/commands/review-feature.md` (not nested deeper).

- [ ] **Step 2: Dry-run with a recent change**

In the yards-per-pass directory, run:

```
/review-feature "Fixed success_rate display and added ISR revalidation for /run-gaps"
```

Verify:
- [ ] Git diff detection works (shows recently changed files)
- [ ] Team roster spec is read successfully
- [ ] All 47 agents are dispatched with `run_in_background: true`
- [ ] Agents that find nothing relevant report "Not relevant" and stop quickly
- [ ] Agents that find issues report in the correct format (Team/Perspective/Rating/Findings)
- [ ] Summary compilation deduplicates correctly
- [ ] 3 CEO agents are dispatched after compilation
- [ ] Final scorecard is presented in the correct format
- [ ] Go/no-go recommendation follows the aggregation rules

- [ ] **Step 3: Commit any fixes from dry-run**

If the dry-run reveals issues with the command file, fix them and commit:

```bash
git add .claude/commands/review-feature.md
git commit -m "fix: address issues found during review-feature dry-run"
```

---

## Done

After Task 4, the review team roster system is operational. Usage:

```
/review-feature "description of what changed"
```

This dispatches 47 review teams → compiles results → dispatches 3 CEOs → presents a scorecard with go/no-go recommendation and prioritized findings.
