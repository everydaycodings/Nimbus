"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnvelopeSimple, LockKey, CircleNotch, User, GithubLogo, GoogleLogo, Eye, EyeSlash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name,
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
    <div className="min-h-screen flex items-center justify-center bg-background/50 relative overflow-hidden p-4">
      {/* Dynamic Background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] opacity-50 pointer-events-none" />

      <Card className="w-full max-w-[400px] border-border/50 bg-background/80 backdrop-blur-xl shadow-xl sm:shadow-2xl relative z-10">
        <CardHeader className="space-y-2 text-center pb-6">
          <CardTitle className="text-3xl font-heading font-bold tracking-tight">Create Account</CardTitle>
          <CardDescription className="text-muted-foreground">
            Sign up to get started with your cloud storage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Button 
              variant="outline" 
              className="w-full h-11 bg-background hover:bg-accent hover:text-accent-foreground transition-all cursor-pointer"
              onClick={() => handleOAuthLogin('github')}
              disabled={isLoading}
              type="button"
            >
              <GithubLogo weight="bold" className="mr-2 h-5 w-5" />
              GitHub
            </Button>
            <Button 
              variant="outline" 
              className="w-full h-11 bg-background hover:bg-accent hover:text-accent-foreground transition-allcursor-pointer"
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
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
                  <User size={18} />
                </div>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  className="pl-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
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
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
                  <LockKey size={18} />
                </div>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="pl-10 pr-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all"
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
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
                  <LockKey size={18} />
                </div>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="pl-10 pr-10 h-11 bg-accent/30 border-border/50 focus-visible:ring-primary/50 transition-all"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-11 mt-4 text-primary-foreground font-medium transition-all hover:scale-[1.02] cursor-pointer" 
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
        <CardFooter className="flex flex-col space-y-3 justify-center border-t border-border/30 pt-6 bg-muted/5">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-primary font-bold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm">
              Sign in
            </Link>
          </p>
          <Link 
            href="/auth/forgot-password" 
            className="text-xs text-muted-foreground hover:text-primary transition-colors font-medium"
          >
            Forgot password?
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}