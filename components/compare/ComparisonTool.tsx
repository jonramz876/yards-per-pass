// components/compare/ComparisonTool.tsx
"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { QBSeasonStat, ReceiverSeasonStat, RBSeasonStat } from "@/lib/types";
import {
  buildComparison, comparePoolSentence, compareTooFewSentence, compareSmallSampleSentence,
  compareNotDrawnSentences, compareRadarIsDrawn, compareChartMask, compareGroup,
  type CompareGroup,
} from "@/lib/stats/compare";
import { compareCardHref, compareImageHref, compareNoStatsMessage, parseCompareSlugs } from "@/lib/stats/compare-card";
import CompareShare from "./CompareShare";
import PlayerSearchInput, { type SelectedPlayer } from "./PlayerSearchInput";
import OverlayRadarChart from "./OverlayRadarChart";

// The comparison's maths (radar percentiles, colours, the stat table and its
// highlights) lives in lib/stats/compare.ts; this file only picks the players,
// reads their season table and draws the result.

// Shown when one of this tool's own reads failed or timed out: restoring the
// players named in the URL, or loading the season table for their position
// (read resilience spec §1.5, S3). Without it the tool showed nothing at all.
// A string constant, not JSX text: lint rejects a bare apostrophe in JSX, and
// JSX text does not decode escape sequences.
const COMPARISON_UNAVAILABLE = "Couldn't load stats for this comparison. Try again in a moment.";

interface ComparisonToolProps {
  qbs: QBSeasonStat[];
  receivers: ReceiverSeasonStat[];
  rbs: RBSeasonStat[];
  season: number;
  /**
   * The newest season the site has, worked out on the server: share links are
   * bare for it and carry ?season= for any other. Without it the season shown
   * is taken to be the newest.
   */
  defaultSeason?: number;
  /** The site's own origin, from the server (NEXT_PUBLIC_SITE_URL): the Share block copies absolute links built on it. */
  siteUrl?: string;
}

const SITE_URL_FALLBACK = "https://yardsperpass.com";

