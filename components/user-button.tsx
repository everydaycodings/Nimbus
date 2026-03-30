"use client"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SignOut, Gear } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"

export function UserButton() {
  const [user, setUser] = useState<any>(null)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
  }, [supabase.auth])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.refresh()
  }

  if (!user) return <div className="w-7 h-7 rounded-full bg-accent animate-pulse" />

  const initials = user.email?.substring(0, 2).toUpperCase() || "NN"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative outline-none rounded-full transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background group">
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary to-blue-500 opacity-20 blur-sm pointer-events-none group-hover:opacity-40 transition-opacity" />
        <Avatar className="w-8 h-8 md:w-9 md:h-9 border border-border/80 shadow-sm relative z-10 transition-all group-hover:border-primary/50">
          <AvatarImage src={user.user_metadata?.avatar_url} />
          <AvatarFallback className="text-[10px] md:text-xs font-semibold bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-2 border-border/50 bg-background/80 backdrop-blur-xl shadow-2xl rounded-xl">
        <DropdownMenuLabel className="font-normal p-3">
          <div className="flex flex-col space-y-2">
            <p className="text-sm font-semibold leading-none tracking-tight">{user.user_metadata?.full_name || 'User Account'}</p>
            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border/40" />
        <div className="p-1">
          <DropdownMenuItem onClick={() => router.push('/settings')} className="cursor-pointer p-3 rounded-md transition-colors hover:bg-primary/10 focus:bg-primary/10 group">
            <Gear className="mr-3 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" weight="duotone" />
            <span className="font-medium group-hover:text-primary transition-colors">Settings</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer p-3 rounded-md transition-colors mt-1 group">
            <SignOut className="mr-3 h-4 w-4 opacity-80 group-hover:opacity-100" weight="bold" />
            <span className="font-medium">Log out</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
