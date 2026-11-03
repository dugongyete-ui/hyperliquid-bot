import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Grok Bot · Hyperliquid Trading Crew",
  description:
    "Cute autonomous trading crew of 5 agent bots trading on Hyperliquid. SIM mode uses paper money with live prices, LIVE mode sends real orders to Hyperliquid mainnet or testnet.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='26' fill='%2317171C'/%3E%3Crect x='26' y='34' width='15' height='32' rx='7.5' fill='white'/%3E%3Crect x='59' y='34' width='15' height='32' rx='7.5' fill='white'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  themeColor: "#F2F3F5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${nunito.variable} antialiased bg-[#F2F3F5] text-[#17171C] font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
