import { LandingPageClient } from "./landing-page-client";

export const metadata = {
  title: "Nimbus - Open Source File Vault",
  description: "A fast, privacy-focused, and open-source file manager and encrypted vault.",
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
  return <LandingPageClient initialStars={stars} />;
}
