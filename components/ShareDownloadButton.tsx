"use client";

import { useState } from "react";
import { DownloadSimple, Spinner } from "@phosphor-icons/react";

const TEAL = "#2da07a";

export function ShareDownloadButton({ token }: { token: string }) {
    const [loading, setLoading] = useState(false);

    const handleDownload = async () => {
        setLoading(true);

        try {
            const res = await fetch(`/api/download-share?token=${token}`);

            if (!res.ok) throw new Error("Download failed");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;

            // 🔥 get filename from header
            const disposition = res.headers.get("Content-Disposition");
            const match = disposition?.match(/filename="(.+)"/);
            a.download = match?.[1] || "download.zip";

            document.body.appendChild(a);
            a.click();
            a.remove();

            window.URL.revokeObjectURL(url);
        } catch (e) {
            alert("Download failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleDownload}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: TEAL }}
        >
            {loading ? (
                <>
                    <Spinner size={15} className="animate-spin" />
                    Preparing...
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