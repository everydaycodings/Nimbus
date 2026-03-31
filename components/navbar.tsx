// components/Navbar.tsx
"use client";

import { List } from "@phosphor-icons/react";
import { SearchBar } from "@/components/SearchBar";
import { useMobileSidebar } from "@/hooks/useSidebarMobile";
import { UserButton } from "./user-button";
import { NotificationBell } from "./notification-bell";

export function Navbar() {
  const { toggle } = useMobileSidebar();

  return (
    <header className="flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50 px-4 md:px-6 py-3 gap-3 md:gap-4">
      {/* Mobile hamburger */}
      <button
        onClick={toggle}
        className="md:hidden flex items-center justify-center w-9 h-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200"
        aria-label="Toggle menu"
      >
        <List size={22} weight="bold" />
      </button>

      {/* Search */}
      <SearchBar />

      {/* Right side */}
      <div className="flex items-center gap-2 gap-3 flex-shrink-0">
        <NotificationBell />

        {/* Divider */}
        <div className="h-5 w-px bg-border hidden md:block" />

        {/* User */}
        <UserButton />
      </div>
    </header>
  );
}