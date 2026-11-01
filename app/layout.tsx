import type { Metadata } from "next";
import "./globals.css";
import { ClientProviders } from "./ClientProviders";

export const metadata: Metadata = {
  metadataBase: new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "localhost:3000"}`),
  title: "Eve — Plans your celebration. Runs it too.",
  description: "Plans your celebration. Runs it too. Eve helps you create and manage weddings, birthdays, and every event in between.",
  applicationName: "Eve",
  icons: {
    icon: "/brand/eve-icon.svg",
    apple: "/brand/eve-icon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "Eve",
    title: "Eve — Plans your celebration. Runs it too.",
    description: "Plans your celebration. Runs it too. Plan the day, budget, vendors, and event operations with Eve.",
    images: [
      {
        url: "/eve-logo.svg",
        alt: "Eve — Plans your celebration. Runs it too.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Eve — Plans your celebration. Runs it too.",
    description: "Plans your celebration. Runs it too. Plan the day, budget, vendors, and event operations with Eve.",
    images: ["/eve-logo.svg"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-white">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
