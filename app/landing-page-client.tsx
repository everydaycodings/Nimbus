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
  Image as ImageIcon,
  Ghost,
  Key,
  Eye,
  Clock,
  ClockCounterClockwise,
  ArrowCounterClockwise,
  LockSimple,
  DownloadSimple,
  Warning,
  HardDrive,
  FolderSimplePlus,
  House,
  Star,
  Trash,
  Bell,
  CaretDown,
  SquaresFour,
  List,
  File,
  FolderSimple,
  Plus
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
        <section className="relative pt-24 pb-20 md:pt-40 md:pb-32 flex flex-col items-center text-center overflow-hidden">
          <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-6 flex flex-col items-center">
            {/* Github Stars Pill - Updated Design */}
            <div className="mb-10 animate-fade-in translate-y-[-10px]">
              <a 
                href="https://github.com/everydaycodings/Nimbus"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2.5 px-1 py-1 pr-4 rounded-full border border-border/40 bg-secondary/20 backdrop-blur-md hover:bg-secondary/40 transition-all cursor-pointer shadow-sm group ring-1 ring-white/5"
              >
                <div className="h-7 px-3 rounded-full bg-foreground/5 dark:bg-white/5 flex items-center gap-1.5 border border-border/20">
                  <GithubLogo size={14} weight="bold" className="text-foreground/70 group-hover:text-foreground transition-colors" />
                  <span className="text-[11px] font-bold tracking-tight text-foreground/80 group-hover:text-foreground transition-colors uppercase">v1.2</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs md:text-sm font-semibold" style={{ color: TEAL }}>
                  <Sparkle size={14} weight="fill" className="animate-pulse" />
                  <span className="tracking-tight">{initialStars.toLocaleString()} GitHub Stars</span>
                </div>
                <div className="w-4 h-4 rounded-full bg-secondary/40 flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                  <ArrowRight size={10} className="text-muted-foreground" weight="bold" />
                </div>
              </a>
            </div>

            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter mb-8 max-w-5xl text-balance leading-[0.95] drop-shadow-sm">
              The <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#2da07a] via-[#3cc398] to-[#2da07a] animate-gradient-x">sovereign</span> cloud <br className="hidden md:block"/>
              <span className="text-foreground">for your files</span>
            </h1>
            
            <p className="text-lg md:text-2xl text-muted-foreground/80 max-w-3xl mx-auto mb-12 text-balance leading-normal font-medium tracking-tight">
              Nimbus is an ultra-minimalist, high-performance file manager with zero-knowledge encryption. <span className="text-foreground/60">Self-host your data. No compromises.</span>
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-5 w-full sm:w-auto">
              <Link href="/dashboard" className="w-full sm:w-auto">
                <Button 
                  size="lg" 
                  className="h-14 px-10 text-lg w-full sm:w-auto gap-3 group shadow-[0_10px_30px_-10px_rgba(45,160,122,0.4)] hover:shadow-[0_15px_40px_-12px_rgba(45,160,122,0.5)] transition-all duration-300 transform hover:-translate-y-0.5 active:scale-95 cursor-pointer font-bold rounded-2xl" 
                  style={{ backgroundColor: TEAL, color: "white" }}
                >
                  {user ? "Open Dashboard" : "Get Started Now"}
                  <div className="bg-white/10 p-1 rounded-md group-hover:bg-white/20 transition-colors">
                    <ArrowRight size={18} weight="bold" />
                  </div>
                </Button>
              </Link>
              <a href="https://github.com/everydaycodings/Nimbus" target="_blank" rel="noreferrer" className="w-full sm:w-auto">
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="h-14 px-10 text-lg w-full sm:w-auto gap-3 border-border/40 bg-secondary/10 hover:bg-secondary/30 backdrop-blur-sm transition-all duration-300 transform hover:-translate-y-0.5 active:scale-95 cursor-pointer font-bold rounded-2xl group shadow-sm"
                >
                  <GithubLogo size={22} weight="duotone" className="group-hover:rotate-12 transition-transform" />
                  View the Code
                </Button>
              </a>
            </div>

            {/* Decorative bottom element */}
            <div className="mt-16 sm:mt-24 flex items-center justify-center gap-12 sm:gap-24 opacity-30 grayscale hover:grayscale-0 transition-all duration-500">
               <div className="flex items-center gap-2">
                 <ShieldCheck size={20} weight="fill" />
                 <span className="text-[10px] font-black uppercase tracking-[0.2em]">End-to-End</span>
               </div>
               <div className="flex items-center gap-2">
                 <CloudArrowUp size={20} weight="fill" />
                 <span className="text-[10px] font-black uppercase tracking-[0.2em]">Self-Hosted</span>
               </div>
               <div className="flex items-center gap-2">
                 <Lightning size={20} weight="fill" />
                 <span className="text-[10px] font-black uppercase tracking-[0.2em]">Zero Latency</span>
               </div>
            </div>
          </div>
        </section>

        {/* ── App Preview (Dashboard Reference) ── */}
        <section className="px-4 md:px-6 max-w-6xl mx-auto mb-24 md:mb-32 relative group">
          {/* Enhanced background glow */}
          <div className="absolute -inset-4 bg-gradient-to-tr from-[#2da07a]/20 via-transparent to-purple-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none" />
          
          <div className="relative rounded-2xl border border-border/40 bg-[#0d0d0d] p-2 md:p-3 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] backdrop-blur-md transform transition-all duration-700 hover:-translate-y-2">
            <div className="rounded-xl border border-border/40 bg-[#0d0d0d] overflow-hidden aspect-[4/5] sm:aspect-video flex flex-col shadow-inner">
              
              {/* Fake App header */}
              <div className="h-12 sm:h-14 border-b border-white/5 flex items-center px-4 sm:px-6 gap-2 sm:gap-4 bg-[#0d0d0d]">
                {/* Search box inspired by image */}
                <div className="h-8 sm:h-9 flex-1 max-w-md rounded-lg bg-secondary/10 flex items-center px-3 sm:px-4 border border-white/5 shadow-inner group/search overflow-hidden">
                  <MagnifyingGlass size={16} className="text-muted-foreground mr-2 sm:mr-3 shrink-0" />
                  <span className="text-[10px] sm:text-xs text-muted-foreground flex-1 truncate">Search files and folders...</span>
                  <span className="ml-auto hidden md:inline-block px-1.5 py-0.5 rounded-md border border-white/10 bg-black/40 text-[9px] font-mono opacity-50">⌘K</span>
                </div>

                <div className="flex items-center gap-3 sm:gap-4 ml-auto shrink-0">
                   <Bell size={18} className="text-muted-foreground opacity-60 hidden sm:block" />
                   <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-tr from-teal-500/80 to-teal-200/80 border border-white/10 shadow-sm" />
                </div>
              </div>

              {/* Fake App Body */}
              <div className="flex-1 flex overflow-hidden">
                
                {/* Dashboard Sidebar */}
                <div className="w-48 md:w-56 border-r border-white/5 hidden sm:flex flex-col p-4 bg-[#0d0d0d]">
                  <div className="flex items-center gap-2 mb-8 px-2">
                     <div className="w-6 h-6 rounded bg-[#2da07a] flex items-center justify-center text-white scale-90">
                        <CloudArrowUp size={14} weight="bold" />
                     </div>
                     <span className="text-sm font-bold tracking-tight">Nimbus</span>
                  </div>
                  
                  <div className="space-y-0.5 mb-8">
                    {[
                      { icon: House, label: "Home", active: true },
                      { icon: HardDrive, label: "My Files" },
                      { icon: FolderLock, label: "Private Vault" },
                      { icon: ShieldCheck, label: "Offline Vault" },
                      { icon: Clock, label: "Recent" },
                      { icon: Star, label: "Starred" },
                      { icon: ShareNetwork, label: "Sharing" },
                      { icon: Sparkle, label: "Activity" },
                      { icon: Trash, label: "Trash" },
                    ].map((item, idx) => (
                      <div 
                        key={idx} 
                        className={`h-9 rounded-lg flex items-center px-3 gap-3 transition-all ${
                          item.active 
                            ? 'bg-[#2da07a]/10 text-[#2da07a]' 
                            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                        }`}
                      >
                         <item.icon size={18} weight={item.active ? "fill" : "regular"} />
                         <span className="text-xs font-medium">{item.label}</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Storage Section with breakdown colors from image */}
                  <div className="mt-auto p-3 bg-white/[0.02] rounded-xl border border-white/5">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-2">
                       <span className="font-bold uppercase tracking-tighter opacity-50">Storage</span>
                       <span className="font-medium">87.8 MB / 1.00 GB</span>
                    </div>
                    <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden flex mb-3">
                       <div className="h-full bg-blue-500" style={{ width: '15%' }} />
                       <div className="h-full bg-purple-500" style={{ width: '25%' }} />
                       <div className="h-full bg-yellow-500" style={{ width: '10%' }} />
                       <div className="h-full bg-red-500" style={{ width: '3%' }} />
                    </div>
                    <div className="grid grid-cols-2 gap-y-1.5 mt-2">
                       {[
                         { color: 'bg-[#2da07a]', label: 'Images' },
                         { color: 'bg-blue-500', label: 'Videos' },
                         { color: 'bg-yellow-500', label: 'Docs' },
                         { color: 'bg-red-500', label: 'Other' },
                       ].map((t, i) => (
                         <div key={i} className="flex items-center gap-1.5 text-[9px] text-muted-foreground font-medium">
                            <div className={`w-1.5 h-1.5 rounded-full ${t.color}`} />
                            {t.label}
                         </div>
                       ))}
                    </div>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 p-4 sm:p-6 flex flex-col gap-4 sm:gap-6 bg-[#000000]/20 overflow-y-auto">
                  
                  {/* Dashboard Header */}
                  <div className="flex items-end justify-between">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold mb-0.5 sm:mb-1 leading-none">Home</h2>
                      <p className="text-[9px] sm:text-[10px] text-muted-foreground opacity-50 uppercase font-black tracking-widest leading-none">3 folders, 8 files</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-8 sm:h-9 px-3 sm:px-4 rounded-lg bg-white/[0.03] border border-white/10 text-white flex items-center gap-2 text-[11px] sm:text-xs font-bold hover:bg-white/10 transition-colors cursor-pointer">
                        <Plus size={14} weight="bold" />
                        <span>New</span>
                        <CaretDown size={12} weight="bold" className="opacity-40" />
                      </div>
                    </div>
                  </div>

                  {/* Filter chips from image - Scrollable on mobile */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                       {["All Files", "Sort", "Size", "Tags"].map((f, i) => (
                         <div key={i} className="h-7 sm:h-8 px-2.5 sm:px-3 rounded-md bg-white/[0.03] border border-white/5 flex items-center gap-2 text-[9px] sm:text-[10px] font-bold text-muted-foreground hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap overflow-hidden">
                            <div className="w-4 h-4 rounded border border-white/10 flex items-center justify-center opacity-40 shrink-0">
                               {i === 0 ? <SquaresFour size={10} /> : <List size={10} />}
                            </div>
                            {f}
                            <CaretDown size={10} className="opacity-40 shrink-0" />
                         </div>
                       ))}
                    </div>
                    <div className="h-7 sm:h-8 p-1 rounded-md bg-white/[0.03] border border-white/5 items-center hidden sm:flex">
                       <div className="h-5 sm:h-6 w-5 sm:w-6 rounded bg-black/40 flex items-center justify-center text-muted-foreground">
                          <List size={14} />
                       </div>
                       <div className="h-5 sm:h-6 w-5 sm:w-6 rounded flex items-center justify-center text-white">
                          <SquaresFour size={14} />
                       </div>
                    </div>
                  </div>

                  {/* Folders Section */}
                  <div>
                    <h3 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 sm:mb-4 opacity-40">Folders</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                       {[
                         { label: "Torrent", date: "Mar 31, 2026" },
                         { label: "zip", date: "Mar 31, 2026", tags: true },
                         { label: "Memories", date: "Apr 1, 2026" },
                       ].map((folder, i) => (
                         <div key={i} className={`rounded-xl border border-white/5 bg-white/[0.02] p-3 sm:p-4 flex flex-col gap-3 sm:gap-4 group/card hover:bg-white/[0.04] transition-all cursor-pointer ${i === 2 ? 'hidden sm:flex' : 'flex'}`}>
                            <FolderSimple size={24} weight="fill" className="text-[#2da07a]" />
                            <div className="min-w-0">
                               <div className="text-xs sm:text-sm font-bold mb-0.5 sm:mb-1 truncate">{folder.label}</div>
                               <div className="text-[9px] sm:text-[10px] text-muted-foreground opacity-40">{folder.date}</div>
                               {folder.tags && (
                                 <div className="flex gap-1 mt-2.5 sm:mt-3 overflow-hidden">
                                    <div className="h-3.5 sm:h-4 px-1.5 sm:px-2 rounded-full bg-blue-500/10 text-[7px] sm:text-[8px] text-blue-500 font-bold border border-blue-500/20 flex items-center">src</div>
                                    <div className="h-3.5 sm:h-4 px-1.5 sm:px-2 rounded-full bg-red-500/10 text-[7px] sm:text-[8px] text-red-500 font-bold border border-red-500/20 flex items-center">docs</div>
                                 </div>
                               )}
                            </div>
                         </div>
                       ))}
                    </div>
                  </div>

                  {/* Files Section */}
                  <div>
                    <h3 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3 sm:mb-4 opacity-40">Files</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                       {[
                         { label: "happy-cat.png", sub: "487.2 KB • Apr 2", icon: ImageIcon, color: "text-purple-500", bg: "bg-purple-500/15" },
                         { label: "Gemin_image.png", sub: "1.9 MB • Apr 1", icon: ImageIcon, color: "text-purple-500", bg: "bg-purple-500/15", project: true },
                         { label: "shopease.zip", sub: "30.5 MB • Apr 1", icon: File, color: "text-white/40", bg: "bg-white/5" },
                         { label: "code-src.zip", sub: "9.5 MB • Apr 1", icon: File, color: "text-white/40", bg: "bg-white/5" },
                       ].map((file, i) => (
                         <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 sm:p-3.5 flex flex-col gap-3 sm:gap-4 group/card hover:bg-white/[0.04] transition-all cursor-pointer">
                            <div className={`w-8 sm:w-9 h-8 sm:h-9 rounded-lg flex items-center justify-center ${file.bg} shadow-inner shrink-0`}>
                               <file.icon size={16} weight={file.icon === File ? "regular" : "fill"} className={file.color} />
                            </div>
                            <div className="min-w-0">
                               <div className="text-[10px] sm:text-[11px] font-bold truncate mb-0.5 sm:mb-1">{file.label}</div>
                               <div className="text-[8px] sm:text-[9px] text-muted-foreground opacity-40 mb-1.5 sm:mb-2 truncate">{file.sub}</div>
                               <div className="flex gap-1 overflow-hidden">
                                 {file.project && (
                                   <div className="h-3.5 sm:h-4 px-1.5 sm:px-2 rounded-full bg-[#2da07a]/10 text-[7px] sm:text-[8px] text-[#2da07a] font-bold border border-[#2da07a]/20 flex items-center">Projects</div>
                                 )}
                               </div>
                            </div>
                         </div>
                       ))}
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

            {/* Feature: Offline Vault (New) */}
            <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
              <div className="flex-1 space-y-6">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#2da07a]/10 border border-[#2da07a]/20">
                  <HardDrive size={24} style={{ color: TEAL }} weight="duotone" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold tracking-tight">Offline-First <span style={{ color: TEAL }}>Local Safe</span></h3>
                <p className="text-lg text-muted-foreground leading-relaxed text-balance">
                  Absolute privacy means no servers. Store your most sensitive assets in an isolated browser-side vault that never touches the cloud.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                  <div className="p-4 rounded-2xl bg-secondary/30 border border-border/40 hover:border-primary/20 transition-colors">
                    <HardDrive size={20} style={{ color: TEAL }} className="mb-2" weight="fill" />
                    <h4 className="font-bold text-sm mb-1">Zero-Server Storage</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">Files stay in your browser's sandboxed filesystem (OPFS).</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-secondary/30 border border-border/40 hover:border-primary/20 transition-colors">
                    <ShieldCheck size={20} style={{ color: TEAL }} className="mb-2" weight="fill" />
                    <h4 className="font-bold text-sm mb-1">Multi-Vault Isolation</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">Create separate secure containers with unique passphrases.</p>
                  </div>
                   <div className="p-4 rounded-2xl bg-secondary/30 border border-border/40 hover:border-primary/20 transition-colors">
                    <FolderSimplePlus size={20} style={{ color: TEAL }} className="mb-2" weight="fill" />
                    <h4 className="font-bold text-sm mb-1">Folder Hierarchies</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">Full folder support with recursive local encrypted uploads.</p>
                  </div>
                   <div className="p-4 rounded-2xl bg-secondary/30 border border-border/40 hover:border-primary/20 transition-colors">
                    <LockSimple size={20} style={{ color: TEAL }} className="mb-2" weight="fill" />
                    <h4 className="font-bold text-sm mb-1">AES-256-GCM</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">Client-side derivation using PBKDF2 with 310k iterations.</p>
                  </div>
                </div>
              </div>
              <div className="flex-1 w-full relative">
                <div className="rounded-2xl border border-border/40 bg-secondary/10 p-2 shadow-2xl backdrop-blur-md relative overflow-hidden group">
                  <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#2da07a 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
                  <div className="rounded-xl border border-border/40 bg-background overflow-hidden aspect-[4/3] flex flex-col shadow-inner relative">
                    <div className="h-10 border-b border-border/20 bg-secondary/20 flex items-center px-4 justify-between">
                       <div className="h-2 w-24 bg-foreground/10 rounded-full" />
                       <ShieldCheck size={14} style={{ color: TEAL }} weight="fill" />
                    </div>
                    <div className="flex-1 p-6 grid grid-cols-2 gap-4">
                       {[1,2].map(i => (
                         <div key={i} className="rounded-2xl border border-border/40 bg-background/50 p-4 flex flex-col items-center justify-center gap-2 shadow-sm">
                           <div className="w-10 h-10 rounded-xl bg-secondary/50 flex items-center justify-center">
                              <LockSimple size={20} style={{ color: TEAL }} weight="duotone" />
                           </div>
                           <div className="h-2 w-16 bg-foreground/10 rounded-full" />
                           <div className="h-1.5 w-10 bg-muted-foreground/10 rounded-full" />
                         </div>
                       ))}
                       <div className="col-span-2 mt-2 space-y-2">
                          {[1,2].map(i => (
                            <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-[#2da07a]/5 border border-[#2da07a]/10">
                               <FolderSimplePlus size={18} style={{ color: TEAL }} weight="fill" />
                               <div className="h-2 w-32 bg-foreground/10 rounded-full" />
                               <div className="ml-auto h-2 w-8 bg-muted-foreground/10 rounded-full" />
                            </div>
                          ))}
                       </div>
                    </div>
                    <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-md border border-border/40 shadow-lg flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-[#2da07a] animate-pulse" />
                       <span className="text-[10px] font-black uppercase tracking-widest text-[#2da07a]">Locked Locally</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature: Stealth Mode (Plausible Deniability) */}
            <div className="flex flex-col md:flex-row-reverse items-center gap-12 lg:gap-20 relative">
              {/* Background glow for Stealth section */}
              <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[150%] bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(168,85,247,0.08),rgba(255,255,255,0))] dark:bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(168,85,247,0.06),rgba(0,0,0,0))] pointer-events-none" />
              
              <div className="flex-1 space-y-6">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-purple-500/10 border border-purple-500/20">
                  <Ghost size={24} className="text-purple-500" weight="duotone" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold tracking-tight">Beyond Encryption: <br/><span className="text-purple-500">Plausible Deniability</span></h3>
                <p className="text-lg text-muted-foreground leading-relaxed text-balance">
                  The ultimate privacy layer. Use different passwords to unlock different realities. No one—not even a server admin—can prove your hidden vault exists.
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                  <li className="flex items-center gap-3 text-muted-foreground text-sm">
                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                      <Ghost size={16} className="text-purple-500" />
                    </div>
                    Hidden even from DB lists
                  </li>
                  <li className="flex items-center gap-3 text-muted-foreground text-sm">
                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                      <Key size={16} className="text-purple-500" />
                    </div>
                    One field, dual passwords
                  </li>
                  <li className="flex items-center gap-3 text-muted-foreground text-sm">
                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                      <Eye size={16} className="text-purple-500" />
                    </div>
                    Deterministic stealth IDs
                  </li>
                  <li className="flex items-center gap-3 text-muted-foreground text-sm">
                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                      <ShieldCheck size={16} className="text-purple-500" />
                    </div>
                    Zero-knowledge stealth
                  </li>
                </ul>
              </div>

              <div className="flex-1 w-full relative">
                <div className="rounded-2xl border border-border/40 bg-secondary/10 p-2 shadow-2xl backdrop-blur-sm relative overflow-hidden group">
                  <div className="rounded-xl border border-border/40 bg-background overflow-hidden aspect-[4/3] flex flex-col shadow-inner relative">
                    {/* Split View Mockup */}
                    <div className="flex-1 flex overflow-hidden">
                      {/* Left: Normal Reality */}
                      <div className="flex-1 border-r border-border/20 bg-secondary/5 p-4 flex flex-col gap-3">
                        <div className="h-6 w-16 bg-foreground/10 rounded-full mb-1" />
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-background border border-border/40 shadow-sm">
                           <div className="w-8 h-8 rounded bg-teal-500/10 flex items-center justify-center">
                              <FolderLock size={16} className="text-[#2da07a]" weight="duotone" />
                           </div>
                           <div className="h-2 w-20 bg-foreground/10 rounded-full" />
                        </div>
                        {[1,2].map(i => (
                          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-background border border-border/40 shadow-sm opacity-60">
                            <div className="w-8 h-8 rounded bg-muted-foreground/10 flex items-center justify-center" />
                            <div className="h-2 w-16 bg-muted-foreground/10 rounded-full" />
                          </div>
                        ))}
                        <div className="mt-auto pt-2 border-t border-border/20 text-[10px] text-muted-foreground font-mono">
                          PASS: my-taxes-2026
                        </div>
                      </div>
                      
                      {/* Right: Stealth Reality */}
                      <div className="flex-1 bg-purple-500/[0.03] p-4 flex flex-col gap-3 relative">
                        <div className="absolute top-2 right-2 opacity-20">
                           <Ghost size={40} className="text-purple-500" weight="duotone" />
                        </div>
                        <div className="h-6 w-16 bg-purple-500/10 rounded-full mb-1" />
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 shadow-sm ring-1 ring-purple-500/20">
                           <div className="w-8 h-8 rounded bg-purple-500/20 flex items-center justify-center">
                              <Ghost size={16} className="text-purple-500" weight="duotone" />
                           </div>
                           <div className="h-2 w-20 bg-purple-500/40 rounded-full" />
                        </div>
                        {[1,2].map(i => (
                          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-purple-500/5 border border-purple-500/10 shadow-sm">
                            <div className="w-8 h-8 rounded bg-purple-500/10 flex items-center justify-center">
                              <ShieldCheck size={16} className="text-purple-500/40" />
                            </div>
                            <div className="h-2 w-12 bg-purple-500/20 rounded-full" />
                          </div>
                        ))}
                        <div className="mt-auto pt-2 border-t border-border/20 text-[10px] text-purple-500/70 font-mono">
                          PASS: hidden-ghost-key
                        </div>
                      </div>
                    </div>
                    
                    {/* Center Password Field overlap */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 rounded-xl border border-border/40 bg-background/90 backdrop-blur-xl shadow-2xl p-4 flex flex-col gap-3 group-hover:scale-110 transition-transform duration-500 ring-1 ring-white/10">
                       <div className="flex items-center gap-2">
                          <Key size={14} className="text-muted-foreground" />
                          <div className="h-2 w-20 bg-foreground/10 rounded-full" />
                       </div>
                       <div className="h-8 rounded-lg bg-secondary/50 border border-border flex items-center px-3 justify-between">
                          <div className="flex gap-1">
                             {[1,2,3,4,5,6].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-foreground/40" />)}
                          </div>
                          <Eye size={12} className="text-muted-foreground" />
                       </div>
                       <div className="h-8 rounded-lg bg-foreground text-background flex items-center justify-center text-[10px] font-bold uppercase tracking-wider shadow-sm">
                          Unlock Access
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

            {/* Feature: File Versioning */}
            <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
              <div className="flex-1 space-y-6">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#2da07a]/10 border border-[#2da07a]/20">
                  <ClockCounterClockwise size={24} style={{ color: TEAL }} weight="duotone" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold tracking-tight">Version <span style={{ color: TEAL }}>Control</span></h3>
                <p className="text-lg text-muted-foreground leading-relaxed text-balance">
                  Never worry about overwriting or losing changes. Nimbus automatically keeps track of every version of your files, allowing you to restore or download previous states instantly.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                  <div className="p-4 rounded-2xl bg-secondary/30 border border-border/40 hover:border-primary/20 transition-colors">
                    <ClockCounterClockwise size={20} style={{ color: TEAL }} className="mb-2" weight="fill" />
                    <h4 className="font-bold text-sm mb-1">Time Travel</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">Instantly jump back to any previous version of your document.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-secondary/30 border border-border/40 hover:border-primary/20 transition-colors">
                    <DownloadSimple size={20} style={{ color: TEAL }} className="mb-2" weight="fill" />
                    <h4 className="font-bold text-sm mb-1">Partial Recovery</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">Download old versions without affecting your current file.</p>
                  </div>
                </div>
              </div>
              <div className="flex-1 w-full relative">
                <div className="rounded-2xl border border-border/40 bg-secondary/10 p-2 shadow-2xl backdrop-blur-md relative overflow-hidden group">
                  <div className="rounded-xl border border-border/40 bg-background overflow-hidden aspect-[4/3] flex flex-col shadow-inner relative">
                    <div className="h-10 border-b border-border/20 bg-secondary/20 flex items-center px-4 justify-between">
                       <div className="h-2 w-24 bg-foreground/10 rounded-full" />
                       <ClockCounterClockwise size={14} style={{ color: TEAL }} weight="fill" />
                    </div>
                    <div className="flex-1 p-6 flex flex-col gap-3">
                       {[1,2,3].map(i => (
                         <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${i === 1 ? 'bg-[#2da07a]/5 border-[#2da07a]/20 shadow-sm' : 'bg-background/50 border-border/40 opacity-60'}`}>
                            <div className="w-8 h-8 rounded-lg bg-secondary flex flex-col items-center justify-center text-[8px] font-bold text-muted-foreground">
                               <span className="opacity-60">V</span>{4-i}
                            </div>
                            <div className="space-y-1.5 flex-1">
                               <div className={`h-2 rounded-full ${i === 1 ? 'bg-foreground/20 w-32' : 'bg-foreground/10 w-24'}`} />
                               <div className="h-1.5 w-16 bg-muted-foreground/10 rounded-full" />
                            </div>
                            {i === 1 ? (
                              <div className="px-2 py-1 rounded-md bg-[#2da07a] text-[8px] font-bold text-white uppercase tracking-wider">Current</div>
                            ) : (
                               <div className="w-6 h-6 rounded-md border border-border/60 flex items-center justify-center">
                                  <ArrowCounterClockwise size={12} className="text-muted-foreground" weight="bold" />
                               </div>
                            )}
                         </div>
                       ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 3: Advanced Sharing */}
            <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
              <div className="flex-1 space-y-6">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-orange-500/10 border border-orange-500/20">
                  <ShareNetwork size={24} className="text-orange-500" weight="duotone" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold tracking-tight">Enterprise-Grade Sharing</h3>
                <p className="text-lg text-muted-foreground leading-relaxed text-balance">
                  Share files securely with anyone. From self-destructing "Reveal and Burn" links to password-protected transfers, you're always in control of your data.
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 mt-4">
                  <li className="flex items-center gap-3 text-muted-foreground text-sm"><ShieldCheck size={18} className="text-orange-500" /> Reveal & Burn (Self-destruct)</li>
                  <li className="flex items-center gap-3 text-muted-foreground text-sm"><LockSimple size={18} className="text-orange-500" /> Password-protected links</li>
                  <li className="flex items-center gap-3 text-muted-foreground text-sm"><DownloadSimple size={18} className="text-orange-500" /> Toggle download permissions</li>
                  <li className="flex items-center gap-3 text-muted-foreground text-sm"><Clock size={18} className="text-orange-500" /> Configurable link expiry</li>
                </ul>
              </div>
              <div className="flex-1 w-full relative">
                <div className="rounded-2xl border border-border/40 bg-secondary/10 p-2 shadow-xl backdrop-blur-sm relative">
                  <div className="absolute -right-8 top-8 w-32 h-32 bg-orange-500/10 rounded-full blur-2xl" />
                  <div className="rounded-xl border border-border/40 bg-background overflow-hidden aspect-[4/3] flex flex-col shadow-inner relative z-10">
                    <div className="flex-1 bg-secondary/20 flex flex-col relative overflow-hidden">
                       <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/10 to-transparent flex items-center justify-between px-4 z-10">
                          <div className="h-2 w-24 bg-foreground/20 rounded-full" />
                       </div>
                       <div className="flex-1 m-4 mt-10 rounded-lg bg-orange-500/5 border border-orange-500/10 flex flex-col items-center justify-center gap-4">
                          <ImageIcon size={40} className="text-orange-500/30" weight="duotone" />
                       </div>
                    </div>
                    {/* Share Link Popover simulated */}
                    <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-border/50 bg-background/95 backdrop-blur-md shadow-2xl p-4 flex flex-col z-20 overflow-hidden">
                       <div className="flex items-center justify-between mb-4">
                         <div className="flex items-center gap-2">
                           <div className="w-6 h-6 rounded bg-orange-500/10 flex items-center justify-center">
                             <ShareNetwork size={12} className="text-orange-500" />
                           </div>
                           <span className="text-xs font-bold truncate">project_assets.zip</span>
                         </div>
                         <div className="h-5 px-2 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-1.5 animate-pulse">
                           <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                           <span className="text-[9px] font-black uppercase text-red-600">Reveal & Burn</span>
                         </div>
                       </div>

                       <div className="flex flex-col gap-2 mb-4">
                         <div className="flex items-center gap-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-[#2da07a] font-medium flex items-center gap-1">
                               <LockSimple size={9} weight="bold" /> Protected
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-[#2da07a] font-medium flex items-center gap-1">
                               <DownloadSimple size={9} weight="bold" /> Read-only
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto">Expires in 1h</span>
                         </div>
                         <div className="flex gap-2">
                           <div className="flex-1 h-8 rounded-lg bg-secondary/50 border border-border flex items-center px-3 overflow-hidden">
                             <span className="text-[10px] text-muted-foreground font-mono truncate">nimbus.app/share/xP9k...</span>
                           </div>
                           <div className="h-8 px-3 rounded-lg bg-foreground text-background flex items-center justify-center text-[10px] font-bold shadow-sm">
                             Copy
                           </div>
                         </div>
                       </div>
                       
                       <div className="flex items-center gap-2 pt-3 border-t border-border/40">
                         <div className="w-6 h-6 rounded-full bg-foreground/10 border border-border/40" />
                         <div className="h-2.5 w-24 bg-foreground/10 rounded-full" />
                         <div className="ml-auto flex -space-x-2">
                            {[1,2,3].map(i => <div key={i} className="w-5 h-5 rounded-full border-2 border-background bg-secondary shadow-sm" />)}
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

