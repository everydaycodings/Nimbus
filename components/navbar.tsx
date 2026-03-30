// components/Navbar.tsx
"use client";

import { Bell, List } from "@phosphor-icons/react";
import { UserButton } from "@/components/user-button";
import { SearchBar } from "@/components/SearchBar";
import { useMobileSidebar } from "@/hooks/useSidebarMobile";

export function Navbar() {
  const { toggle } = useMobileSidebar();

  return (
    <header className="flex items-center justify-between border-b border-border bg-background px-4 md:px-6 py-3 gap-3 md:gap-4">
      {/* Mobile hamburger */}
      <button
        onClick={toggle}
        className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150 flex-shrink-0"
        aria-label="Toggle menu"
      >
        <List size={20} weight="bold" />
      </button>

      {/* Search */}
      <SearchBar />

      {/* Right side */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        {/* Notification bell */}
        <button className="relative flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150">
          <Bell size={17} weight="duotone" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#2da07a]" />
        </button>

        {/* Divider */}
        <div className="h-5 w-px bg-border hidden md:block" />

        {/* User */}
        <UserButton />
      </div>
    </header>
  );
}