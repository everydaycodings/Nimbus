import { LandingPageClient } from "./landing-page-client";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Open Source File Vault",
  description: "A fast, privacy-focused, and open-source file manager and encrypted vault. Secure your files with end-to-end privacy and effortless organization.",
  openGraph: {
    title: "Nimbus - Open Source File Vault",
    description: "A fast, privacy-focused, and open-source file manager and encrypted vault.",
    url: "https://nimbus.everydaycodings.com",
    siteName: "Nimbus",
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nimbus - Open Source File Vault",
    description: "A fast, privacy-focused, and open-source file manager and encrypted vault.",
    images: ["/logo.png"],
  },
};

async function getGithubStars(): Promise<number> {
  try {
    const res = await fetch("https://api.github.com/repos/everydaycodings/Nimbus", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.stargazers_count || 0;
  } catch (error) {
    console.error("Failed to fetch Github stars:", error);
    return 0;
  }
}

export default async function LandingPage() {
  const stars = await getGithubStars();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return <LandingPageClient initialStars={stars} user={user} />;
}
