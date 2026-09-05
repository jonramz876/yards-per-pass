// app/fonts.ts — Press Start 2P (SIL OFL 1.1), bundled so no runtime font fetch
import localFont from "next/font/local";

export const pressStart = localFont({
  src: "./fonts/PressStart2P-Regular.ttf",
  variable: "--font-pixel",
  display: "swap",
});
