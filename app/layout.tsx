// app/layout.tsx
import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { Analytics } from "@vercel/analytics/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

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
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Yards Per Pass — NFL Analytics Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-white flex flex-col">
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
        <TooltipProvider>
          <Suspense>
            <Navbar />
          </Suspense>
          <main className="flex-1">{children}</main>
          <Footer />
        </TooltipProvider>
        <Analytics />
      </body>
    </html>
  );
}
