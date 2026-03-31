"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnvelopeSimple, CircleNotch, ArrowLeft, Key } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const supabase = createClient();

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      setIsSent(true);
      toast.success("Reset link sent!");
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
              <Key size={32} weight="duotone" />
            </div>
          </div>
          <CardTitle className="text-3xl font-heading font-bold tracking-tight">
            Forgot Password
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            {isSent 
              ? "Check your email for a link to reset your password." 
              : "Enter your email to receive a password reset link."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {!isSent ? (
            <form onSubmit={handleResetRequest} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Email Address</Label>
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
              
              <Button 
                type="submit" 
                className="w-full h-12 mt-4 font-bold transition-all active:scale-[0.98] cursor-pointer rounded-xl shadow-lg shadow-primary/20" 
                disabled={isLoading}
              >
                {isLoading ? (
                  <CircleNotch size={20} className="animate-spin" weight="bold" />
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </form>
          ) : (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 text-center">
                <p className="text-sm text-foreground">
                  We've sent an email to <span className="font-bold text-primary">{email}</span>. Click the link in the email to reset your password.
                </p>
              </div>
              <Button 
                onClick={() => setIsSent(false)}
                variant="outline"
                className="w-full h-11 rounded-xl transition-all hover:bg-accent/50"
              >
                Didn't get the email? Try again
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
