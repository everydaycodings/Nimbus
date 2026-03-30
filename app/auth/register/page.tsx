"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnvelopeSimple, LockKey, CircleNotch, User, GithubLogo } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          }
        }
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      if (data?.user?.identities?.length === 0) {
        toast.error("An account with this email already exists");
        return;
      }

      toast.success("Successfully registered! Please check your email for a verification link.");
      router.push("/auth/login");
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || "An error occurred during registration");
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
      // No finally block to set isLoading(false) on success because the page will redirect to the provider
    } catch (error: any) {
      toast.error(error.message || `An error occurred during ${provider} signup`);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background/50 relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] opacity-50 pointer-events-none" />

      <Card className="w-full max-w-[400px] border-border/50 bg-background/80 backdrop-blur-xl shadow-2xl relative z-10">
        <CardHeader className="space-y-2 text-center pb-6">
          <CardTitle className="text-3xl font-heading font-bold tracking-tight">Create Account</CardTitle>
          <CardDescription className="text-muted-foreground">
            Sign up to get started with your cloud storage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button 
            variant="outline" 
            className="w-full h-11 bg-background hover:bg-accent hover:text-accent-foreground transition-all"
            onClick={() => handleOAuthLogin('github')}
            disabled={isLoading}
            type="button"
          >
            <GithubLogo weight="bold" className="mr-2 h-5 w-5" />
            Continue with GitHub
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/50" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
                  <User size={18} />
                </div>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="John Doe"
                  className="pl-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            </div>
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
                  className="pl-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all"
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
                  type="password"
                  placeholder="••••••••"
                  className="pl-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-11 mt-4 text-primary-foreground font-medium transition-all hover:scale-[1.02]" 
              disabled={isLoading}
            >
              {isLoading ? (
                <CircleNotch size={18} className="animate-spin" />
              ) : (
                "Create Account"
              )}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center border-t border-border/30 pt-6">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-primary font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}