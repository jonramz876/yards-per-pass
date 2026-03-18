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
