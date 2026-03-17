// components/ui/SeasonSelect.tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface SeasonSelectProps {
  seasons: number[];
  currentSeason: number;
}

export default function SeasonSelect({
  seasons,
  currentSeason,
}: SeasonSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("season", e.target.value);
    params.delete("gap");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={currentSeason}
      onChange={handleChange}
      className="px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-navy font-medium focus:outline-none focus:ring-2 focus:ring-navy/20"
    >
      {seasons.map((s) => (
        <option key={s} value={s}>
          {s} Season
        </option>
      ))}
    </select>
  );
}
