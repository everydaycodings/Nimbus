"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { ShieldCheck, ShieldWarning, Fingerprint, CircleNotch, Trash } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"

interface MFADialogProps {
  children: React.ReactNode
}

export function MFADialog({ children }: MFADialogProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [factors, setFactors] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  
  // Enrollment state
  const [enrollData, setEnrollData] = useState<{ id: string, qr_code: string, secret: string } | null>(null)
  const [verifyCode, setVerifyCode] = useState("")

  useEffect(() => {
    if (isOpen) {
      fetchFactors()
    }
  }, [isOpen])

  const fetchFactors = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      setFactors(data.all || [])
    } catch (error: any) {
      toast.error(error.message || "Failed to load MFA status")
    } finally {
      setIsLoading(false)
    }
  }

  const handleEnroll = async () => {
    setIsActionLoading(true)
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp'
      })
      if (error) throw error
      setEnrollData({
        id: data.id,
        qr_code: data.totp.qr_code,
        secret: data.totp.secret
      })
    } catch (error: any) {
      toast.error(error.message || "Failed to start enrollment")
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!enrollData || verifyCode.length !== 6) return
    setIsActionLoading(true)
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrollData.id
      })
      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollData.id,
        challengeId: challengeData.id,
        code: verifyCode
      })
      if (verifyError) throw verifyError

      toast.success("MFA enabled successfully!")
      setEnrollData(null)
      queryClient.invalidateQueries({ queryKey: ["user"] })
      fetchFactors()
    } catch (error: any) {
      toast.error(error.message || "Verification failed")
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleUnenroll = async (factorId: string) => {
    if (!factorId) return
    setIsActionLoading(true)
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw error
      toast.success("MFA disabled")
      queryClient.invalidateQueries({ queryKey: ["user"] })
      fetchFactors()
    } catch (error: any) {
      toast.error(error.message || "Failed to disable MFA")
    } finally {
      setIsActionLoading(false)
    }
  }

  const isMFAEnabled = factors.some(f => f.status === 'verified')

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open)
      if (!open) {
        setEnrollData(null)
        setVerifyCode("")
      }
    }}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] overflow-hidden border-border/50 bg-background/80 backdrop-blur-2xl shadow-2xl rounded-2xl p-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/5 pointer-events-none" />
        
        <DialogHeader className="p-6 pb-2 border-b border-border/10">
          <DialogTitle className="flex items-center gap-2 text-xl font-heading">
            <ShieldCheck className="w-6 h-6 text-primary" weight="duotone" />
            Security Settings
          </DialogTitle>
          <DialogDescription className="text-xs">
            Protect your Nimbus account with two-factor authentication.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-6 relative z-10">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <CircleNotch className="w-8 h-8 animate-spin text-primary" weight="bold" />
              <p className="text-xs text-muted-foreground font-medium">Checking security status...</p>
            </div>
          ) : enrollData ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col items-center space-y-4">
                <div className="p-4 bg-white rounded-2xl shadow-xl inline-block border-4 border-primary/10">
                  <img 
                    src={enrollData.qr_code} 
                    alt="MFA QR Code" 
                    className="w-48 h-48 rounded-lg"
                  />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold">Scan this QR Code</p>
                  <p className="text-[11px] text-muted-foreground px-4 leading-relaxed">
                    Open your authenticator app (like Google Authenticator or Authy) and scan this code to link your account.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <Label htmlFor="code" className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Verification Code</Label>
                    <span className="text-[10px] font-mono text-primary/60">{verifyCode.length}/6</span>
                  </div>
                  <Input 
                    id="code"
                    placeholder="000000"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                    className="h-14 text-center text-2xl tracking-[0.4em] font-mono border-border/60 focus:border-primary/50 focus:ring-primary/10 transition-all rounded-xl shadow-inner bg-muted/30"
                    maxLength={6}
                    autoFocus
                  />
                </div>
                <Button 
                  onClick={handleVerify} 
                  disabled={isActionLoading || verifyCode.length !== 6}
                  className="w-full h-12 rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-[0.98] font-semibold"
                >
                  {isActionLoading ? (
                    <CircleNotch className="mr-2 h-5 w-5 animate-spin" weight="bold" />
                  ) : (
                    <ShieldCheck className="mr-2 h-5 w-5" weight="bold" />
                  )}
                  Verify and Enable
                </Button>
                <Button 
                  variant="ghost" 
                  onClick={() => setEnrollData(null)}
                  className="w-full text-muted-foreground hover:text-foreground text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {isMFAEnabled ? (
                <div className="p-5 rounded-2xl border border-primary/20 bg-primary/5 space-y-5 shadow-inner">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-primary/20 text-primary shadow-sm">
                        <Fingerprint className="w-6 h-6" weight="duotone" />
                      </div>
                      <div>
                        <p className="text-sm font-bold tracking-tight">MFA is Active</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Authenticator App</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      const factor = factors.find(f => f.status === 'verified')
                      if (factor) handleUnenroll(factor.id)
                    }}
                    disabled={isActionLoading}
                    className="w-full h-11 border-destructive/20 bg-white/50 dark:bg-black/20 hover:bg-destructive hover:text-white transition-all duration-300 group rounded-xl text-xs font-semibold"
                  >
                    <Trash className="w-4 h-4 mr-2" />
                    Disable 2FA Protection
                  </Button>
                </div>
              ) : (
                <div className="p-5 rounded-2xl border border-border/50 bg-muted/10 space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-muted text-muted-foreground/60 shadow-sm">
                      <ShieldWarning className="w-6 h-6" weight="duotone" />
                    </div>
                    <div>
                      <p className="text-sm font-bold tracking-tight text-muted-foreground">MFA is Disabled</p>
                      <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide mt-0.5">Account at higher risk</p>
                    </div>
                  </div>
                  
                  <Button 
                    onClick={handleEnroll} 
                    disabled={isActionLoading}
                    className="w-full h-12 rounded-xl shadow-lg transition-all active:scale-[0.98] font-bold"
                  >
                    {isActionLoading ? (
                      <CircleNotch className="mr-2 h-5 w-5 animate-spin" weight="bold" />
                    ) : (
                      <ShieldCheck className="mr-2 h-5 w-5" weight="bold" />
                    )}
                    Activate MFA
                  </Button>
                </div>
              )}

              <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/10 flex items-start gap-3">
                <div className="mt-0.5 text-orange-500">
                  <ShieldCheck className="w-5 h-5" weight="bold" />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-orange-600/90 uppercase tracking-tight">Security Note</p>
                  <p className="text-[11px] text-orange-600/70 leading-relaxed font-medium">
                    Two-factor authentication adds an extra layer of protection. Even if your password is stolen, your account remains secured by your physical device.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
