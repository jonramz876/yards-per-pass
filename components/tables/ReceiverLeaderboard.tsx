"use client";

export default function ReceiverLeaderboard({
  data,
  throughWeek,
  season,
}: {
  data: any[];
  throughWeek: number;
  season: number;
}) {
  return <div>Receiver leaderboard — {data.length} players</div>;
}
