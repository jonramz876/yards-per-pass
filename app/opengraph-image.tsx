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
