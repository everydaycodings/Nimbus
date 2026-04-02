"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { 
  GithubLogo, 
  CloudArrowUp, 
  ShieldCheck, 
  FolderLock, 
  Lightning,
  Sparkle,
  ArrowRight,
  MagnifyingGlass,
  Tag,
  ShareNetwork,
  Image as ImageIcon
} from "@phosphor-icons/react";

// Teal brand color based on dashboard usages
const TEAL = "#2da07a";

interface LandingPageClientProps {
  initialStars: number;
  user?: any;
}

export function LandingPageClient({ initialStars, user }: LandingPageClientProps) {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-[#2da07a]/30 font-sans">
      
      {/* ── Navigation ── */}
      <nav className="fixed top-0 inset-x-0 h-16 border-b border-border/30 bg-background/70 backdrop-blur-xl z-50">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer group">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-105" 
              style={{ backgroundColor: TEAL }}
            >
              <CloudArrowUp size={20} weight="bold" />
            </div>
            <span className="font-bold text-xl tracking-tight transition-colors group-hover:text-[#2da07a]">nimbus</span>
          </Link>
          <div className="flex items-center gap-3 md:gap-4">
            <a 
              href="https://github.com/everydaycodings/Nimbus" 
              target="_blank" 
              rel="noreferrer"
              className="hidden sm:flex text-muted-foreground hover:text-foreground transition-colors"
            >
              <Button variant="ghost" className="gap-2 cursor-pointer">
                <GithubLogo size={20} />
                <span className="sr-only sm:not-sr-only">GitHub</span>
              </Button>
            </a>
            <Link href="/dashboard">
              <Button style={{ backgroundColor: TEAL, color: "white" }} className="hover:opacity-90 shadow-sm font-medium cursor-pointer">
                {user ? "Go to Dashboard" : "Sign In"}
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="pt-16">
        {/* ── Hero Section ── */}
        <section className="relative pt-20 pb-16 md:pt-32 md:pb-24 flex flex-col items-center text-center">
          {/* Subtle minimal background glow */}
          <div className="absolute top-0 inset-x-0 w-full h-full bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(45,160,122,0.15),rgba(255,255,255,0))] dark:bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(45,160,122,0.12),rgba(0,0,0,0))] pointer-events-none" />

          <div className="relative z-10 max-w-5xl mx-auto px-4 md:px-6 flex flex-col items-center">
            {/* Github Stars Pill */}
            <a 
              href="https://github.com/everydaycodings/Nimbus"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full border border-border/50 bg-secondary/30 hover:bg-secondary/60 transition-all mb-8 cursor-pointer shadow-sm group"
            >
              <GithubLogo size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="text-xs md:text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">Proudly Open Source</span>
              <span className="w-1 h-1 rounded-full bg-border" />
              <div className="flex items-center gap-1 text-xs md:text-sm font-semibold" style={{ color: TEAL }}>
                <Sparkle size={14} weight="fill" />
                <span>{initialStars.toLocaleString()} Stars</span>
              </div>
            </a>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 max-w-4xl text-balance leading-[1.1]">
              Take back control of your <br className="hidden md:block"/>
              <span style={{ color: TEAL }}>cloud storage</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 text-balance leading-relaxed">
              Nimbus is a minimalistic, high-performance file manager with an integrated zero-knowledge encrypted vault. Self-host your data without compromises.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
              <Link href="/dashboard" className="w-full sm:w-auto">
                <Button size="lg" className="h-12 px-8 text-base w-full sm:w-auto gap-2 group shadow-md cursor-pointer" style={{ backgroundColor: TEAL, color: "white" }}>
                  {user ? "Open Dashboard" : "Get Started"}
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <a href="https://github.com/everydaycodings/Nimbus" target="_blank" rel="noreferrer" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="h-12 px-8 text-base w-full sm:w-auto gap-2 border-border/50 hover:bg-secondary/50 cursor-pointer">
                  <GithubLogo size={20} />
                  View the Code
                </Button>
              </a>
            </div>
          </div>
        </section>

        {/* ── App Preview (Minimalist Graphic) ── */}
        <section className="px-4 md:px-6 max-w-5xl mx-auto mb-24 md:mb-32 relative">
          <div className="rounded-2xl border border-border/40 bg-secondary/10 p-2 md:p-3 shadow-2xl backdrop-blur-sm">
            <div className="rounded-xl border border-border/40 bg-background overflow-hidden aspect-[16/10] sm:aspect-video flex flex-col shadow-inner">
              {/* Fake App header */}
              <div className="h-10 md:h-12 border-b border-border/40 flex items-center px-4 gap-4 bg-secondary/20">
                <div className="flex gap-1.5 md:gap-2">
                  <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-red-500/30 border border-red-500/40" />
                  <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-yellow-500/30 border border-yellow-500/40" />
                  <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-green-500/30 border border-green-500/40" />
                </div>
                <div className="h-6 flex-1 max-w-sm rounded-md bg-background/50 mx-auto flex items-center px-3 border border-border/40 shadow-sm">
                  <MagnifyingGlass size={12} className="text-muted-foreground mr-2" />
                  <div className="w-24 h-1.5 bg-muted-foreground/20 rounded-full" />
                </div>
              </div>
              {/* Fake App Body */}
              <div className="flex-1 flex overflow-hidden">
                <div className="w-48 md:w-56 border-r border-border/40 hidden sm:flex flex-col p-4 gap-2 bg-secondary/5">
                  <div className="h-3 w-16 bg-muted-foreground/20 rounded-full mb-3 ml-2" />
                  <div className="h-9 rounded-md bg-[#2da07a]/10 border border-[#2da07a]/20 flex items-center px-3 gap-3">
                     <CloudArrowUp size={16} style={{ color: TEAL }} weight="duotone" />
                     <div className="h-2 w-16 bg-[#2da07a]/40 rounded-full" />
                  </div>
                  <div className="h-9 rounded-md hover:bg-secondary/40 flex items-center px-3 gap-3 transition-colors">
                     <FolderLock size={16} className="text-muted-foreground" weight="duotone" />
                     <div className="h-2 w-12 bg-muted-foreground/30 rounded-full" />
                  </div>
                  <div className="h-9 rounded-md hover:bg-secondary/40 flex items-center px-3 gap-3 transition-colors">
                     <Tag size={16} className="text-muted-foreground" weight="duotone" />
                     <div className="h-2 w-14 bg-muted-foreground/30 rounded-full" />
                  </div>
                </div>
                <div className="flex-1 p-4 md:p-8 flex flex-col gap-6 md:gap-8 bg-background">
                  <div className="flex items-center justify-between">
                    <div className="h-5 w-24 md:w-32 bg-foreground/10 rounded-full" />
                    <div className="h-8 w-8 rounded-full bg-secondary/50 border border-border/50 hidden md:block" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     {[1,2,3,4].map(i => (
                       <div key={i} className="aspect-square rounded-xl border border-border/40 bg-secondary/10 flex flex-col items-center justify-center gap-3 hover:bg-secondary/20 transition-colors">
                         {i === 1 ? (
                           <FolderLock size={28} className="text-muted-foreground/50" weight="duotone" />
                         ) : i === 2 ? (
                           <ImageIcon size={28} className="text-muted-foreground/50" weight="duotone" />
                         ) : (
                           <CloudArrowUp size={28} className="text-muted-foreground/50" weight="duotone" />
                         )}
                         <div className="h-1.5 w-10 bg-muted-foreground/20 rounded-full" />
                       </div>
                     ))}
                  </div>
                  <div className="flex-1 rounded-xl border border-border/40 bg-secondary/5 flex flex-col p-4 gap-4">
                     <div className="w-full h-10 border-b border-border/40 flex items-center gap-4 px-2">
                       <div className="h-2 w-32 bg-muted-foreground/20 rounded-full" />
                       <div className="h-2 w-16 bg-muted-foreground/20 rounded-full ml-auto" />
                     </div>
                     <div className="flex items-center gap-4 px-2">
                       <div className="h-6 w-6 rounded bg-muted-foreground/10" />
                       <div className="h-2 w-40 bg-muted-foreground/20 rounded-full" />
                     </div>
                     <div className="flex items-center gap-4 px-2">
                       <div className="h-6 w-6 rounded bg-muted-foreground/10" />
                       <div className="h-2 w-24 bg-muted-foreground/20 rounded-full" />
                     </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Feature Highlights ── */}
        <section className="py-24 md:py-32 border-y border-border/30 bg-secondary/5 overflow-hidden">
          <div className="max-w-6xl mx-auto px-4 md:px-6 flex flex-col gap-24 md:gap-32">
            
            {/* Feature 1: Vault */}
            <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
              <div className="flex-1 space-y-6">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#2da07a]/10 border border-[#2da07a]/20">
                  <FolderLock size={24} style={{ color: TEAL }} weight="duotone" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold tracking-tight">Zero-Knowledge Vault</h3>
                <p className="text-lg text-muted-foreground leading-relaxed text-balance">
                  Your most sensitive files deserve true protection. The Nimbus Vault encrypts your data client-side using industry-standard AES-256. Not even the server can see what's inside.
                </p>
                <ul className="space-y-3 mt-4">
                  <li className="flex items-center gap-3 text-muted-foreground"><ShieldCheck size={20} className="text-[#2da07a]" /> Client-side encryption</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><FolderLock size={20} className="text-[#2da07a]" /> Password-protected access</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><Lightning size={20} className="text-[#2da07a]" /> Instant decryption in-browser</li>
                </ul>
              </div>
              <div className="flex-1 w-full relative">
                <div className="rounded-2xl border border-border/40 bg-secondary/10 p-2 shadow-xl backdrop-blur-sm">
                  <div className="rounded-xl border border-border/40 bg-background overflow-hidden aspect-[4/3] flex flex-col items-center justify-center relative shadow-inner">
                    {/* Fake files in background blurred */}
                    <div className="absolute inset-0 p-6 grid grid-cols-3 gap-4 opacity-20 blur-[2px] pointer-events-none">
                      {[1,2,3,4,5,6].map(i => (
                        <div key={i} className="rounded-xl border border-border/40 bg-secondary/20 h-24" />
                      ))}
                    </div>
                    {/* Vault Unleash UI */}
                    <div className="relative z-10 w-full max-w-sm rounded-xl border border-border/40 bg-background/80 backdrop-blur-md shadow-2xl p-6 flex flex-col items-center text-center">
                      <div className="w-16 h-16 rounded-full bg-[#2da07a]/10 flex items-center justify-center mb-4 border border-[#2da07a]/20 shadow-[0_0_15px_rgba(45,160,122,0.2)]">
                         <FolderLock size={32} style={{ color: TEAL }} weight="duotone" />
                      </div>
                      <h4 className="font-semibold text-lg mb-1">Encrypted Vault</h4>
                      <p className="text-sm text-muted-foreground mb-6">Enter your password to unlock.</p>
                      <div className="w-full h-10 rounded-md bg-secondary/50 border border-border/60 flex items-center px-4 mb-4">
                        <div className="flex gap-1.5">
                           {[1,2,3,4,5,6,7,8,9,10,11,12].map(i => (
                             <div key={i} className="w-2 h-2 rounded-full bg-foreground/80" />
                           ))}
                        </div>
                      </div>
                      <div className="w-full h-10 rounded-md flex items-center justify-center font-medium text-white shadow-sm" style={{ backgroundColor: TEAL }}>
                        Unlock Vault
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 2: Organization */}
            <div className="flex flex-col md:flex-row-reverse items-center gap-12 lg:gap-20">
              <div className="flex-1 space-y-6">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-purple-500/10 border border-purple-500/20">
                  <Tag size={24} className="text-purple-500" weight="duotone" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold tracking-tight">Smart Organization</h3>
                <p className="text-lg text-muted-foreground leading-relaxed text-balance">
                  Stop losing files in a sea of nested folders. Nimbus lets you attach custom multi-colored tags, mark items as favorites, and filter through everything instantly.
                </p>
                <ul className="space-y-3 mt-4">
                  <li className="flex items-center gap-3 text-muted-foreground"><Tag size={20} className="text-purple-500" /> Custom colored tags</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><Sparkle size={20} className="text-purple-500" /> Quick favorites</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><MagnifyingGlass size={20} className="text-purple-500" /> Real-time filtering</li>
                </ul>
              </div>
              <div className="flex-1 w-full relative">
                <div className="rounded-2xl border border-border/40 bg-secondary/10 p-2 shadow-xl backdrop-blur-sm relative">
                  {/* Decorative element behind */}
                  <div className="absolute -left-8 -bottom-8 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl" />
                  <div className="rounded-xl border border-border/40 bg-background overflow-hidden aspect-[4/3] flex flex-col shadow-inner relative z-10">
                    <div className="h-12 border-b border-border/40 flex items-center px-4 gap-3 bg-secondary/30">
                      <div className="h-7 flex-1 rounded-md bg-background border border-border/50 flex items-center px-3 shadow-inner">
                        <MagnifyingGlass size={14} className="text-muted-foreground mr-2" />
                        <span className="text-xs text-foreground font-medium">tax receipts 2026</span>
                      </div>
                      <div className="h-7 px-3 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <span className="text-[10px] text-blue-500 font-semibold tracking-wide uppercase">Taxes</span>
                      </div>
                    </div>
                    <div className="flex-1 p-4 flex flex-col gap-3 bg-background">
                      {[1,2,3].map(i => (
                        <div key={i} className={`w-full rounded-xl border p-3 flex items-center gap-4 transition-colors ${i === 1 ? 'border-purple-500/30 bg-purple-500/5' : 'border-border/40 bg-secondary/10'}`}>
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${i === 1 ? 'bg-purple-500/20' : 'bg-secondary/40'}`}>
                            <ImageIcon size={20} className={i === 1 ? "text-purple-500" : "text-muted-foreground"} weight="duotone" />
                          </div>
                          <div className="flex-1">
                            <div className="h-2.5 w-32 bg-foreground/20 rounded-full mb-2" />
                            <div className="flex gap-2">
                              <div className="h-1.5 w-10 bg-blue-500/40 rounded-full" />
                              {i === 1 && <div className="h-1.5 w-14 bg-orange-500/40 rounded-full" />}
                            </div>
                          </div>
                          <Sparkle size={18} className={i === 1 ? "text-yellow-500" : "text-muted-foreground/20"} weight={i === 1 ? "fill" : "regular"} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 3: Preview & Sharing */}
            <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
              <div className="flex-1 space-y-6">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-orange-500/10 border border-orange-500/20">
                  <ShareNetwork size={24} className="text-orange-500" weight="duotone" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold tracking-tight">Preview & Share Instantly</h3>
                <p className="text-lg text-muted-foreground leading-relaxed text-balance">
                  View images, read PDFs, and check documents directly within the browser. Generate secure sharing links to collaborate with people outside your workspace.
                </p>
                <ul className="space-y-3 mt-4">
                  <li className="flex items-center gap-3 text-muted-foreground"><ImageIcon size={20} className="text-orange-500" /> Beautiful media viewer</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><ShareNetwork size={20} className="text-orange-500" /> Public share links with expiration</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><ShieldCheck size={20} className="text-orange-500" /> No signup required for guests</li>
                </ul>
              </div>
              <div className="flex-1 w-full relative">
                <div className="rounded-2xl border border-border/40 bg-secondary/10 p-2 shadow-xl backdrop-blur-sm relative">
                  <div className="absolute -right-8 top-8 w-32 h-32 bg-orange-500/10 rounded-full blur-2xl" />
                  <div className="rounded-xl border border-border/40 bg-background overflow-hidden aspect-[4/3] flex flex-col shadow-inner relative z-10">
                    {/* Underlying image preview graphic */}
                    <div className="flex-1 bg-secondary/20 flex flex-col relative overflow-hidden">
                       <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/20 to-transparent flex items-center justify-between px-4 z-10">
                          <div className="h-2.5 w-32 bg-foreground/40 rounded-full" />
                          <div className="flex gap-3">
                             <div className="h-6 w-6 rounded bg-foreground/10" />
                             <div className="h-6 w-6 rounded bg-foreground/10" />
                          </div>
                       </div>
                       <div className="flex-1 m-4 mt-12 rounded-lg bg-orange-500/10 border border-orange-500/20 flex flex-col items-center justify-center gap-4">
                          <ImageIcon size={48} className="text-orange-500/40" weight="duotone" />
                          <div className="h-2 w-24 bg-orange-500/20 rounded-full" />
                       </div>
                    </div>
                    {/* Share Link Popover simulated */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[85%] rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-2xl p-4 flex flex-col z-20">
                       <div className="flex items-center gap-2 mb-3">
                         <div className="w-6 h-6 rounded bg-orange-500/10 flex items-center justify-center">
                           <ShareNetwork size={12} className="text-orange-500" />
                         </div>
                         <span className="text-sm font-semibold">Share "project_mockup.jpg"</span>
                       </div>
                       <div className="flex gap-2">
                         <div className="flex-1 h-8 rounded-md bg-secondary/50 border border-border flex items-center px-3 overflow-hidden">
                           <span className="text-xs text-muted-foreground whitespace-nowrap truncate">https://nimbus.app/v/xy7B...</span>
                         </div>
                         <div className="h-8 px-4 rounded-md bg-foreground text-background flex items-center justify-center text-xs font-semibold shadow-sm">
                           Copy
                         </div>
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* ── More Features Grid ── */}
        <section className="py-20 bg-secondary/5 border-b border-border/30">
          <div className="max-w-6xl mx-auto px-4 md:px-6">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-4">Everything you need</h2>
              <p className="text-muted-foreground">More reasons why Nimbus is the perfect replacement for big tech clouds.</p>
            </div>
            <div className="grid sm:grid-cols-3 gap-6">
              <div className="p-6 rounded-2xl bg-background border border-border/40 shadow-sm flex flex-col items-center text-center hover:shadow-md transition-shadow">
                <Lightning size={24} className="text-blue-500 mb-3" weight="duotone" />
                <h4 className="font-semibold mb-2">Lightning Fast</h4>
                <p className="text-sm text-muted-foreground">Optimized data fetching means zero waiting times.</p>
              </div>
              <div className="p-6 rounded-2xl bg-background border border-border/40 shadow-sm flex flex-col items-center text-center hover:shadow-md transition-shadow">
                <CloudArrowUp size={24} style={{ color: TEAL }} className="mb-3" weight="duotone" />
                <h4 className="font-semibold mb-2">Self-Hosted</h4>
                <p className="text-sm text-muted-foreground">Deploy to your own infrastructure in minutes.</p>
              </div>
              <div className="p-6 rounded-2xl bg-background border border-border/40 shadow-sm flex flex-col items-center text-center hover:shadow-md transition-shadow">
                <GithubLogo size={24} className="text-zinc-500 mb-3" weight="duotone" />
                <h4 className="font-semibold mb-2">100% Free</h4>
                <p className="text-sm text-muted-foreground">Open-source. No hidden limits, no subscriptions.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Footer CTA ── */}
        <section className="py-20 md:py-32 relative text-center px-4">
          <div className="max-w-3xl mx-auto flex flex-col items-center">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">Ready to secure your data?</h2>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-xl">
              Join the growing community of users taking control of their files with Nimbus.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
              <Link href="/dashboard" className="w-full sm:w-auto">
                <Button size="lg" className="h-12 px-8 text-base w-full sm:w-auto gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer" style={{ backgroundColor: TEAL, color: "white" }}>
                  {user ? "Open Dashboard" : "Get Started Now"}
                </Button>
              </Link>
              <a href="https://github.com/everydaycodings/Nimbus" target="_blank" rel="noreferrer" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="h-12 px-8 text-base w-full sm:w-auto gap-2 border-border/50 hover:bg-secondary/50 cursor-pointer">
                  <GithubLogo size={20} />
                  Star on GitHub
                </Button>
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── Simple Footer ── */}
      <footer className="py-8 border-t border-border/30 text-center text-sm text-muted-foreground bg-secondary/10">
        <p>Built with ❤️ by the open-source community. Code licensed under MIT.</p>
      </footer>
    </div>
  );
}