export default function ComparisonTool({
  qbs: serverQBs, receivers: serverReceivers, rbs: serverRBs, season, defaultSeason = season, siteUrl = SITE_URL_FALLBACK,
}: ComparisonToolProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [player1, setPlayer1] = useState<SelectedPlayer | null>(null);
  const [player2, setPlayer2] = useState<SelectedPlayer | null>(null);
  const initializedRef = useRef(false);
  // True when one of the tool's own reads failed (URL restore or a season
  // table). Cleared when Player 1 changes.
  const [loadFailed, setLoadFailed] = useState(false);

  // Lazy-loaded data (fetched client-side when server didn't provide the needed position)
  const [lazyQBs, setLazyQBs] = useState<QBSeasonStat[]>([]);
  const [lazyReceivers, setLazyReceivers] = useState<ReceiverSeasonStat[]>([]);
  const [lazyRBs, setLazyRBs] = useState<RBSeasonStat[]>([]);

  // Use server data if available, otherwise lazy-loaded
  const qbs = serverQBs.length > 0 ? serverQBs : lazyQBs;
  const receivers = serverReceivers.length > 0 ? serverReceivers : lazyReceivers;
  const rbs = serverRBs.length > 0 ? serverRBs : lazyRBs;

  // Restore players from URL params on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const p1Slug = searchParams.get("p1");
    const p2Slug = searchParams.get("p2");
    if (!p1Slug) return;

    // supabase-js reports a failed or timed-out request as `error`, not as a
    // rejection. Unread, a failed restore looked like a link naming nobody.
    // getSupabaseClient throws on missing env vars; that is a failed read too.
    let supabase: ReturnType<typeof getSupabaseClient>;
    try {
      supabase = getSupabaseClient();
    } catch {
      setLoadFailed(true);
      return;
    }
    const slugs = [p1Slug, p2Slug].filter(Boolean) as string[];
    supabase
      .from("player_slugs")
      .select("player_id, slug, player_name, position, current_team_id")
      .in("slug", slugs)
      .then(({ data, error }) => {
        if (error) {
          setLoadFailed(true);
          return;
        }
        if (!data) return;
        const p1Data = data.find((p) => p.slug === p1Slug);
        const p2Data = p2Slug ? data.find((p) => p.slug === p2Slug) : null;
        if (p1Data) setPlayer1(p1Data as SelectedPlayer);
        if (p2Data) setPlayer2(p2Data as SelectedPlayer);
      });
  }, [searchParams]);

  // Lazy-fetch position data when server didn't provide it
  useEffect(() => {
    if (!player1) return;
    const pos = player1.position === "FB" ? "RB" : player1.position;
    let supabase: ReturnType<typeof getSupabaseClient>;
    try {
      supabase = getSupabaseClient();
    } catch {
      setLoadFailed(true);
      return;
    }

    // A failed read leaves the lazy list empty and says so (S3); it is not
    // retried until Player 1 changes.
    if (pos === "QB" && qbs.length === 0) {
      supabase.from("qb_season_stats").select("*").eq("season", season)
        .then(({ data, error }) => { if (error) setLoadFailed(true); else if (data) setLazyQBs(data as unknown as QBSeasonStat[]); });
    } else if ((pos === "WR" || pos === "TE") && receivers.length === 0) {
      supabase.from("receiver_season_stats").select("*").eq("season", season)
        .then(({ data, error }) => { if (error) setLoadFailed(true); else if (data) setLazyReceivers(data as unknown as ReceiverSeasonStat[]); });
    } else if (pos === "RB" && rbs.length === 0) {
      supabase.from("rb_season_stats").select("*").eq("season", season)
        .then(({ data, error }) => { if (error) setLoadFailed(true); else if (data) setLazyRBs(data as unknown as RBSeasonStat[]); });
    }
  }, [player1, qbs.length, receivers.length, rbs.length]);

  // Determine position from first player (normalize FB → RB for pool selection)
  const rawPosition = player1?.position || null;
  const position = rawPosition === "FB" ? "RB" : rawPosition;
  const isQB = position === "QB";
  const isRB = position === "RB";

  // The season table the two players are looked up in and ranked against
  const group: CompareGroup = isQB ? "QB" : isRB ? "RB" : "WR";
  const pool: (QBSeasonStat | ReceiverSeasonStat | RBSeasonStat)[] = isQB ? qbs : isRB ? rbs : receivers;

  // Find full stat objects for selected players
  const stats1 = useMemo(() => {
    if (!player1) return null;
    return pool.find((p) => p.player_id === player1.player_id) || null;
  }, [player1, pool]);

  const stats2 = useMemo(() => {
    if (!player2) return null;
    return pool.find((p) => p.player_id === player2.player_id) || null;
  }, [player2, pool]);

  // Radar percentiles, colours and the stat table (lib/stats/compare.ts). Each
  // player is ranked against the stat card's pool for his position.
  // WR/TE: an axis with no data (e.g. 2026 YPRR, no participation file) is
  // marked missing, and OverlayRadarChart leaves it out instead of plotting it
  // at the center. QB/RB keep the old 0 until their own missing-axis pass.
  const comparison = useMemo(() => {
    if (!player1 || !player2 || !stats1 || !stats2) return null;
    return buildComparison({
      group, rowA: stats1, rowB: stats2, all: pool,
      teamA: player1.current_team_id, teamB: player2.current_team_id,
    });
  }, [player1, player2, stats1, stats2, group, pool]);

  // Update URL
  const updateURL = useCallback((p1: SelectedPlayer | null, p2: SelectedPlayer | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("p1");
    params.delete("p2");
    if (p1) params.set("p1", p1.slug);
    if (p2) params.set("p2", p2.slug);
    const qs = params.toString();
    router.replace(pathname + (qs ? "?" + qs : ""), { scroll: false });
  }, [searchParams, router, pathname]);

  const handleSelect1 = (p: SelectedPlayer | null) => {
    setLoadFailed(false);
    setPlayer1(p);
    if (!p) setPlayer2(null); // Clear p2 if p1 cleared (position changes)
    updateURL(p, p ? player2 : null);
  };

  const handleSelect2 = (p: SelectedPlayer | null) => {
    setPlayer2(p);
    updateURL(player1, p);
  };

  const samePlayer = player1 && player2 && player1.player_id === player2.player_id;

  // The sentences that go with the radar: which players it ranks against, or
  // why it (or one outline) is not drawn, and a note when a player is under the
  // stat card's line.
  const name1 = { fullName: player1?.player_name, slug: player1?.slug };
  const name2 = { fullName: player2?.player_name, slug: player2?.slug };
  const radarDrawn = comparison ? compareRadarIsDrawn(comparison) : false;
  const poolSentence = comparison ? comparePoolSentence(comparison) : null;
  const tooFewSentence = comparison ? compareTooFewSentence(comparison) : null;
  const notDrawnSentences = comparison ? compareNotDrawnSentences(comparison, name1, name2) : [];
  const smallSampleSentence = comparison ? compareSmallSampleSentence(comparison, name1, name2) : null;

  // Does this pair have a share card? Both players must belong to one stat
  // table by their own positions (the card's rule: a hand-typed link can put a
  // running back's receiving row beside a receiver here, and that card is a
  // 404) and both slugs must fit the share URL's grammar.
  const sameTable = player1 && player2
    ? compareGroup(player1.position) !== null && compareGroup(player1.position) === compareGroup(player2.position)
    : false;
  const shareSlugs = comparison && !samePlayer && sameTable && player1 && player2
    ? parseCompareSlugs(player1.slug, player2.slug)
    : null;
  const cardHref = shareSlugs ? compareCardHref(shareSlugs.a, shareSlugs.b, season, defaultSeason) : null;

  // Two comparable players, the season table is here, and one or both are not
  // in it: say so. (Nothing was shown at all before.) Not while the table is
  // still loading or failed to load, and not for players of different groups,
  // where a missing row only means "the other table".
  const noStatsSentence = player1 && player2 && !samePlayer && sameTable && !loadFailed && pool.length > 0 && (!stats1 || !stats2)
    ? compareNoStatsMessage({
      nameA: player1.player_name, nameB: player2.player_name, missingA: !stats1, missingB: !stats2,
      season, isNewestSeason: season === defaultSeason,
    })
    : null;

  return (
    <div className="space-y-6">
      {/* Player selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PlayerSearchInput
          label="Player 1"
          selected={player1}
          onSelect={handleSelect1}
          excludePlayerId={player2?.player_id}
        />
        <PlayerSearchInput
          label="Player 2"
          selected={player2}
          onSelect={handleSelect2}
          positionFilter={position || undefined}
          excludePlayerId={player1?.player_id}
        />
      </div>

      {loadFailed && (
        <p role="status" className="text-center text-amber-600 text-sm font-medium">{COMPARISON_UNAVAILABLE}</p>
      )}

      {samePlayer && (
        <p className="text-center text-amber-600 text-sm font-medium">Select two different players to compare.</p>
      )}

      {/* Empty state */}
      {!player1 && !player2 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-semibold mb-2">Select two players to compare</p>
          <p className="text-sm">Choose a player on the left, then pick a same-position player on the right.</p>
        </div>
      )}

      {/* Waiting for second player */}
      {player1 && !player2 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">Now select a {position} to compare against {player1.player_name}.</p>
        </div>
      )}

      {noStatsSentence && (
        <p data-compare-no-stats className="text-center text-sm text-gray-500 py-8">{noStatsSentence}</p>
      )}

      {/* Comparison view */}
      {comparison && !samePlayer && (
        <div className="space-y-6">
          {/* Overlay Radar, or the reason there is none */}
          {radarDrawn ? (
            <div className="max-w-md mx-auto">
              <OverlayRadarChart
                values1={comparison.a.values}
                values2={comparison.b.values}
                missing1={compareChartMask(comparison.a)}
                missing2={compareChartMask(comparison.b)}
                color1={comparison.a.color}
                color2={comparison.b.color}
                name1={player1!.player_name}
                name2={player2!.player_name}
                axes={comparison.axes}
              />
            </div>
          ) : (
            <div className="max-w-2xl mx-auto text-center text-sm text-gray-500 py-8 space-y-1">
              {tooFewSentence && <p>{tooFewSentence}</p>}
              {notDrawnSentences.map((sentence, i) => <p key={i}>{sentence}</p>)}
            </div>
          )}
          {(poolSentence || smallSampleSentence || (radarDrawn && notDrawnSentences.length > 0)) && (
            <div className="max-w-2xl mx-auto text-center text-xs text-gray-500 space-y-1">
              {poolSentence && <p>{poolSentence}</p>}
              {radarDrawn && notDrawnSentences.map((sentence, i) => <p key={i}>{sentence}</p>)}
              {smallSampleSentence && <p className="text-amber-700">{smallSampleSentence}</p>}
            </div>
          )}

          {shareSlugs && cardHref && (
            <CompareShare
              shareUrl={`${siteUrl.replace(/\/+$/, "")}${cardHref}`}
              cardHref={cardHref}
              downloadHref={compareImageHref(shareSlugs.a, shareSlugs.b, season, { download: true })}
            />
          )}

          {/* Stat Comparison Table */}
          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left font-semibold text-gray-600" style={{ color: comparison.a.color }}>{player1!.player_name}</th>
                  <th className="px-4 py-2 text-center font-semibold text-gray-500">Stat</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600" style={{ color: comparison.b.color }}>{player2!.player_name}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.key} className="border-t border-gray-100">
                    <td className={`px-4 py-2 text-left tabular-nums ${row.winner === 1 ? "font-bold bg-green-50" : ""}`}>
                      {row.a}
                    </td>
                    <td className="px-4 py-2 text-center text-xs text-gray-500 font-medium">{row.label}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${row.winner === 2 ? "font-bold bg-green-50" : ""}`}>
                      {row.b}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
