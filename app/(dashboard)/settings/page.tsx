"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { User, EnvelopeSimple, LockKey, CircleNotch, Camera, Eye, EyeSlash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useUserQuery } from "@/hooks/queries/useUserQuery";

export default function SettingsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: user, isLoading: isUserLoading } = useUserQuery();

  // Loaders
  const [isProfileLoading, setProfileLoading] = useState(false);
  const [isEmailLoading, setEmailLoading] = useState(false);
  const [isPasswordLoading, setPasswordLoading] = useState(false);
  const [isAvatarLoading, setAvatarLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.user_metadata?.name || user.user_metadata?.full_name || "");
      setEmail(user.email || "");
    }
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: { name: name }
      });
      if (error) throw error;
      toast.success("Profile updated successfully!");
      queryClient.invalidateQueries({ queryKey: ["user"] });
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({
        email: email
      });
      if (error) throw error;
      toast.success("Verification email sent! Please check both old and new inboxes to confirm the change.");
      queryClient.invalidateQueries({ queryKey: ["user"] });
    } catch (error: any) {
      toast.error(error.message || "Failed to update email");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword
      });
      if (error) throw error;
      toast.success("Password updated successfully!");
      setNewPassword(""); // clear new password field
      queryClient.invalidateQueries({ queryKey: ["user"] });
    } catch (error: any) {
      toast.error(error.message || "Failed to update password");
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File excessively large. Please choose an image under 5MB.");
      return;
    }

    setAvatarLoading(true);
    try {
      const presignRes = await fetch("/api/user/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: file.type }),
      });

      if (!presignRes.ok) {
        throw new Error("Failed to initialize upload");
      }
      
      const { presignedUrl, avatarUrl } = await presignRes.json();

      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("Failed to upload image to S3");

      const { data, error } = await supabase.auth.updateUser({
        data: { avatar_url: avatarUrl }
      });

      if (error) throw error;

      toast.success("Profile photo updated successfully!");
      queryClient.invalidateQueries({ queryKey: ["user"] });
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "An error occurred during upload.");
    } finally {
      setAvatarLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center">
        <CircleNotch className="h-8 w-8 animate-spin text-primary" weight="bold" />
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] overflow-hidden px-4 md:px-8 py-8 md:py-12 flex flex-col items-center">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[400px] md:w-[600px] h-[400px] md:h-[600px] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 translate-x-1/3 translate-y-1/3 w-[400px] md:w-[600px] h-[400px] md:h-[600px] bg-blue-500/20 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-3xl space-y-10">
        <div className="space-y-3 text-center md:text-left">
          <h1 className="text-3xl md:text-5xl font-heading font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/90 to-foreground/60">
            Account Settings
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto md:mx-0">
            Manage your personal profile details, email address, and security preferences securely.
          </p>
        </div>

        <div className="grid gap-8">
          {/* Profile Settings */}
          <Card className="group overflow-hidden border-border/40 bg-background/60 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                  <User size={22} weight="duotone" />
                </div>
                Profile Details
              </CardTitle>
              <CardDescription className="text-sm">
                Update your display name and how others see you on Nimbus.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleUpdateProfile}>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-6 items-start">
                  
                  {/* Avatar Upload */}
                  <div 
                    className="relative group/avatar cursor-pointer w-24 h-24 sm:w-28 sm:h-28 rounded-full flex-shrink-0 mx-auto sm:mx-0" 
                    title="Change profile picture"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Avatar className="w-full h-full border-2 border-border shadow-sm">
                      <AvatarImage src={user.user_metadata?.avatar_url} className="object-cover" />
                      <AvatarFallback className="text-xl sm:text-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-semibold">
                        {user.email?.substring(0,2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm shadow-inner">
                      {isAvatarLoading ? (
                        <CircleNotch size={28} className="text-white animate-spin" />
                      ) : (
                        <Camera size={28} className="text-white drop-shadow-md" weight="fill" />
                      )}
                    </div>
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      ref={fileInputRef} 
                      onChange={handleUploadAvatar} 
                      disabled={isAvatarLoading}
                    />
                  </div>
                  
                  <div className="space-y-4 w-full max-w-md group/input pt-2">
                    <Label htmlFor="name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-muted-foreground transition-colors group-focus-within/input:text-primary">
                        <User size={18} />
                      </div>
                      <Input
                        id="name"
                        type="text"
                        placeholder="John Doe"
                        className="pl-11 h-12 bg-background/50 border-border/60 focus-visible:ring-primary/40 transition-all rounded-xl shadow-sm"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="bg-muted/5 border-t border-border/30 pt-4 pb-4 flex justify-end">
                <Button 
                  type="submit" 
                  disabled={isProfileLoading || name === (user?.user_metadata?.name || user?.user_metadata?.full_name)}
                  className="w-full md:w-auto h-11 px-8 rounded-xl font-medium active:scale-95 transition-transform shadow-md hover:shadow-lg hover:bg-primary/90"
                >
                  {isProfileLoading ? (
                    <CircleNotch size={18} className="mr-2 animate-spin" />
                  ) : null}
                  Save Changes
                </Button>
              </CardFooter>
            </form>
          </Card>

          {/* Email Settings */}
          <Card className="group overflow-hidden border-border/40 bg-background/60 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#2da07a] to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl">
                <div className="p-2.5 rounded-xl bg-[#2da07a]/10 text-[#2da07a] group-hover:bg-[#2da07a]/20 group-hover:scale-110 transition-all duration-300">
                  <EnvelopeSimple size={22} weight="duotone" />
                </div>
                Email Address
              </CardTitle>
              <CardDescription className="text-sm">
                Update your email address associated with your account. You will receive confirmation links at both the old and new email addresses.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleUpdateEmail}>
              <CardContent>
                <div className="space-y-4 max-w-md group/input">
                  <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Log in Email</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-muted-foreground transition-colors group-focus-within/input:text-[#2da07a]">
                      <EnvelopeSimple size={18} />
                    </div>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      className="pl-11 h-12 bg-background/50 border-border/60 focus-visible:ring-[#2da07a]/40 transition-all rounded-xl shadow-sm"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="bg-muted/5 border-t border-border/30 pt-4 pb-4 flex justify-end">
                <Button 
                  type="submit" 
                  disabled={isEmailLoading || email === user?.email}
                  className="w-full md:w-auto h-11 px-8 rounded-xl font-medium active:scale-95 transition-transform shadow-md hover:shadow-lg bg-[#2da07a] text-white hover:bg-[#2da07a]/90"
                >
                  {isEmailLoading ? (
                    <CircleNotch size={18} className="mr-2 animate-spin" />
                  ) : null}
                  Update Email
                </Button>
              </CardFooter>
            </form>
          </Card>

          {/* Security / Password */}
          <Card className="group overflow-hidden border-border/40 bg-background/60 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 to-rose-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-xl">
                <div className="p-2.5 rounded-xl bg-orange-500/10 text-orange-500 group-hover:bg-orange-500/20 group-hover:scale-110 transition-all duration-300">
                  <LockKey size={22} weight="duotone" />
                </div>
                Security
              </CardTitle>
              <CardDescription className="text-sm">
                Ensure your account is using a long, random password to stay secure.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleUpdatePassword}>
              <CardContent>
                <div className="space-y-4 max-w-md group/input">
                  <Label htmlFor="newPassword" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">New Password</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-muted-foreground transition-colors group-focus-within/input:text-orange-500">
                      <LockKey size={18} />
                    </div>
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-11 pr-10 h-12 bg-background/50 border-border/60 focus-visible:ring-orange-500/40 transition-all rounded-xl shadow-sm"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={6}
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
              </CardContent>
              <CardFooter className="bg-muted/5 border-t border-border/30 pt-4 pb-4 flex justify-end">
                <Button 
                  type="submit" 
                  disabled={isPasswordLoading || !newPassword}
                  className="w-full md:w-auto h-11 px-8 rounded-xl font-medium active:scale-95 transition-transform shadow-md hover:shadow-lg bg-foreground text-background hover:bg-foreground/90"
                >
                  {isPasswordLoading ? (
                    <CircleNotch size={18} className="mr-2 animate-spin" />
                  ) : null}
                  Update Password
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
