"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnvelopeSimple, LockKey, CircleNotch, GithubLogo, GoogleLogo, Eye, EyeSlash, ShieldCheck, ArrowLeft } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // MFA States
  const [isVerifyingMfa, setIsVerifyingMfa] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      // Check if MFA is required
      if (data.session) {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;

        const verifiedFactors = factors.all.filter(f => f.status === 'verified');
        if (verifiedFactors.length > 0) {
          setIsVerifyingMfa(true);
          setMfaFactorId(verifiedFactors[0].id);
          toast.info("Verification code required");
          return;
        }
      }

      toast.success("Successfully logged in!");
      router.push("/");
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "An error occurred during login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId || mfaCode.length !== 6) return;
    setIsLoading(true);

    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaCode
      });
      if (verifyError) throw verifyError;

      toast.success("MFA verified! Logging in...");
      router.push("/");
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "Invalid verification code");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: 'google' | 'github') => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        toast.error(error.message);
        setIsLoading(false);
      }
    } catch (error: any) {
      toast.error(error.message || `An error occurred during ${provider} login`);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background/50 relative overflow-hidden p-4">
      {/* Dynamic Background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] opacity-50 pointer-events-none" />

      <Card className="w-full max-w-[400px] border-border/50 bg-background/80 backdrop-blur-xl shadow-xl sm:shadow-2xl relative z-10 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-blue-500 opacity-50" />
        
        <CardHeader className="space-y-2 text-center pb-6">
          <CardTitle className="text-3xl font-heading font-bold tracking-tight">
            {isVerifyingMfa ? "Verify Identity" : "Welcome back"}
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs">
            {isVerifyingMfa 
              ? "Enter the 6-digit code from your authenticator app." 
              : "Sign in to access your cloud storage"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {!isVerifyingMfa ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Button 
                  variant="outline" 
                  className="w-full h-11 bg-background hover:bg-accent hover:text-accent-foreground transition-all"
                  onClick={() => handleOAuthLogin('github')}
                  disabled={isLoading}
                  type="button"
                >
                  <GithubLogo weight="bold" className="mr-2 h-5 w-5" />
                  GitHub
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full h-11 bg-background hover:bg-accent hover:text-accent-foreground transition-all"
                  onClick={() => handleOAuthLogin('google')}
                  disabled={isLoading}
                  type="button"
                >
                  <GoogleLogo weight="bold" className="mr-2 h-5 w-5" />
                  Google
                </Button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/50" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                  <span className="bg-background px-2">
                    Or continue with email
                  </span>
                </div>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
                      <EnvelopeSimple size={18} />
                    </div>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      className="pl-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all rounded-xl"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
                      <LockKey size={18} />
                    </div>
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-10 pr-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all rounded-xl"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                
                <Button 
                  type="submit" 
                  className="w-full h-12 mt-4 font-bold transition-all active:scale-[0.98] rounded-xl shadow-lg shadow-primary/20" 
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <CircleNotch size={20} className="animate-spin" weight="bold" />
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </>
          ) : (
            <form onSubmit={handleMfaVerify} className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="flex justify-center py-2">
                <div className="p-4 rounded-2xl bg-primary/10 text-primary ring-4 ring-primary/5 shadow-inner">
                  <ShieldCheck size={40} weight="duotone" />
                </div>
              </div>
              
              <div className="space-y-2 text-center">
                <div className="flex justify-between items-center px-1">
                  <Label htmlFor="mfaCode" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Verification Code</Label>
                  <span className="text-[10px] font-mono text-primary/60">{mfaCode.length}/6</span>
                </div>
                <Input
                  id="mfaCode"
                  type="text"
                  placeholder="000000"
                  className="h-14 text-center text-3xl tracking-[0.5em] font-mono bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all rounded-xl shadow-inner"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
                  required
                  autoFocus
                  maxLength={6}
                />
              </div>

              <div className="space-y-3">
                <Button 
                  type="submit" 
                  className="w-full h-12 font-bold transition-all active:scale-[0.98] rounded-xl shadow-lg shadow-primary/20" 
                  disabled={isLoading || mfaCode.length !== 6}
                >
                  {isLoading ? (
                    <CircleNotch size={20} className="animate-spin" weight="bold" />
                  ) : (
                    "Verify & Sign In"
                  )}
                </Button>
                <Button 
                  type="button"
                  variant="ghost" 
                  className="w-full h-10 text-muted-foreground hover:text-foreground transition-colors text-xs font-semibold"
                  onClick={() => {
                    setIsVerifyingMfa(false);
                    setMfaCode("");
                  }}
                >
                  <ArrowLeft size={14} className="mr-2" />
                  Back to login
                </Button>
              </div>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex justify-center border-t border-border/30 pt-6 bg-muted/5">
          <p className="text-sm text-muted-foreground">
            {isVerifyingMfa ? (
              <span className="text-xs font-medium">Lost your device? <button className="text-primary hover:underline font-bold">Contact support</button></span>
            ) : (
              <>
                Don't have an account?{" "}
                <Link href="/auth/register" className="text-primary font-bold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm">
                  Sign up
                </Link>
              </>
            )}
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}