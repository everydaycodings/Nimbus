"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  GithubLogo, 
  CloudArrowUp, 
  ShieldCheck, 
  FolderLock, 
  Lightning,
  Sparkle,
  ArrowRight
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// Teal brand color based on dashboard usages
const TEAL = "#2da07a";

interface LandingPageClientProps {
  initialStars: number;
}

export function LandingPageClient({ initialStars }: LandingPageClientProps) {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-[#2da07a]/30">
      
      {/* ── Navigation ── */}
      <nav className="fixed top-0 inset-x-0 h-16 border-b border-border/40 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white" 
              style={{ backgroundColor: TEAL }}
            >
              <CloudArrowUp size={20} weight="bold" />
            </div>
            <span className="font-bold text-xl tracking-tight">nimbus</span>
          </div>
          <div className="flex items-center gap-4">
            <a 
              href="https://github.com/everydaycodings/Nimbus" 
              target="_blank" 
              rel="noreferrer"
              className="hidden sm:flex"
            >
              <Button variant="ghost" className="gap-2">
                <GithubLogo size={20} />
                <span className="sr-only sm:not-sr-only">GitHub</span>
              </Button>
            </a>
            <Link href="/dashboard">
              <Button style={{ backgroundColor: TEAL, color: "white" }} className="hover:opacity-90">
                Go to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="pt-16">
        {/* ── Hero Section ── */}
        <section className="relative overflow-hidden pt-24 pb-32 md:pt-36 md:pb-40">
          {/* Background Gradients */}
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <div 
              className="absolute -top-[20%] -right-[10%] w-[60%] h-[60%] rounded-full blur-[120px] opacity-20"
              style={{ backgroundColor: TEAL }}
            />
            <div 
              className="absolute -bottom-[20%] -left-[10%] w-[50%] h-[50%] rounded-full blur-[120px] opacity-10"
              style={{ backgroundColor: "#3b82f6" }}
            />
          </div>

          <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-6 text-center">
            {/* Github Stars Pill */}
            <a 
              href="https://github.com/everydaycodings/Nimbus"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-secondary/50 hover:bg-secondary/80 transition-colors mb-8 cursor-pointer ring-1 ring-inset ring-[#2da07a]/20"
            >
              <GithubLogo size={16} className="text-foreground" />
              <span className="text-sm font-medium">Proudly Open Source</span>
              <span className="w-1 h-1 rounded-full bg-border" />
              <div className="flex items-center gap-1 text-sm font-semibold" style={{ color: TEAL }}>
                <Sparkle size={14} weight="fill" />
                <span>{initialStars.toLocaleString()} Stars</span>
              </div>
            </a>

            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8">
              Your data, secured.<br />
              <span style={{ color: TEAL }}>Open for everyone.</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Nimbus is a completely free, open-source file manager and encrypted vault. No pricing tiers, no storage limits—just host it yourself and take back control of your data.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/dashboard">
                <Button size="lg" className="h-14 px-8 text-lg w-full sm:w-auto gap-2" style={{ backgroundColor: TEAL, color: "white" }}>
                  Get Started <ArrowRight size={20} />
                </Button>
              </Link>
              <a href="https://github.com/everydaycodings/Nimbus" target="_blank" rel="noreferrer">
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg w-full sm:w-auto gap-2 border-border hover:bg-accent/50">
                  <GithubLogo size={22} />
                  View the Code
                </Button>
              </a>
            </div>
          </div>
        </section>

        {/* ── Features Section ── */}
        <section className="py-24 bg-secondary/20 border-y border-border/40">
          <div className="max-w-6xl mx-auto px-4 md:px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Built for privacy & speed</h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Everything you need to manage your personal files, wrapped in a beautiful, modern interface.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <Card className="bg-background/50 border-border/50 hover:border-[#2da07a]/50 transition-colors duration-300 group">
                <CardHeader>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-secondary group-hover:bg-[#2da07a]/10 transition-colors">
                    <FolderLock size={24} weight="duotone" style={{ color: TEAL }} />
                  </div>
                  <CardTitle>Encrypted Vault</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Hide your most sensitive files behind a secure, password-protected zero-knowledge vault.
                  </CardDescription>
                </CardContent>
              </Card>

              {/* Feature 2 */}
              <Card className="bg-background/50 border-border/50 hover:border-[#2da07a]/50 transition-colors duration-300 group">
                <CardHeader>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-secondary group-hover:bg-[#2da07a]/10 transition-colors">
                    <Lightning size={24} weight="duotone" style={{ color: TEAL }} />
                  </div>
                  <CardTitle>Lightning Fast</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Optimized for speed. Drag, drop, and manage thousands of files instantly without waiting.
                  </CardDescription>
                </CardContent>
              </Card>

              {/* Feature 3 */}
              <Card className="bg-background/50 border-border/50 hover:border-[#2da07a]/50 transition-colors duration-300 group">
                <CardHeader>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-secondary group-hover:bg-[#2da07a]/10 transition-colors">
                    <ShieldCheck size={24} weight="duotone" style={{ color: TEAL }} />
                  </div>
                  <CardTitle>100% Free & Open</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    No subscriptions or paywalls. Nimbus is proudly open-source and built by the community, for the community.
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ── Footer CTA ── */}
        <section className="py-32 relative overflow-hidden text-center">
          <div className="relative z-10 max-w-3xl mx-auto px-4">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">Take control of your files.</h2>
            <p className="text-lg text-muted-foreground mb-10">
              Deploy Nimbus to your own server in minutes, or contribute to the source code on GitHub.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href="https://github.com/everydaycodings/Nimbus" target="_blank" rel="noreferrer">
                <Button size="lg" className="h-12 px-8 text-base w-full sm:w-auto gap-2" style={{ backgroundColor: TEAL, color: "white" }}>
                  <GithubLogo size={20} weight="fill" />
                  Star on GitHub
                </Button>
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── Simple Footer ── */}
      <footer className="py-8 border-t border-border/40 text-center text-sm text-muted-foreground">
        <p>Built with ❤️ by the open-source community. Code licensed under MIT.</p>
      </footer>
    </div>
  );
}
