"use client"
import { createClient } from "@/lib/supabase/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SignOut, Gear, ShieldCheck } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useUserQuery } from "@/hooks/queries/useUserQuery"
import { MFADialog } from "@/components/mfa-dialog"

export function UserButton() {
  const { data: user, isLoading } = useUserQuery()
  const supabase = createClient()
  const router = useRouter()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.refresh()
  }

  if (isLoading || !user) return <div className="w-7 h-7 rounded-full bg-accent animate-pulse" />

  const initials = user.email?.substring(0, 2).toUpperCase() || "NN"
  const isMFAEnabled = user.factors?.some((f: any) => f.status === 'verified')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative outline-none rounded-full transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background group">
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary to-blue-500 opacity-20 blur-sm pointer-events-none group-hover:opacity-40 transition-opacity" />
        <Avatar className="w-7 h-7 md:w-8 md:h-8 border border-border/80 shadow-sm relative z-10 transition-all group-hover:border-primary/50">
          <AvatarImage src={user.user_metadata?.avatar_url} />
          <AvatarFallback className="text-[10px] md:text-xs font-semibold bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        {isMFAEnabled && (
          <div className="absolute -top-0.5 -right-0.5 z-20 w-3 h-3 rounded-full bg-background flex items-center justify-center border border-primary/20 shadow-sm animate-in fade-in zoom-in duration-500">
            <ShieldCheck className="w-2.5 h-2.5 text-primary" weight="bold" />
          </div>
        )}
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

          <MFADialog>
            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="cursor-pointer p-3 rounded-md transition-colors hover:bg-primary/10 focus:bg-primary/10 group">
              <ShieldCheck className="mr-3 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" weight="duotone" />
              <div className="flex flex-col">
                <span className="font-medium group-hover:text-primary transition-colors">Two-Factor Auth</span>
                <span className="text-[10px] text-muted-foreground">{isMFAEnabled ? 'Enabled' : 'Add security'}</span>
              </div>
            </DropdownMenuItem>
          </MFADialog>

          <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer p-3 rounded-md transition-colors mt-1 group">
            <SignOut className="mr-3 h-4 w-4" weight="bold" />
            <span className="font-medium">Log out</span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
