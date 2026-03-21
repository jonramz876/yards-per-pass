import { ImageResponse } from "next/og";
import { getTeam } from "@/lib/data/teams";

export const runtime = "edge";
export const alt = "Team Stats — Yards Per Pass";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf"
).then((res) => res.arrayBuffer());

export default async function Image({ params }: { params: { team_id: string } }) {
  const fontData = await interBold;
  const team = getTeam(params.team_id.toUpperCase());
  const bgColor = team?.primaryColor || "#0f172a";
  const teamName = team?.name || "Team";
  const division = team?.division || "";

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
          backgroundColor: bgColor,
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "rgba(255,255,255,0.7)",
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
            textAlign: "center",
            paddingLeft: 40,
            paddingRight: 40,
          }}
        >
          {teamName}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          {division}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: "rgba(255,255,255,0.5)",
            marginTop: 24,
          }}
        >
          yardsperpass.com
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
