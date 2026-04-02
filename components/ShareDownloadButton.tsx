"use client";

import { useState } from "react";
import { DownloadSimple, Spinner } from "@phosphor-icons/react";

const TEAL = "#2da07a";

export function ShareDownloadButton({ token }: { token: string }) {
    const [loading, setLoading] = useState(false);

    const handleDownload = () => {
        // 🔥 Maximum Optimization: Direct navigation to the streaming API
        // This stops the browser from buffering the entire file into memory (blob)
        // and uses the native download manager's progress tracking.
        setLoading(true);
        window.location.href = `/api/download-share?token=${token}`;
        
        // Reset loading state after a short delay since native downloads 
        // don't provide a "started" event easily.
        setTimeout(() => setLoading(false), 2000);
    };

    return (
        <button
            onClick={handleDownload}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 transition-all shadow-sm active:scale-95"
            style={{ backgroundColor: TEAL }}
        >
            {loading ? (
                <>
                    <Spinner size={15} className="animate-spin" />
                    Starting...
                </>
            ) : (
                <>
                    <DownloadSimple size={15} weight="bold" />
                    Download
                </>
            )}
        </button>
    );
}