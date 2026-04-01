// app/layout.tsx — root layout, NO sidebar/navbar here
import type { Metadata } from "next";
import { Geist_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/QueryProvider";
import { cn } from "@/lib/utils";
import { Toaster } from "sonner";

const spaceGroteskHeading = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://nimbus.everydaycodings.com"),
  title: {
    default: "Nimbus - Securing your digital life",
    template: "%s | Nimbus",
  },
  description: "A fast, privacy-focused, and open-source file manager and encrypted vault.",
  keywords: ["Nimbus", "Cloud Storage", "Encrypted Vault", "File Manager", "Open Source", "Privacy"],
  authors: [{ name: "Nimbus Team" }],
  creator: "Nimbus Team",
  publisher: "Nimbus",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://nimbus.everydaycodings.com",
    siteName: "Nimbus",
    title: "Nimbus - Securing your digital life",
    description: "A fast, privacy-focused, and open-source file manager and encrypted vault.",
    images: [
      {
        url: "/logo.png",
        width: 1200,
        height: 630,
        alt: "Nimbus Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nimbus - Securing your digital life",
    description: "A fast, privacy-focused, and open-source file manager and encrypted vault.",
    images: ["/logo.png"],
    creator: "@Nimbus_Storage",
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
      <html
        lang="en"
        suppressHydrationWarning
        className={cn(
          "antialiased",
          fontMono.variable,
          inter.variable,
          spaceGroteskHeading.variable,
          "font-sans"
        )}
      >
        <body>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            forcedTheme="dark"
            enableSystem={false}
          >
            <QueryProvider>
              {children}
            </QueryProvider>
            <Toaster
              richColors
              position="bottom-right"
              theme="dark"
            />
          </ThemeProvider>
        </body>
      </html>
  );
}