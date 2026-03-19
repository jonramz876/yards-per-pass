# SEO Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring SEO from 5/10 to 9+/10 by fixing domain references, adding dynamic OG images, adding JSON-LD structured data, and fixing metadata gaps.

**Architecture:** Fix `sitemap.ts` and `robots.ts` to use env var for domain. Add co-located `opengraph-image.tsx` files using Next.js `ImageResponse` API for dynamic OG images. Add JSON-LD structured data to root layout. Fix double-suffix titles and missing descriptions.

**Tech Stack:** Next.js 14 App Router, `next/og` (ImageResponse/Satori), schema.org JSON-LD.

**Spec:** `docs/superpowers/specs/2026-03-18-seo-improvements-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `app/opengraph-image.tsx` | Default OG image — site name + tagline (1200×630, covers /, /privacy, /glossary) |
| `app/teams/opengraph-image.tsx` | Teams page OG image — "NFL Team Tiers" + season |
| `app/qb-leaderboard/opengraph-image.tsx` | QB Leaderboard OG image — "QB Rankings" + season |
| `app/run-gaps/opengraph-image.tsx` | Run Gaps OG image — "Run Gap Analysis" + team/season |

### Modified Files
| File | Changes |
|------|---------|
| `app/sitemap.ts` | Replace hardcoded `yards-per-pass.vercel.app` with `process.env.NEXT_PUBLIC_SITE_URL` |
| `app/robots.ts` | Replace hardcoded `yards-per-pass.vercel.app` with `process.env.NEXT_PUBLIC_SITE_URL` |
| `app/layout.tsx` | Remove static `openGraph.images` and `twitter.images`; add JSON-LD script block |
| `app/privacy/page.tsx` | Fix double-suffix title; add `description` |
| `app/glossary/page.tsx` | Fix double-suffix title |
| `app/run-gaps/page.tsx` | Fix double-suffix title in `generateMetadata` |

### Deleted Files
| File | Reason |
|------|--------|
| `public/og-image.png` | Replaced by dynamic `opengraph-image.tsx` files |

---

## Task 1: Fix domain in sitemap.ts and robots.ts

**Files:**
- Modify: `app/sitemap.ts`
- Modify: `app/robots.ts`

- [ ] **Step 1: Fix sitemap.ts**

In `app/sitemap.ts`, change line 5 from:

```typescript
const base = "https://yards-per-pass.vercel.app";
```

to:

```typescript
const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
```

- [ ] **Step 2: Fix robots.ts**

In `app/robots.ts`, change line 10 from:

```typescript
sitemap: "https://yards-per-pass.vercel.app/sitemap.xml",
```

to:

```typescript
sitemap: `${process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com"}/sitemap.xml`,
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/sitemap.ts app/robots.ts
git commit -m "fix: use NEXT_PUBLIC_SITE_URL in sitemap and robots instead of hardcoded vercel URL"
```

---

## Task 2: Fix double-suffix titles

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `app/glossary/page.tsx`
- Modify: `app/run-gaps/page.tsx`

The root layout has `template: "%s — Yards Per Pass"`, so page titles should NOT include `| Yards Per Pass` — that creates "Privacy Policy | Yards Per Pass — Yards Per Pass" in the browser tab.

- [ ] **Step 1: Fix privacy page title and add description**

In `app/privacy/page.tsx`, change lines 4-6 from:

```typescript
export const metadata: Metadata = {
  title: "Privacy Policy | Yards Per Pass",
};
```

to:

```typescript
export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for Yards Per Pass, an NFL analytics website.",
};
```

- [ ] **Step 2: Fix glossary page title**

In `app/glossary/page.tsx`, change line 5 from:

```typescript
  title: "NFL Analytics Glossary | Yards Per Pass",
```

to:

```typescript
  title: "NFL Analytics Glossary",
```

- [ ] **Step 3: Fix run-gaps page title**

In `app/run-gaps/page.tsx`, change line 43 from:

```typescript
    title: `${teamName} Run Gap Analysis ${s} | Yards Per Pass`,
```

to:

```typescript
    title: `${teamName} Run Gap Analysis ${s}`,
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/privacy/page.tsx app/glossary/page.tsx app/run-gaps/page.tsx
git commit -m "fix: remove double-suffix from page titles (layout template already appends site name)"
```

---

## Task 3: Add JSON-LD structured data to root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Add JSON-LD script to layout**

In `app/layout.tsx`, add a JSON-LD `<script>` tag as the first child inside `<body>`, before `<TooltipProvider>`. Insert after line 47 (`<body className="min-h-screen bg-white flex flex-col">`):

```tsx
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "WebSite",
                  name: "Yards Per Pass",
                  url: process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com",
                  description:
                    "NFL analytics dashboard with EPA, CPOE, success rate, and run gap analysis.",
                },
                {
                  "@type": "Organization",
                  name: "Yards Per Pass",
                  url: process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com",
                },
              ],
            }),
          }}
        />
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: add JSON-LD structured data (WebSite + Organization) to root layout"
```

---

## Task 4: Create default OG image (root)

**Files:**
- Create: `app/opengraph-image.tsx`
- Modify: `app/layout.tsx` (remove static OG image references)

- [ ] **Step 1: Create root opengraph-image.tsx**

Create `app/opengraph-image.tsx`:

**Note:** `opengraph-image.tsx` files are static per-route — they don't receive `searchParams`. Dynamic season/team content would require a custom API route approach. Static route-level images are the right trade-off here: each page gets a branded card identifying the section.

```tsx
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Yards Per Pass — NFL Analytics Dashboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

