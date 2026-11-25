import type { Metadata } from "next";
import localFont from "next/font/local";

import intro from "../../../../docs/assets/intro-light.png";
import icon from "../../../web/public/icon.svg";
import "./globals.css";

/** Allo by Josh Puckett, the font of the app, from the same file. */
const allo = localFont({
  src: "../../../web/src/assets/fonts/AlloVariable.woff2",
  weight: "100 900",
  variable: "--font-allo",
  adjustFontFallback: "Arial",
});

const DESCRIPTION =
  "Always-on Claude bots on your own Mac. Each one has its own instructions, memory, browser and routines, and keeps going while you are away.";

export const metadata: Metadata = {
  metadataBase: new URL("https://clots.app"),
  title: "clots",
  description: DESCRIPTION,
  icons: { icon: icon.src },
  openGraph: { title: "clots", description: DESCRIPTION, images: [intro.src] },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={allo.variable}>
      <body>{children}</body>
    </html>
  );
}
