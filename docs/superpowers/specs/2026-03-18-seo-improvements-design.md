# SEO Improvements — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Context:** 10-team review scored SEO at 5/10, flagging missing dynamic OG tags, stale domain references, and metadata gaps.

## Overview

Bring SEO from 5/10 to 9+/10 by fixing the domain references, adding dynamic OG images per route, adding JSON-LD structured data, and filling metadata gaps across all pages.

## 1. Domain Fix (Critical)

**Problem:** `sitemap.ts` and `robots.ts` hardcode `yards-per-pass.vercel.app` instead of using the production domain.

**Fix:** Read from `process.env.NEXT_PUBLIC_SITE_URL` (same as `layout.tsx` already does). Fall back to `https://yardsperpass.com` if the env var is missing.

**Files:**
- `app/sitemap.ts`
- `app/robots.ts`

## 2. Dynamic OG Images

**Approach:** Use Next.js `ImageResponse` API (from `next/og`) to generate dynamic OG images at build/request time. Each route gets a co-located `opengraph-image.tsx` file that Next.js auto-discovers.

**Design:** All images share a consistent visual style:
- 1200×630px
- Dark background (#0f172a — matches site's navy theme)
- Site name "Yards Per Pass" at top
- Page-specific title large and centered
- Season context where applicable (e.g., "2024 Season")
- Subtle branding footer with domain

**Route-specific images:**

| Route | OG Title | Dynamic Content |
|-------|----------|----------------|
| `/` (root) | Default — site name + tagline | "NFL Analytics — EPA, CPOE, and more" |
| `/teams` | "NFL Team Tiers" | Season from searchParams |
| `/qb-leaderboard` | "QB Rankings" | Season from searchParams |
| `/run-gaps` | "Run Gap Analysis" | Team name if selected, season |
Privacy and glossary pages fall back to the root OG image (no route-specific OG file needed).

**Files to create:**
- `app/opengraph-image.tsx` (default/homepage — also covers privacy, glossary)
- `app/teams/opengraph-image.tsx`
- `app/qb-leaderboard/opengraph-image.tsx`
- `app/run-gaps/opengraph-image.tsx`

**Files to modify:**
- `app/layout.tsx` — remove static `openGraph.images` from root metadata (dynamic images override it)

**Cleanup:** Delete `public/og-image.png` after dynamic images are in place (no longer referenced).

**Note:** The `opengraph-image.tsx` convention auto-generates `<meta property="og:image">` tags. No manual metadata wiring needed. Next.js also generates `twitter:image` from the same file.

## 3. Structured Data (JSON-LD)

**Scope:** WebSite + Organization only (minimal, high-value).

**Implementation:** Add a `<script type="application/ld+json">` block to root layout.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "name": "Yards Per Pass",
      "url": "https://yardsperpass.com",
      "description": "NFL analytics dashboard with EPA, CPOE, success rate, and run gap analysis."
    },
    {
      "@type": "Organization",
      "name": "Yards Per Pass",
      "url": "https://yardsperpass.com"
    }
  ]
}
```

**File:** `app/layout.tsx` — add JSON-LD script in the `<body>` before children.

**Note:** The code block above shows example values. At runtime, all URLs are constructed from `process.env.NEXT_PUBLIC_SITE_URL` (falling back to `https://yardsperpass.com`), not hardcoded.

## 4. Metadata Gaps

**Privacy page** (`app/privacy/page.tsx`):
- Add `description` to metadata export: "Privacy policy for Yards Per Pass, an NFL analytics website."
- Fix double-suffix title: change `"Privacy Policy | Yards Per Pass"` to `"Privacy Policy"` (layout template already appends `- Yards Per Pass`)

**Glossary page** (`app/glossary/page.tsx`):
- Fix double-suffix title: change `"NFL Analytics Glossary | Yards Per Pass"` to `"NFL Analytics Glossary"`

**Run-gaps page** (`app/run-gaps/page.tsx`):
- Fix double-suffix title: remove `| Yards Per Pass` from `generateMetadata` return value

**Not-found page** (`app/not-found.tsx`):
- `not-found.tsx` does not support `export const metadata` in Next.js 14 App Router. Instead, set `<title>` via the `metadata` API in the parent layout's `not-found` segment, or simply leave it — the root layout template will apply `"Yards Per Pass"` as the default title, which is acceptable for a 404 page.

## 5. Favicon

`public/favicon.ico` does not exist. Create a simple favicon from the site's branding (navy background, white "YPP" text or football icon).

## Out of Scope

- Per-page structured data (SportsEvent, Dataset, etc.) — low ROI for interactive analytics
- Full social card previews with live data rendering
- Accessibility/WCAG improvements (per project preferences)
- SEO for future pages not yet built

## Implementation Notes

- All OG image files use `ImageResponse` from `next/og` (built into Next.js 14)
- `ImageResponse` uses Satori under the hood — supports a subset of CSS (flexbox only, no grid)
- Font loading in `ImageResponse` requires fetching the font file at build time (use Inter from Google Fonts CDN with version pin)
- The `size` and `contentType` exports are required alongside the default export function
- `alt` export provides the `og:image:alt` text