export default async function Image() {
  const fontData = await interBold;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#94a3b8",
            marginBottom: 12,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          yardsperpass.com
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 800,
            color: "#ffffff",
            marginBottom: 16,
          }}
        >
          Yards Per Pass
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#94a3b8",
          }}
        >
          NFL Analytics — EPA, CPOE, and more
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
```

- [ ] **Step 2: Remove static OG image references from layout.tsx**

In `app/layout.tsx`, remove the `openGraph.images` array (lines 25-32) and the `twitter.images` line (line 36). The metadata should become:

```typescript
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com"),
  title: {
    default: "Yards Per Pass — NFL Analytics, Simplified",
    template: "%s — Yards Per Pass",
  },
  description:
    "Free NFL analytics dashboard with EPA, CPOE, success rate, and more. Clean, fast, no paywall.",
  openGraph: {
    type: "website",
    siteName: "Yards Per Pass",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
};
```

- [ ] **Step 3: Delete the old static OG image**

```bash
git rm public/og-image.png
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/opengraph-image.tsx app/layout.tsx
git commit -m "feat: add dynamic root OG image, remove static og-image.png"
```

---

## Task 5: Create teams page OG image

**Files:**
- Create: `app/teams/opengraph-image.tsx`

- [ ] **Step 1: Create teams opengraph-image.tsx**

Create `app/teams/opengraph-image.tsx`:

```tsx
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "NFL Team Tiers — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

export default async function Image() {
  const fontData = await interBold;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#94a3b8",
            marginBottom: 12,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Yards Per Pass
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 60,
            fontWeight: 800,
            color: "#ffffff",
            marginBottom: 16,
          }}
        >
          NFL Team Tiers
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "#94a3b8",
          }}
        >
          EPA efficiency rankings across all 32 teams
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: "#64748b",
            marginTop: 24,
          }}
        >
          yardsperpass.com/teams
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/teams/opengraph-image.tsx
git commit -m "feat: add dynamic OG image for /teams page"
```

---

## Task 6: Create QB leaderboard OG image

**Files:**
- Create: `app/qb-leaderboard/opengraph-image.tsx`

- [ ] **Step 1: Create qb-leaderboard opengraph-image.tsx**

Create `app/qb-leaderboard/opengraph-image.tsx`:

```tsx
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "QB Rankings — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

export default async function Image() {
  const fontData = await interBold;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#94a3b8",
            marginBottom: 12,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Yards Per Pass
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 60,
            fontWeight: 800,
            color: "#ffffff",
            marginBottom: 16,
          }}
        >
          QB Rankings
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "#94a3b8",
          }}
        >
          EPA, CPOE, success rate, and 20+ metrics for every starter
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: "#64748b",
            marginTop: 24,
          }}
        >
          yardsperpass.com/qb-leaderboard
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/qb-leaderboard/opengraph-image.tsx
git commit -m "feat: add dynamic OG image for /qb-leaderboard page"
```

---

## Task 7: Create run-gaps OG image

**Files:**
- Create: `app/run-gaps/opengraph-image.tsx`

- [ ] **Step 1: Create run-gaps opengraph-image.tsx**

Create `app/run-gaps/opengraph-image.tsx`:

```tsx
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Run Gap Analysis — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

export default async function Image() {
  const fontData = await interBold;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#94a3b8",
            marginBottom: 12,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Yards Per Pass
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 60,
            fontWeight: 800,
            color: "#ffffff",
            marginBottom: 16,
          }}
        >
          Run Gap Analysis
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "#94a3b8",
          }}
        >
          Rushing EPA by offensive line gap — find the matchup edges
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: "#64748b",
            marginTop: 24,
          }}
        >
          yardsperpass.com/run-gaps
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/run-gaps/opengraph-image.tsx
git commit -m "feat: add dynamic OG image for /run-gaps page"
```

**Note:** Favicon already exists at `app/favicon.ico` — no action needed. `not-found.tsx` was reviewed per spec — it doesn't support metadata exports in Next.js 14, and the root layout default title is acceptable for 404 pages.

---

## Task 8: Final verification

- [ ] **Step 1: Full build check**

```bash
npx next build
```

Expected: Build succeeds with no errors. All pages generate. OG images are generated for each route.

- [ ] **Step 2: Verify OG images work locally**

```bash
npx next dev
```

Then open these URLs in a browser to confirm the OG images render:
- `http://localhost:3000/opengraph-image` (root)
- `http://localhost:3000/teams/opengraph-image` (teams)
- `http://localhost:3000/qb-leaderboard/opengraph-image` (QB leaderboard)
- `http://localhost:3000/run-gaps/opengraph-image` (run gaps)

Each should show a 1200×630 dark navy image with white text.

- [ ] **Step 3: Verify JSON-LD in page source**

View source on `http://localhost:3000` and confirm the `<script type="application/ld+json">` block is present with WebSite and Organization schema.

- [ ] **Step 4: Verify sitemap uses correct domain**

Open `http://localhost:3000/sitemap.xml` and confirm all URLs start with the correct domain (not `yards-per-pass.vercel.app`).

- [ ] **Step 5: Verify page titles are correct**

Check browser tabs on each page to confirm no double-suffix:
- Privacy: "Privacy Policy — Yards Per Pass" (not "Privacy Policy | Yards Per Pass — Yards Per Pass")
- Glossary: "NFL Analytics Glossary — Yards Per Pass"
- Run Gaps: "[Team] Run Gap Analysis [Year] — Yards Per Pass"
