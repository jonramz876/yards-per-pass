import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Receiver Rankings — Yards Per Pass";
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
          Receiver Rankings
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "#94a3b8",
          }}
        >
          EPA/target, catch rate, YAC, and target share for every receiver
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: "#64748b",
            marginTop: 24,
          }}
        >
          yardsperpass.com/receivers
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 800 }],
    }
  );
}
