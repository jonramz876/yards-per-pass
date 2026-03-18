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
