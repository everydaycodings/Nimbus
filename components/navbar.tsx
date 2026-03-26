// components/Navbar.tsx
"use client";

import { Bell } from "@phosphor-icons/react";
import { UserButton } from "@clerk/nextjs";
import { SearchBar } from "@/components/SearchBar";

export function Navbar() {
  return (
    <header className="flex items-center justify-between border-b border-border bg-background px-6 py-3 gap-4">
      {/* Search */}
      <SearchBar />

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button className="relative flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150">
          <Bell size={17} weight="duotone" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#2da07a]" />
        </button>

        {/* Divider */}
        <div className="h-5 w-px bg-border" />

        {/* User */}
        <UserButton
          appearance={{
            elements: {
              avatarBox: "w-7 h-7",
            },
          }}
        />
      </div>
    </header>
  );
}