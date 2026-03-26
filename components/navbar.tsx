"use client";
import { MagnifyingGlass, Bell } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { UserButton } from "@clerk/nextjs";

export function Navbar() {
  return (
    <header className="flex items-center justify-between border-b border-border bg-background px-6 py-3 gap-4">
      {/* Search */}
      <div className="relative w-full max-w-sm">
        <MagnifyingGlass
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <Input
          placeholder="Search files..."
          className="pl-9 h-9 bg-secondary border-border text-sm placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button className="relative flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150">
          <Bell size={17} weight="duotone" />
          {/* unread dot */}
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