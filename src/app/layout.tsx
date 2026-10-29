import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";
import { SITE } from "@/lib/site";
import "./globals.css";

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Embedded so Marathi names, notices and the muster render the same on every machine.
const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: `${SITE.shortName} ${SITE.appName}`, template: `%s · ${SITE.shortName}` },
  description: `${SITE.collegeName}: attendance, eligibility and records for Std XI–XII (MSBSHSE).`,
  applicationName: `${SITE.shortName} ${SITE.appName}`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${notoSans.variable} ${notoDevanagari.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
