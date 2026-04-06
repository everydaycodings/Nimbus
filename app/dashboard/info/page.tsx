"use client";

import React from "react";

export default function InfoPage() {
  const appDetails = [
    { label: "Version", value: process.env.NEXT_PUBLIC_APP_VERSION || "1.2", isBadge: true },
    { label: "Stage", value: "Public", isBadge: false },
    { label: "Last Updated", value: "April 04, 2026", isBadge: false },
    { 
      label: "Developed by", 
      value: "everydaycodings", 
      isBadge: false, 
      isLink: true, 
      href: "https://github.com/everydaycodings" // Placeholder link
    },
    { 
      label: "License", 
      value: "Apache 2.0", 
      isBadge: false, 
      isLink: true, 
      href: "https://github.com/everydaycodings/Nimbus/blob/main/LICENSE" 
    },
  ];

  return (
    <div className="min-h-screen bg-[#000000] text-[#ffffff] font-sans selection:bg-primary/30 py-16 px-4 sm:px-6 lg:px-8 animate-fade-in scrollbar-hide">
      <div className="max-w-3xl mx-auto space-y-12">
        
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
              Nimbus Dashboard
            </h1>
          </div>
          <p className="text-[#ffffff80] text-lg font-medium">
            Intelligent Cloud Storage
          </p>
        </div>

        {/* Application Details Card */}
        <div className="bg-[#0a0a0a] rounded-3xl border border-[#ffffff08] p-8 md:p-10 shadow-2xl transition-all duration-300 hover:border-[#ffffff12]">
          <div className="mb-10">
            <h2 className="text-xl font-bold text-[#ffffff]">Application Details</h2>
            <p className="text-[#ffffff50] text-sm mt-1">Build and release information</p>
          </div>

          <div className="space-y-6">
            {appDetails.map((detail) => (
              <div key={detail.label} className="flex items-center justify-between group">
                <span className="text-[#ffffff60] text-[15px] font-medium">{detail.label}</span>
                {detail.isBadge ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#ffffff10] text-[#ffffff80] text-xs font-bold border border-[#ffffff10]">
                    {detail.value}
                  </span>
                ) : detail.isLink ? (
                  <a 
                    href={detail.href} 
                    target={detail.href.startsWith("http") ? "_blank" : undefined}
                    className="text-[#ffffff] text-[15px] underline underline-offset-4 decoration-[#ffffff30] hover:decoration-[#ffffff] transition-all"
                  >
                    {detail.value}
                  </a>
                ) : (
                  <span className="text-[#ffffff] text-[15px] font-medium">{detail.value}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* About Card */}
        <div className="bg-[#0a0a0a] rounded-3xl border border-[#ffffff08] p-8 md:p-10 shadow-2xl transition-all duration-300 hover:border-[#ffffff12]">
          <div className="mb-8">
            <h2 className="text-xl font-bold text-[#ffffff]">About Nimbus</h2>
            <p className="text-[#ffffff50] text-sm mt-1">Vision & Purpose</p>
          </div>

          <div className="space-y-6 text-[#ffffff85] leading-relaxed text-[15px]">
            <p>
              Nimbus Dashboard is an evolving cloud storage platform built to empower users with a 
              seamless, high-performance file management experience.
            </p>
            <p>
              The current alpha version is focused on performance optimization, data reliability, 
              and expanding security features before full release.
            </p>
            <p className="italic text-[#ffffff40] pt-2 text-sm">
              Your feedback helps shape the future of Nimbus — thank you for being an early user!
            </p>
          </div>
        </div>

        {/* Footer info/Legal */}
        <div className="text-center pt-8">
          <p className="text-[#ffffff20] text-xs uppercase tracking-[0.2em] font-medium">
            © 2026 Nimbus Project • Released under the Apache License 2.0
          </p>
        </div>
      </div>
    </div>
  );
}
