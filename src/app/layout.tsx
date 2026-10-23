import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "600", "800"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: "500",
});

// Thai text: the Latin fonts above have no Thai letters, so Thai falls through to this one.
const plexThai = IBM_Plex_Sans_Thai({
  variable: "--font-plex-thai",
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Outing Math Flip",
  description: "Flip a random math problem against a timer, and manage the problem list.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${bricolage.variable} ${dmMono.variable} ${plexThai.variable} antialiased`}>{children}</body>
    </html>
  );
}
