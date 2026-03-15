# Launch Checklist — Yards Per Pass

## Pre-Deploy

- [ ] 1. Create Supabase project (PostgreSQL)
- [ ] 2. Run `scripts/schema.sql` against Supabase DB
- [ ] 3. Copy `.env.example` to `.env.local`, fill in:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `REVALIDATE_SECRET` (generate random 32+ char string)
- [ ] 4. Run `python scripts/ingest.py --season 2025` (seed current season)
- [ ] 5. Run `python scripts/ingest.py --all` (seed 2020-2024 historical)
- [ ] 6. Verify data: query `SELECT count(*) FROM qb_season_stats` (expect ~180+ rows per season)
- [ ] 7. Run `npm run build` locally — confirm no errors
- [ ] 8. Run `npx tsc --noEmit` — confirm no type errors
- [ ] 9. Run `python -m pytest tests/` — confirm all tests pass

## Deploy

- [ ] 10. Push to GitHub `main` branch
- [ ] 11. Connect repo to Vercel
- [ ] 12. Add environment variables in Vercel dashboard:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `REVALIDATE_SECRET`
- [ ] 13. Trigger deploy, verify build succeeds
- [ ] 14. Add GitHub Actions secrets:
  - `DATABASE_URL` (Supabase connection string)
  - `SITE_URL` (e.g., `https://yardsperpass.com`)
  - `REVALIDATE_SECRET` (same as Vercel)

## Post-Deploy Verification

- [ ] 15. Visit site — confirm teams scatter plot loads with data
- [ ] 16. Visit QB leaderboard — confirm table populates
- [ ] 17. Switch seasons — confirm data changes
- [ ] 18. Test on mobile (iOS Safari, Android Chrome)
- [ ] 19. Test touch interactions on iPad (scatter plot tooltip)
- [ ] 20. Check OG image: paste URL in Twitter/Slack, confirm preview card
- [ ] 21. Run `workflow_dispatch` on data-refresh workflow — confirm it completes
- [ ] 22. Verify ISR revalidation: check Vercel function logs for `/api/revalidate`
- [ ] 23. Check Vercel Analytics dashboard — confirm pageviews appearing

## Domain (if applicable)

- [ ] 24. Purchase/configure `yardsperpass.com` domain
- [ ] 25. Add domain in Vercel project settings
- [ ] 26. Verify DNS propagation and HTTPS certificate
