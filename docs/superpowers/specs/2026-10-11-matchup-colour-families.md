# Colour families on the matchup card and page (revision 2)

Date: 2026-10-10. Status: **approved (spec review 2, 2026-10-10) and built on branch `feat/matchup-colour-families`; see §11 "As built".** Written against `origin/main` `b05d9f8`. The review's three required builder notes and its smaller notes are applied in this copy and marked **[review 2]**.
Amends the matchup card spec `2026-10-11-matchup-card-design.md` §5.2, §5.4 and §5.5, and closes "chaos 1" in the team matchup spec `2026-10-10-team-matchup-design.md` §21.9.

## Changelog

- **Revision 2 (this file).** The owner clarified: "I didn't want the red line going between the two radars, I am ok if one of the teams has red radar lines". The red lines he meant were the rank-gap bars, already gone on both surfaces. So revision 1's second decision is **withdrawn**: there is no separate radar colour, no look-ahead in the chain and no grey or ink stand-in. A team is one colour everywhere, as today, and may be red. What is left is one change: the "alike" test sorts colours into families.
- An independent reviewer was partway through revision 1 when it was withdrawn and gave no verdict. Their interim notes (`spec-review-1-notes.md`) are folded in here; §10 maps each one. The reviewer is to be pointed at this revision.
- Revision 1 is kept beside this file as `rev1-spec-colour-families.md`, with `rev1-colour_ref.py` and `rev1-build_sheet.py`. Its `variant-*.json` files are stale.

Evidence, all in the session scratch folder `scratchpad/colour-families/` (not in the repo; the durable record is this file, the committed reference and the golden):

