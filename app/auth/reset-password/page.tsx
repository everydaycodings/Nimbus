"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockKey, CircleNotch, Eye, EyeSlash, CheckCircle, ArrowLeft } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Invalid or expired reset link.");
        router.push("/auth/login");
      }
    };
    checkSession();
  }, [supabase, router]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      setIsSuccess(true);
      toast.success("Password updated successfully!");
      
      // Auto redirect to login after a short delay
      setTimeout(() => {
        router.push("/auth/login");
      }, 3000);
    } catch (error: any) {
      toast.error(error.message || "An error occurred. Please try again.");
    } finally {
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
          <div className="flex justify-center mb-2">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary ring-4 ring-primary/5">
              <LockKey size={32} weight="duotone" />
            </div>
          </div>
          <CardTitle className="text-3xl font-heading font-bold tracking-tight">
            Reset Password
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            {isSuccess 
              ? "Your password has been reset successfully." 
              : "Enter your new password below to regain access to your account."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {!isSuccess ? (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
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

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
                    <LockKey size={18} />
                  </div>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="pl-10 pr-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all rounded-xl"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              
              <Button 
                type="submit" 
                className="w-full h-12 mt-4 font-bold transition-all active:scale-[0.98] cursor-pointer rounded-xl shadow-lg shadow-primary/20" 
                disabled={isLoading}
              >
                {isLoading ? (
                  <CircleNotch size={20} className="animate-spin" weight="bold" />
                ) : (
                  "Update Password"
                )}
              </Button>
            </form>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 text-center">
              <div className="flex justify-center py-2">
                <div className="p-4 rounded-full bg-primary/10 text-primary ring-4 ring-primary/5 shadow-inner">
                  <CheckCircle size={48} weight="duotone" />
                </div>
              </div>
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
                <p className="text-sm font-medium">Successfully reset!</p>
                <p className="text-xs text-muted-foreground mt-1">Redirecting you to login in a few seconds...</p>
              </div>
              <Button 
                onClick={() => router.push("/auth/login")}
                className="w-full h-11 rounded-xl transition-all shadow-lg"
              >
                Go to login now
              </Button>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-center border-t border-border/30 pt-6 bg-muted/5">
          <Link 
            href="/auth/login" 
            className="flex items-center text-sm text-muted-foreground hover:text-primary transition-colors font-medium group"
          >
            <ArrowLeft size={14} className="mr-2 group-hover:-translate-x-1 transition-transform" />
            Back to login
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
