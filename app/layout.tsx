// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-white">
        {children}
      </body>
    </html>
  );
}