| File | What |
|---|---|
| `colour_ref.py` | The new Python reference and proof. `py -3 -I colour_ref.py teams.ts pairs.json --today golden-today.json`. Comparison flags: `--dark 23`, `--no-red-orange`, `--purple-from 237`, `--ring-plain` |
| `proof-report.txt` | Its full output: families, margins, zeros, all 53 changed pairs, named pairs |
| `pairs.json` | All 992 ordered pairs under the new rule: the candidate golden, same eight fields as today's (sha256 `b5883050…cab1`, provisional until the committed reference writes it) |
| `golden-today.json` | Today's golden from `origin/main` (sha256 `ce10dda1…b747`) |
| `colour-families-sheet.html` | Contact sheet: the 53 changed pairs before and after, 6 "stays allowed" pairs, the 32-team table |
| `sheet-desktop.png`, `sheet-375.png` | Renders. `sheet-375.png` is the first 16,000 px of a 25,300 px page (Chrome's image limit); the checks ran on the whole page at 320, 375 and 1280 px |
| `v2-*.json`, `diff_variant.py` | The comparison runs |

## 1. What changes

"both teams shouldn't be in blue etc": a few pairs still come out as two blues. Every team colour is sorted into a colour family, and two colours of one family never share a card or a matchup page. The chain, the darkening, the neutrals, the 5 px stripe and the away-first order ("team colors can depend on who is home") are exactly today's.

**One file of code changes: `lib/stats/matchup-colours.ts`.** §7 confirms that from the code.

## 2. Families: `colourFamily(hex)`

A pure function of one `#RRGGBB` colour, from three measurements:

- `L` and chroma `C = hypot(a, b)` from `labOf` (unchanged).
- **Wheel hue** `H`: the colour-wheel hue (HSV / HSL), 0 to 360, from the integer channels. `d = max − min`; if `d = 0`, 0; if `max = R`, `(60 × (G − B) / d) mod 360`; if `max = G`, `60 × (B − R) / d + 120`; else `60 × (R − G) / d + 240`. New export `wheelHue(hex)`.

Why the wheel hue and not the CIELAB hue angle the old test used: in CIELAB pure red `#AA0000` is at 39.9° and Cleveland's orange `#FF3C00` at 44.2° (a cut would have 2.1° each side), and Baltimore is 5.8° from Minnesota. On the wheel those gaps are 14.1° and 18.0°.

Tested in this order:

| # | Test | Family |
|---|---|---|
| 1 | `C < 8.8` and `L < 35` | `black` |
| 2 | `C < 8.8` and `L >= 90` | `white` |
| 3 | `C < 8.8` | `grey` |
| 4 | `7 <= H < 70` and `L < 30` | `brown` |
| 5 | `H < 7` or `H >= 306` | `red` |
| 6 | `H < 33.5` | `orange` |
| 7 | `H < 70` | `gold` |
| 8 | `H < 172` | `green` |
| 9 | `H < 195` | `teal` |
| 10 | `H < 257` | `blue` |
| 11 | else | `purple` |

Exported constants, each named in a test: `COLOUR_NEUTRAL_MAX_CHROMA = 8.8`, `COLOUR_BLACK_MAX_L = 35`, `COLOUR_WHITE_MIN_L = 90`, `COLOUR_BROWN_MAX_L = 30`, `COLOUR_HUE_CUTS = { orange: 7, gold: 33.5, green: 70, teal: 172, blue: 195, purple: 257, red: 306 }`. Type `ColourFamily`, the eleven names above.

### 2.1 Margins

Nearest of the 64 team colours and their darkened forms to each cut. The hue rows count only colours whose family is decided by hue (chroma ≥ 8.8 and not brown). Colours decided earlier can sit near a hue cut harmlessly: Cleveland's brown is 2.0° above 33.5, Dallas's silver 0.9° below 195, Indianapolis's 1.4° above it.

| Cut | Value | Nearest below | Nearest above |
|---|---|---|---|
| red \| orange | 7° | `#D50A0A` 0.0° (7.00) | `#FF3C00` 14.1° (7.12) |
| orange \| gold | 33.5° | `#FF7900` 28.5° (5.03) | `#CC8200` 38.2° (4.74) |
| gold \| green | 70° | `#FFC20E` 44.8° (25.2) | `#69BE28` 94.0° (24.0) |
| green \| teal | 172° | `#203731` 164.3° (7.65) | `#008E97` 183.6° (11.6) |
| teal \| blue | 195° | `#006778` 188.5° (6.50) | `#03202F` 200.5° (5.45) |
| blue \| purple | 257° | `#241773` 248.5° (8.52) | `#4F2683` 266.5° (9.45) |
| purple \| red | 306° | `#4F2683` 266.5° (39.6) | `#97233F` 345.5° (39.5) |
| has a hue (chroma) | 8.8 | `#101820` 6.83 (1.97) | `#203731` 10.76 (1.96) |
| black \| grey (L, neutrals) | 35 | `#101820` 7.8 (27) | `#8A9193` 59.7 (25) |
| brown (L, warm hues) | 30 | `#311D00` 12.8 (17) | `#C83803` 45.8 (16) |

**The tightest margins in the whole rule, in order. The first three are today's and are not changed by this spec:**

| # | Threshold | Nearest decisions | Margin | New? |
|---|---|---|---|---|
| 1 | Readable on white, 3.0 : 1 | `#AA9158` (49ers gold, darkened) 3.04 | 0.04 | no |
| 2 | Distance 40 | 39.9 (`#203731` / `#869397`) and 40.3 (`#203731` / `#8C9295`): Green Bay's green against two silvers | 0.1 / 0.3 | no |
| 3 | Very dark, L 25 | Bills `#00338D` 24.61, Rams `#003594` 25.82 | 0.39 / 0.82 | no |
| 4 | Chroma floor 8.8 | `#101820` 6.83, `#203731` 10.76 | 1.97 / 1.96 | yes |
| 5 | orange \| gold 33.5° | 28.5° / 38.2° | 5.03 / 4.74 | yes |

No value of the distance threshold has a real margin: between 37 and 43 the decisions are never more than 0.9 apart (list in `proof-report.txt`). It stays 40.

### 2.2 The 32 teams

`→` is `darkenToReadable`. Fifteen team colours are darkened, giving **12 distinct** hexes (PIT, GB and WAS share `#BF890E`; PHI and LV share `#8C9295`). None changes family. `lib/types` `Team` has `primaryColor` and `secondaryColor` only.

| Team | Primary | Family | Secondary | Family |
|---|---|---|---|---|
| ARI | `#97233F` | red | `#000000` | black |
| ATL | `#A71930` | red | `#000000` | black |
| BAL | `#241773` | **blue** | `#000000` | black |
| BUF | `#00338D` | blue | `#C60C30` | red |
| CAR | `#0085CA` | blue | `#101820` | black |
| CHI | `#0B162A` | blue | `#C83803` | orange |
| CIN | `#FB4F14` | orange | `#000000` | black |
| CLE | `#311D00` | brown | `#FF3C00` | orange |
| DAL | `#041E42` | blue | `#869397` | grey |
| DEN | `#FB4F14` | orange | `#002244` | blue |
| DET | `#0076B6` | blue | `#B0B7BC` → `#8D9296` | grey |
| GB | `#203731` | green | `#FFB612` → `#BF890E` | gold |
| HOU | `#03202F` | blue | `#A71930` | red |
| IND | `#002C5F` | blue | `#A2AAAD` → `#8A9193` | grey |
| JAX | `#006778` | teal | `#9F792C` | gold |
| KC | `#E31837` | red | `#FFB81C` → `#BF8A15` | gold |
| LA | `#003594` | blue | `#FFA300` → `#CC8200` | gold |
| LAC | `#0080C6` | blue | `#FFC20E` → `#B3880A` | gold |
| LV | `#000000` | black | `#A5ACAF` → `#8C9295` | grey |
| MIA | `#008E97` | teal | `#FC4C02` | orange |
| MIN | `#4F2683` | purple | `#FFC62F` → `#B38B21` | gold |
| NE | `#002244` | blue | `#C60C30` | red |
| NO | `#D3BC8D` → `#9E8D6A` | gold | `#101820` | black |
| NYG | `#0B2265` | blue | `#A71930` | red |
| NYJ | `#125740` | green | `#000000` | black |
| PHI | `#004C54` | teal | `#A5ACAF` → `#8C9295` | grey |
| PIT | `#FFB612` → `#BF890E` | gold | `#101820` | black |
| SEA | `#002244` | blue | `#69BE28` → `#59A222` | green |
| SF | `#AA0000` | red | `#B3995D` → `#AA9158` | gold |
| TB | `#D50A0A` | red | `#FF7900` → `#E66D00` | orange |
| TEN | `#0C2340` | blue | `#4B92DB` | blue |
| WAS | `#5A1414` | red | `#FFB612` → `#BF890E` | gold |

Counts: blue 16, gold 10, red 10, black 9, orange 6, grey 5, green 3, teal 3, brown 1, purple 1 (the reviewer's own script agrees on all 64).

### 2.3 The judgement calls

- **Navy is blue.** The owner's own example, the Giants' `#0B2265`, is a navy by lightness (L 16.3) and sits 2.8 L from the Titans' navy. Today's rule already treats most navies and sky blues as alike.
- **Baltimore's `#241773` is blue.** It is 248.5° on the wheel, between the Giants (224.7°) and the Vikings (266.5°). As blue it never sits beside a sky blue (BAL v CAR, TEN, LAC, DET, the pairs named). Against Minnesota it is alike by distance (11.2) either way. Measured with Baltimore purple (`--purple-from 237`): those eight pairs stay as they are.
- **Burgundy and cardinal are red.** The same reasoning as navy.
- **Gold and yellow are one family.** All of them fall between 38.2° and 44.8°; there is no gap to cut in.
- **Brown is its own family** (Cleveland only). Today the old hue test read brown as a dark gold or orange, so the Browns went orange against every gold or orange team. Now brown may sit beside orange or gold.
- **Green Bay, Chicago and Houston have a hue** (green, blue, blue), so GB at SEA stops being two greens.
- **Orange is its own family, and a red and an orange count as alike.** See §3.1.

## 3. "Alike": `coloursAlike(a, b)`

True when any one holds, tested in this order:

| Test | Constant | Rule |
|---|---|---|
| distance | `COLOUR_ALIKE_DISTANCE = 40` (unchanged) | `colourDistance(a, b) < 40` |
| both very dark | `COLOUR_DARK_MAX_L = 25` (unchanged) | both `L < 25` |
| same family | | `colourFamily(a) === colourFamily(b)` |
| red beside orange | | one is `red` and the other `orange` |

Removed: `COLOUR_FAMILY_MIN_CHROMA`, `COLOUR_FAMILY_MAX_HUE` and the pairwise hue test.

### 3.1 Red beside orange: measured both ways, recommended alike

| | Alike (recommended, built) | Not alike (`--no-red-orange`) |
|---|---|---|
| Pairs that change against today | **53** | 58 |
| Cards with a red beside an orange | **0** (6 today) | 18 |
| Every zero in §5 | holds | holds |
| KC at TB | `#BF8A15` / `#D50A0A`, as today | `#E31837` / `#E66D00`: red beside orange, 42.9 apart |
| TB at KC | `#D50A0A` / `#BF8A15`, as today | the same |
| ARI at CIN | `#97233F` / `#000000` (Bengals black) | `#97233F` / `#FB4F14`, as today |
| CLE at TB | `#311D00` / `#D50A0A`, as today | the same |
| DEN at KC | `#FB4F14` / `#BF8A15`, as today | the same |

The rule is not needed for the proof. It is recommended because it is closer to what the site does now: the old hue test already called most reds and oranges alike (Kansas City's red and Tampa Bay's orange were 29.6° apart, under its 30° limit), which is why KC at TB is gold beside red today. Without the rule that pair, and 17 more, become a red beside an orange. The 18 pairs it decides are KC at TB, and Arizona, Atlanta and Washington against Cincinnati, Denver, Cleveland, Chicago and Tampa Bay (`diff_variant.py v2-dark25-redorange.json v2-dark25.json`).

What it costs: the 6 cards that are a red beside an orange today (ARI at CIN, DEN, TB; ATL at TB; CIN and DEN at ARI) change, to black or navy.

### 3.2 "Very dark" stays 25

Revision 1 moved it to 23 for a reason that no longer exists. Re-evaluated on the bands alone:

- Every zero holds at 25 and at 23.
- At 23, 64 pairs change against today; at 25, 53. The 12 that differ are all Buffalo: at 23 the Bills stay blue beside a black, a brown, Green Bay's green or Washington's burgundy (BUF at LV `#00338D` / `#000000`); at 25 the other team takes its second colour (BUF at LV `#00338D` / `#8C9295`), exactly as today.
- The case for 23 is only tidiness: at 25 the Bills' blue (L 24.61) counts as very dark and the Rams' near-identical blue (L 25.82) does not.

Nothing needs it, the owner did not ask for it, and it moves 11 more pairs. **Left at 25.** The 0.39 margin is recorded in §2.1 and held by a test that lists the very dark colours by name (§8).

## 4. The chain and the ring

**`matchupCardColours(away, home)`: unchanged**, steps 1 to 5 as the card spec §5.3. Only the `coloursAlike` it calls is new.

One clarification so the junk-input behaviour stays what it is: **the chain's neutrals (slate `#64748B`, ink `#0F172A`) are tested by distance and very dark only, not by family, wherever they appear.** They are not team colours. Measured, both have a blue cast (chroma 14.5), so a family test would call slate alike every blue and alike ink. **[review 2, required note 3]** That covers step 4 (slate, then ink, as the home fallback) AND steps 2 and 3 when the away first choice is ink (both away colours unusable): without the second half an ink away colour would push a blue home team to its second colour (12 of the 90 junk mask cases in the existing test: both away colours junk against the Rams gave Rams gold instead of Rams blue). A private helper does it: `alikeInChain(a, b)` uses the family-free test (`alikeWithoutFamily`) whenever either colour is ink or slate, and `coloursAlike` otherwise; step 5 is as today. No real pair has a neutral anywhere, so the golden does not depend on this; the junk-input tests do, and every one of the 90 mask cases gives exactly the answer it gave before this change (pinned by a test).

The exported `coloursAlike` itself is NOT special-cased: called directly it says slate and ink are alike any blue. That is recorded in its doc comment so nobody "fixes" either side.

**`matchupRingColour(awayCardColour, homeCardColour)`** keeps its signature and still keys to the two card colours. "Close to amber" has to be restated, because it leaned on the pairwise hue test:

- Amber `#F59E0B` measures as gold (wheel 37.7°).
- **Close to amber: `coloursAlike(AMBER, c)` or `colourFamily(c) === "orange"`.** So: a gold, anything within 40 of amber, or an orange.
- The orange clause is what keeps the ring as it is today. Under the old test an orange was within 30° of amber; under families it is a different family, and Cincinnati's `#FB4F14` is 46 from amber. Without the clause (`--ring-plain`) 128 pairs whose colours do not change would switch from a grey ring to amber beside an orange.
- The lightness clause is dropped. It existed for Cleveland's brown, which is now its own family and 83 from amber. No colour under L 25 can be gold or orange (a warm colour under L 30 is brown) or within 40 of amber (L 72), so dropping it changes no answer for any colour.

Re-proved over 992 pairs: the ring is at least `MATCHUP_RING_MIN_DISTANCE = 30` from both card colours. Smallest 30.3 (CIN at MIA, grey beside Miami's teal, the same pair as today); amber's smallest is 56.7 (ARI at TB). Counts: **amber 629, grey 363** (today 637 / 355). On the 939 pairs whose colours do not change, the ring does not change either.

## 5. Proof (`proof-report.txt`)

| Check | Result |
|---|---|
| Ordered pairs | 992 |
| Card colours alike | **0** |
| Two colours of one family on a card | **0** (33 today: 32 two blues, GB at SEA two greens) |
| Neutral fallback reached (slate, ink or `closest`) | **0** |
| Unreadable on white | **0**; lowest 3.04 : 1 (`#AA9158`), as today |
| Band text contrast, lowest | 4.28 : 1 (white on `#0080C6`), as today |
| Ring under 30 from a card colour | **0**; floor 30.3 |
| Closest two colours on any card | 40.3 (GB at LV), as today |
| Pairs that change against today | **53 of 992** |
| Ring changes where the colours do not | 0 |
| Away gave way | 73 (today 71) |
| Distinct card colours | 47 (today 48) |
| Away from: primary / primary darkened / secondary / secondary darkened | 857 / 62 / 38 / 35 |
| Home from: primary / primary darkened / secondary / secondary darkened | 591 / 34 / 210 / 157 |

**Every zero holds. Nothing could not be made to hold.**

### 5.1 The 53 changed pairs

Per team (a pair counts for both): CAR 12, CLE 12, CHI 10, HOU 9, BAL 8, DET 6, LAC 6, LA 6, ARI 5, CIN 4, DEN 4, TEN 4, and 2 or fewer for TB, BUF, NYG, GB, NO, PIT, WAS, DAL, MIN, ATL, SEA.

| Group | Pairs | What happens |
|---|---|---|
| Two blues today | 32 | Carolina against BUF, LA, NYG, CHI, HOU, BAL; Baltimore against CAR, DET, LAC, TEN; Chicago and Houston against DET, LA, LAC, TEN, CAR. One team takes its second colour |
| Two greens today | 1 | GB at SEA: Packers gold, Seahawks navy |
| Cleveland | 12 | brown is its own family: Browns brown beside an orange or a gold, where today they go orange (CLE at CHI, CIN, DEN, GB, NO, PIT, WAS; CIN, DEN, NO, PIT, WAS at CLE) |
| A red beside an orange today | 6 | ARI at CIN, DEN, TB; ATL at TB; CIN at ARI; DEN at ARI |
| Dallas and Minnesota | 2 | DAL at MIN and MIN at DAL become navy beside purple (40.6 apart), where today Minnesota or Dallas takes a second colour. The old test had the two hues 26.8° apart; New England, Seattle and Tennessee are navy beside Vikings purple today already |

The full list with hexes is in `proof-report.txt` ("ALL CHANGED PAIRS") and every one is a frame on the sheet.

### 5.2 Named pairs (away / home)

| Pair | Today | New | Ring |
|---|---|---|---|
| BUF at LA | `#00338D` / `#CC8200` | unchanged | grey |
| LA at BUF | `#003594` / `#C60C30` | unchanged | amber |
| CAR at BUF | `#0085CA` / `#00338D` | `#0085CA` / `#C60C30` | amber |
| BUF at CAR | `#00338D` / `#0085CA` | `#C60C30` / `#0085CA` (away gave way) | amber |
| CAR at LA | `#0085CA` / `#003594` | `#0085CA` / `#CC8200` | grey (was amber) |
| CAR at NYG | `#0085CA` / `#0B2265` | `#0085CA` / `#A71930` | amber |
| NYG at CAR | `#0B2265` / `#0085CA` | `#A71930` / `#0085CA` (away gave way) | amber |
| BAL at CAR | `#241773` / `#0085CA` | `#000000` / `#0085CA` (away gave way) | amber |
| LAC at BAL | `#0080C6` / `#241773` | `#0080C6` / `#000000` | amber |
| TEN at BAL | `#4B92DB` / `#241773` | `#4B92DB` / `#000000` | amber |
| DET at BAL | `#0076B6` / `#241773` | `#0076B6` / `#000000` | amber |
| KC at TB | `#BF8A15` / `#D50A0A` | unchanged | grey |
| TB at KC | `#D50A0A` / `#BF8A15` | unchanged | grey |
| TB at DAL | `#D50A0A` / `#041E42` | unchanged | amber |
| TB at ATL | `#D50A0A` / `#000000` | unchanged | amber |
| SF at SEA | `#AA0000` / `#002244` | unchanged | amber |
| ARI at SF | `#97233F` / `#AA9158` | unchanged | grey |
| BUF at NE | `#00338D` / `#C60C30` | unchanged | amber |
| NE at BUF | `#002244` / `#C60C30` | unchanged | amber |
| LAC at KC | `#0080C6` / `#E31837` | unchanged | amber |
| GB at SEA | `#203731` / `#59A222` | `#BF890E` / `#002244` (away gave way) | grey (was amber) |
| WAS at DAL | `#5A1414` / `#869397` | unchanged | amber |
| DAL at NE | `#041E42` / `#C60C30` | unchanged | amber |
| MIA at NYJ | `#008E97` / `#000000` | unchanged | amber |
| DET at NYG | `#0076B6` / `#A71930` | unchanged | amber |

### 5.3 What stays allowed

Different families that may still share a card, each shown on the sheet for a veto:

- **Orange beside gold:** 12 cards (16 today; the 4 Cleveland ones become brown beside gold). Cincinnati and Denver against KC, SF, WAS, PIT, NO.
- **Brown beside a red:** 14 cards, the same 14 as today (Cleveland with ARI, ATL, BUF, HOU, KC, NE, NYG, SF, TB).
- **Brown beside orange or gold:** 5 and 7 cards, new (§5.1).
- **Navy or blue beside Vikings purple:** 18 cards (16 today).
- **A red team in red**, band and radar: unchanged.

## 6. Tests

**The golden** `__tests__/stats/fixtures/matchup-card-colours.expected.json` is regenerated by the committed reference `docs/superpowers/specs/matchup-card-reference/colour_ref.py`, which is replaced by the scratch `colour_ref.py` with the comparison flags and the report cut back to today's asserts. **[review 2, note 9]** The committed reference uses §4's ring wording (no lightness clause) and no longer writes a `-closest` suffix into `homeFrom`. Same eight fields. **A deliberate rule change: the one other reason, besides `teams.ts`, to re-capture it.** Run the reference twice and confirm the same bytes.

**The sha `ce10dda1…b747` is pinned in 4 files, 7 places; all take the new one:**

| File | Places |
|---|---|
| `__tests__/stats/matchup-colours.test.ts` | 2: the comment on line 11, `GOLDEN_SHA256` on line 46 |
| `docs/superpowers/specs/2026-10-11-matchup-card-design.md` | 3 |
| `docs/superpowers/specs/2026-10-10-team-matchup-design.md` | 1 |
| `memory/MEMORY.md` | 1 |

`.claude/CLAUDE.md` does not hold the hash and is not given it.

**Pinned tests, one line each.** The pairs each one names were checked against the 53 changed pairs:

| Test | Lines | Pairs | Verdict |
|---|---|---|---|
| `matchup-colours.test.ts` | 26-27, 66-71 | constants | **changes**: the two removed constants and their imports go; the new ones are asserted; `COLOUR_DARK_MAX_L` stays 25 |
| | 148-188 | `coloursAlike` branches | **changes**: `#64748B` / `#00338D` (line 179) is now alike, because slate measures blue; the hue-family cases (lines 172-181) are replaced by one per rule (§6 new 3). The distance and very-dark cases stand (`#2F2F2F` is black and `#8F8F8F` grey, so still not alike) |
| | 191-205 | ring | **changes**: line 203's `coloursAlike(AMBER, "#311D00")` is now false; the four ring answers are the same |
| | 277-297 | 21 named pairs | **2 change**: CLE at CHI becomes `#311D00` primary / `#C83803` secondary, grey, rules `#FF3C00` / `#0B162A`, not switched; HOU at TEN becomes `#A71930` secondary / `#0C2340` primary, amber, rules `#03202F` / `#4B92DB`, switched. The other 19 unchanged |
| | 309-312 | CIN at DEN, BUF at LA stripes | unchanged, checked |
| | 332-341 | counts | **changes** **[review 2, note 4]**: the test counts home sources only where the away team did NOT switch, so its numbers are not §5's overall ones: switched 73; not switched and home primary 524, secondary 205, secondary darkened 156, primary darkened 34; away primary 857, primary darkened 62; amber 629, grey 363; 47 distinct colours; closest pair 40.3 |
| | 353-423 | junk input | **one line changes** **[review 2, required note 2]**: line 423 (four colours all `#00338D`: home is slate) asserted `coloursAlike(away, home)` false, and the public function now says slate is alike a blue. It becomes a distance assertion (`colourDistance >= COLOUR_ALIKE_DISTANCE`), `homeFrom` stays `"grey"`. Everything else in the block holds by §4's neutral clause |
| `matchup-card.test.ts` | 254-266, 509, 658-663 | K8 sentences, BUF at HOU, BUF at LA | unchanged, checked (BUF at HOU is `#00338D` / `#A71930` before and after) |
| `matchup-card-image.test.tsx` | 72, 284-313 | `NEUTRALS`, BUF at LA, TB at DAL, KC at TB | unchanged, checked. **[review 2, required note 1]** The fourth test of that block, lines 291-298 (ARI at TB, "Tampa Bay in orange with its own red as its 5 px rule"), and its case label on line 30 **change**: ARI at TB is one of the 53 (now Cardinals black `#000000` / Buccaneers red `#D50A0A`, rules `#97233F` / `#FF7900`, amber ring). The test is rewritten for that answer, and the idea it protected (a team's unused red appears only as its 5 px rule) moves to a new NE at DAL test (`#002244` / `#869397`, away rule `#C60C30`) |
| `matchup-card-page.test.tsx` | 326-333, 375 | K8 for the Rams, Steelers, Saints; BUF/LA, TB/DAL, KC/TB, WAS/JAX | unchanged, checked |
| `matchup-route.test.tsx` | 600-611, 672-678, 725-758 | the 12-pair table and its literals | unchanged, checked: none of the 12 is among the 53 |
| `MatchupHeader.test.tsx` | 82-96, 185 | BUF at LA, LA at BUF, PIT at LA, TB at LA | unchanged, checked |
| `MatchupPlayers.test.tsx` | 91-113 | BUF at DET, PIT at DET | unchanged, checked |
| `guards.test.ts` | 150-170, 300-316 | one call, type-only imports, bundle walk | unchanged: the new exports are not imported by any component |

"Checked" means the pair is not in the changed list and its ring is the same; the K8 lines were not opened one by one, so the builder runs the suite before touching them.

**New tests:**

1. **Family table:** all 64 team colours and the 12 distinct darkened hexes against literal family names (§2.2); no darkened colour changes family; the counts (blue 16, gold 10, red 10, black 9, orange 6, grey 5, green 3, teal 3, brown 1, purple 1).
2. **Margins, so a team-colour edit that lands near a cut fails loudly:** every colour whose family is decided by hue (chroma ≥ 8.8 and not brown) is at least 4° from every hue cut; no colour's chroma is within 1.5 of 8.8; the colours under L 25 are exactly a literal list (so the Bills' 0.39 is held by name, not by a tolerance); the brown and black | grey cuts have at least 10.
3. **`coloursAlike`, one case per rule and its edge** (**[review 2, note 9]** every "true by family" case also asserts the pair is 40 or more apart and not both very dark, so it isolates the family rule; Bills blue beside Baltimore indigo did not, both being under L 25, and is replaced by Baltimore indigo beside Carolina's sky blue)**:** navy and sky blue (true), Baltimore indigo and sky blue (true), burgundy and Chiefs red (true), two golds (true), brown and orange (false), brown and gold (false), red and orange (true: `#E31837` / `#E66D00`, 42.9 apart), orange and gold over 40 apart (false: `#FB4F14` / `#BF8A15`), navy and Vikings purple (false: `#002244` / `#4F2683`, 42.8), symmetry over all team colours.
4. **992-pair table:** equals the golden on all eight fields; no card alike; **no card with two colours of one family; no red beside an orange**; all readable; ring ≥ 30; `closest` false; sources never `grey` or `ink`.
5. **Named pairs with literal hexes:** the 25 of §5.2 plus CLE at CHI, HOU at TEN, ARI at CIN, CLE at TB, DEN at KC, DAL at MIN.
6. **Ring:** an orange gets grey (`#FB4F14`); Cleveland's brown keeps amber with no lightness clause; amber 629 / grey 363.
7. **Purity and bundle:** the existing tests keep holding (`matchup-colours.ts` imports only `contrastOnWhite` / `RADAR_MIN_STROKE_CONTRAST`; no `"use client"` file reaches it; components import its types only).

## 7. No model, image or component code changes: confirmed from the code

- `lib/stats/matchup-card.ts` reads `colours.away`, `.home`, `.awayRule`, `.homeRule`, `.ring`, `.awayFrom`, `.homeFrom` (lines 303-307, 509-517, 576-588). The shape of `MatchupCardColours` does not change.
- `lib/og/matchup-card-image.tsx` reads the model's pane and band colours and `model.colours.ring` (lines 224-328); it calls nothing in the rule.
- `app/matchup/[away]/[home]/page.tsx` makes its one call on line 164 and builds the two paints on lines 233-235 from the same fields. `app/card/matchup/[away]/[home]/page.tsx` reads pane colours and `awayFrom` / `homeFrom` (lines 179-184, 274-275).
- `components/matchup/*` take strings and the type.
- The only importer of the two removed constants is `__tests__/stats/matchup-colours.test.ts` (lines 26-27). Nothing imports `coloursAlike` outside the rule and its test.

So the diff is: `lib/stats/matchup-colours.ts`, the Python reference, the golden, tests, docs.

## 8. Render and browser gates

- **Cards:** re-render with the harness in `scratchpad/matchup-card/render/` (`render.mjs`, patched `@vercel/og`): its 24 existing cases (of the pairs in their file names only `card-ARI-TB` changes, to Cardinals black and Buccaneers red; the others must come out pixel-identical to `out/`, and any that does not is a finding), plus CAR at BUF, BUF at CAR, CAR at NYG, BAL at CAR, GB at SEA, CLE at CIN, ARI at CIN, DAL at MIN. Pixel-scan gate (`scan.mjs`): lowest ink in rows 480-509 at row 506 or higher, bottom-left corner clear. No geometry changes.
- **Page** (headless Chrome over `next dev`, 375 and 1280 px, both tabs) on the same eight changed pairs: the two slabs differ and are not one family; tile bands and heading squares match their slab; the two radar shapes are the two slab colours; the ring is the golden's; ink or white text as `textColorForBackground`; the page is exactly as wide as the window. Plus BUF at LA and KC at TB as unchanged controls.
- The team-name box on the card: the harness's `card-WAS-JAX-long-names` case renders as before.

## 9. Docs, chaos, rollout, risks

**Docs to amend:** card spec §5.2 (the alike table), §5.4 (the ring's "close to amber"), §5.5 (counts and the two named rows), §15 (the pairs that differ by order: **160**, was 155 **[review 2, note 9]**) and its three copies of the hash; matchup spec §21.9 chaos 1 (closed: the hue-limit table is superseded) and its copy of the hash; `memory/MEMORY.md` lines 136 and 145 (the alike sentence, the hash, "Open, Jon decides" on the two-blue pairs closed); `.claude/CLAUDE.md` needs no change.

**Chaos list:** a colour exactly on each cut (wheel 7.0, 33.5, 70, 172, 195, 257, 306; chroma 8.8; L 25, 30, 35, 90) for the half-open edges; a pure grey (`d = 0`) through `wheelHue`; lower-case and mixed-case hex; junk colours on one or both teams with the masks today's test uses (same answers as today); both teams identical; a team whose two colours are one family; 1,000 random colour pairs never throw and always return `#RRGGBB`; the same call twice gives the same object; all 992 pairs over HTTP, both tabs, for two slabs of one family.

**One PR.** Rule, reference, golden, tests and docs together; there is nothing to stage.

**Risks:**

- **53 pairs change colour**, on the page and on stored share-card images at their next render. Old links keep working.
- **Baltimore is black against every sky-blue team** and is never labelled purple. A Ravens fan would say purple.
- **Six red-beside-orange cards change** because of §3.1. If the owner prefers them as they are, `--no-red-orange` is the switch, at the cost of KC at TB.
- **DAL v MIN becomes navy beside purple at 40.6**, a thin pass on two thresholds at once (distance 40, and the Vikings' purple is L 25.8 against the very-dark line of 25). It matches what NE, SEA and TEN against MIN are today. On the sheet.
- **The three tightest margins are inherited** (§2.1) and not improved here.
- The margins test (§6 new 2) is what catches a future `teams.ts` edit that lands on a cut.

## 10. Reviewer's interim notes, mapped

| Note | Where |
|---|---|
| B1 margins test scoped to hue-decided colours | §2.1 intro, §6 new 2 |
| B2 very dark 25 → 23 needs a reason | §3.2: not needed, left at 25, with the count |
| B3 the tightest margins stated in order | §2.1 second table |
| B4 red beside orange: the owner's call, show them | §3.1, §5.1, sheet |
| B5 orange beside gold stays allowed | §5.3, sheet |
| B6 brown beside red stays allowed | §5.3, sheet |
| A2 15 colours darkened, 12 distinct hexes | §2.2 |
| C sha in 4 files, 7 places; not in CLAUDE.md | §6 |
| C pinned tests not listed in revision 1 | §6 table |
| C constants tests, imports, ring lines 203-205 | §6 table |
| C the ring must be redefined | §4 |
| D bundle rule | §6 new 7, §7 |
| E items dropped with decision 2 | not carried forward |

## 11. As built (2026-10-10, branch `feat/matchup-colour-families`, one PR)

**Code: one file, `lib/stats/matchup-colours.ts`.** New exports `wheelHue`, `colourFamily`, type `ColourFamily`, `COLOUR_NEUTRAL_MAX_CHROMA`, `COLOUR_BLACK_MAX_L`, `COLOUR_WHITE_MIN_L`, `COLOUR_BROWN_MAX_L`, `COLOUR_HUE_CUTS`; removed `COLOUR_FAMILY_MIN_CHROMA`, `COLOUR_FAMILY_MAX_HUE`. Private: `alikeWithoutFamily`, `alikeInChain`. `matchupCardColours` is unchanged except that its two "alike" calls go through `alikeInChain`. `wheelHue` adds 360 before the final `% 360` on the red branch (JavaScript's `%` keeps the sign; Python's does not). No model, image, page or component file changed; no new dependency; the file still imports only the contrast rule.

**Reference and golden.** `docs/superpowers/specs/matchup-card-reference/colour_ref.py` is the scratch reference cut back to the rule and its asserts (plus two new asserts: no card with two colours of one family, none with a red beside an orange). Run twice, both runs and the scratch candidate hash to `b58830503e606d9d082cfac5989337a3058ecc796b4a8afbd3bf0ce77453cab1`; the TypeScript equalled the golden on its first run. The sha is updated in its four files, seven places.

**Test-first.** Commit 1 holds the reference, the golden and the tests, with 47 tests failing against the old rule; commit 2 is the rule.

**Tests added or changed** (`__tests__/stats/matchup-colours.test.ts`, `__tests__/og/matchup-card-image.test.tsx`): the constants; `wheelHue`; the 64-colour family table, its counts and the 12 darkened hexes; the order of the family tests; the margins (hue 4°, chroma 1.5, the 14 very dark colours by name, lightness 10); one `coloursAlike` case per rule, each family case also 40+ apart and not both dark; symmetry over all 60 distinct team colours; the ring (amber is a gold, an orange gets grey, brown keeps amber, no very dark team colour is close to amber); over the 992 pairs: no two of one family, no red beside an orange, the "stays allowed" counts (12 / 14 / 5 / 7 / 18), 160 matchups that differ by order; 45 named pairs (the old 21 with CLE at CHI and HOU at TEN updated, plus 24); the totals of review note 4 and §5's overall sources; junk input: line 423 as a distance assertion, "both away colours junk, home the Rams = ink and Rams blue", and a literal table of all 15 junk masks captured from the rule as it was (every one unchanged); the ARI at TB image test rewritten and NE at DAL added.

**Differences from the text above:**

1. The render gate's new pairs were CAR at BUF, BUF at CAR, CAR at NYG, BAL at CAR, LAC at BAL, GB at SEA, CLE at CIN, DAL at MIN (ARI at TB is one of the harness's own 24), not §8's list (no ARI at CIN). The page gate ran CAR/BUF, BUF/CAR, CAR/NYG, BAL/CAR, GB/SEA, CLE/CIN, DAL/MIN and the controls BUF/LA and KC/TB.
2. §8 says the 23 other harness PNGs "must come out pixel-identical to `out/`". They are not byte-identical to that saved folder, and the reason is not this change: `out/` was rendered before the name-box fix (PR #46, 32 → 40 px), so its team names have clipped tops. Compared with a same-day render of the same harness from `origin/main`'s rule (the one file swapped back, then restored), exactly one of the 24 differs: `card-ARI-TB.png`. All 8 new pairs differ from their `origin/main` renders, as they should.
3. `.claude/CLAUDE.md` is amended after all (the owner asked for it): its one sentence on the colour golden now names the second legitimate reason to re-capture and the families. It still does not hold the hash.
4. Card spec §15 listed "12 division pairs" whose colours differ by order. By the same count that gives 155 for the old golden, the old number was 17 (the list left out ATL/NO, CAR/NO, CIN/PIT, CLE/PIT and NO/TB, where the Saints' or Steelers' gold is darkened as the away team and replaced by black as the home team). Under the new rule it is 15; the row now lists them. The "same hex on both cards" pairs go from 8 to 9 (ARI/CIN joins: black).

**Gates.** vitest 3904 tests / 122 files (was 3838 / 122; full run green with `--maxWorkers=6`, the first full run had the two known timing-out tests, `matchup.test.ts` "gapBar…" and `TeamRadar.test.tsx` "every one of the 32 teams…", which pass alone and in the rerun); `tsc --noEmit` clean; `next lint` clean (the four old warnings); placeholder-env `next build` green; pytest 824 passed, 20 skipped, 1 xfailed (unchanged). Cards: 32 PNGs rendered (24 + 8), pixel scan PASS on all (lowest ink in rows 480-509 = row 506, corner clear). Page: headless Chrome over `next dev` with live data, 9 pairs × 375 and 1280 px × both tabs = 36 loads, each checked against the golden: slab colours and stripes, ink or white slab text (contrast 4.28 or better), heading squares and tile bands, the offense and defense shapes, dots and squares in the two slab colours, the ring and its word in the note, the legend, no gap bars, and the page exactly as wide as the window. 36 of 36 pass.

**Not done here:** the chaos pass and the code review (the owner's quality gates, run after this build), and a Vercel preview of the card image.
