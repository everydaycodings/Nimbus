"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { ShieldCheck, Fingerprint, CircleNotch, Key } from "@phosphor-icons/react"

interface MFAVerificationDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function MFAVerificationDialog({ isOpen, onOpenChange, onSuccess }: MFAVerificationDialogProps) {
  const supabase = createClient()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)

  useEffect(() => {
    if (isOpen) {
      startVerificationFlow()
    } else {
      resetState()
    }
  }, [isOpen])

  const resetState = () => {
    setFactorId(null)
    setChallengeId(null)
    setVerifyCode("")
    setIsLoading(false)
    setIsVerifying(false)
  }

  const startVerificationFlow = async () => {
    setIsLoading(true)
    try {
      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (factorsError) throw factorsError

      const verifiedFactor = factorsData.all.find(f => f.status === 'verified')
      if (!verifiedFactor) {
        toast.error("MFA is not enabled on this account")
        onOpenChange(false)
        return
      }

      setFactorId(verifiedFactor.id)

      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: verifiedFactor.id
      })
      if (challengeError) throw challengeError

      setChallengeId(challengeData.id)
    } catch (error: any) {
      toast.error(error.message || "Failed to start MFA challenge")
      onOpenChange(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!factorId || !challengeId || verifyCode.length !== 6) return
    setIsVerifying(true)
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: verifyCode
      })
      if (error) throw error

      toast.success("Identity verified")
      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.message || "Verification failed")
      setVerifyCode("")
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] overflow-hidden border-border/50 bg-background/80 backdrop-blur-2xl shadow-2xl rounded-2xl p-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/5 pointer-events-none" />
        
        <DialogHeader className="p-6 pb-2 border-b border-border/10">
          <DialogTitle className="flex items-center gap-3 text-xl font-heading">
            <ShieldCheck className="w-6 h-6 text-primary" weight="duotone" />
            Security Verification
          </DialogTitle>
          <DialogDescription className="text-xs">
            Confirm your identity with your two-factor authenticator app.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-6 relative z-10">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <CircleNotch className="w-8 h-8 animate-spin text-primary" weight="bold" />
              <p className="text-xs text-muted-foreground font-medium">Initiating challenge...</p>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex flex-col items-center space-y-4 py-2">
                <div className="p-4 bg-primary/10 rounded-2xl shadow-inner border border-primary/20">
                  <Fingerprint className="w-12 h-12 text-primary" weight="duotone" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold">Enter 6-digit MFA Code</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Open your authenticator app and enter the code to continue.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <Label htmlFor="mfa-verify-code" className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Verification Code</Label>
                    <span className="text-[10px] font-mono text-primary/60">{verifyCode.length}/6</span>
                  </div>
                  <div className="relative group">
                    <Input 
                      id="mfa-verify-code"
                      placeholder="000000"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                      className="h-14 text-center text-2xl tracking-[0.4em] font-mono border-border/60 focus:border-primary/50 focus:ring-primary/10 transition-all rounded-xl shadow-inner bg-muted/30"
                      maxLength={6}
                      autoFocus
                    />
                  </div>
                </div>
                
                <Button 
                  onClick={handleVerify} 
                  disabled={isVerifying || verifyCode.length !== 6}
                  className="w-full h-12 rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-[0.98] font-semibold"
                >
                  {isVerifying ? (
                    <CircleNotch className="mr-2 h-5 w-5 animate-spin" weight="bold" />
                  ) : (
                    <ShieldCheck className="mr-2 h-5 w-5" weight="bold" />
                  )}
                  Continue
                </Button>
                
                <Button 
                  variant="ghost" 
                  onClick={() => onOpenChange(false)}
                  className="w-full text-muted-foreground hover:text-foreground text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
