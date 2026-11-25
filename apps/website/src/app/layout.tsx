import type { Metadata } from "next";

import intro from "../../../../docs/assets/intro-light.png";
import icon from "../../../web/public/icon.svg";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const TITLE = "clots · Always-on Claude Code bots";

const DESCRIPTION =
  "Run always-on Claude Code bots on your own machine with your Claude subscription. Each bot has its own instructions, memory, browser and routines, and keeps working while you are away. Free and open source.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["Claude Code bots", "Claude Code", "Claude subscription", "always-on AI bots", "AI agents", "Claude Agent SDK", "open source"],
  alternates: { canonical: "/" },
  icons: { icon: icon.src },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "clots",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: intro.src, width: intro.width, height: intro.height, alt: "The clots app with a bot at work" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [intro.src] },
};

/** Tells search engines that the page is about a free macOS app, for richer results. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "clots",
  description: DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
        {children}
      </body>
    </html>
  );
}
