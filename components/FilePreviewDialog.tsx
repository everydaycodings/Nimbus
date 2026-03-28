// components/FilePreviewDialog.tsx
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  X,
  DownloadSimple,
  File,
  FilePdf,
  MusicNote,
  Image as ImageIcon,
  Play,
  Pause,
  SpeakerHigh,
  SpeakerSlash,
  ArrowsOut,
  ArrowsIn,
  SkipBack,
  SkipForward,
  Repeat,
  Shuffle,
  CaretLeft,
  CaretRight,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  ArrowCounterClockwise,
  VideoIcon,
} from "@phosphor-icons/react";
import { useDownload } from "@/hooks/useDownload";
import { cn } from "@/lib/utils";

interface Props {
  fileId: string;
  fileName: string;
  mimeType: string;
  onClose: () => void;
}

const TEAL = "#2da07a";

function canPreview(mimeType: string) {
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/")
  );
}

// ── Format seconds → mm:ss ────────────────────────────────────
function fmtTime(s: number) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
// VIDEO PLAYER
// ═══════════════════════════════════════════════════════════════
export function VideoPlayer({ src, fileName }: { src: string; fileName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);


  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showCtrls, setShowCtrls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    playing ? v.pause() : v.play();
    setPlaying(!playing);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !muted;
    setMuted(!muted);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) videoRef.current.volume = val;
    setMuted(val === 0);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressRef.current!.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (videoRef.current) videoRef.current.currentTime = pct * duration;
  };

  const skip = (secs: number) => {
    if (videoRef.current) videoRef.current.currentTime += secs;
  };

  const cycleSpeed = () => {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowCtrls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (playing) setShowCtrls(false);
    }, 3000);
  }, [playing]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [playing]);

  const pct = duration ? (current / duration) * 100 : 0;
  const buffPct = duration ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-5xl bg-black rounded-2xl overflow-hidden group shadow-2xl"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => playing && setShowCtrls(false)}
      style={{ aspectRatio: "16/9" }}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        onClick={togglePlay}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setCurrent(v.currentTime);
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      {/* Big play/pause overlay on click */}
      {!playing && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={togglePlay}
        >
          <div className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center border border-white/20 transition-transform hover:scale-110">
            <Play size={36} weight="fill" className="text-white ml-1" />
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 transition-opacity duration-300",
          showCtrls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
          padding: "32px 16px 16px",
        }}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-1 rounded-full bg-white/20 cursor-pointer mb-3 group/bar"
          onClick={handleSeek}
        >
          {/* Buffered */}
          <div
            className="absolute h-full rounded-full bg-white/30"
            style={{ width: `${buffPct}%` }}
          />
          {/* Played */}
          <div
            className="absolute h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: TEAL }}
          />
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover/bar:opacity-100 transition-opacity"
            style={{ left: `${pct}%`, transform: "translate(-50%, -50%)" }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
          {/* Skip back */}
          <button onClick={() => skip(-10)} className="text-white/70 hover:text-white transition-colors">
            <SkipBack size={18} weight="fill" />
          </button>

          {/* Play/Pause */}
          <button onClick={togglePlay} className="text-white hover:scale-110 transition-transform">
            {playing
              ? <Pause size={22} weight="fill" />
              : <Play size={22} weight="fill" />
            }
          </button>

          {/* Skip forward */}
          <button onClick={() => skip(10)} className="text-white/70 hover:text-white transition-colors">
            <SkipForward size={18} weight="fill" />
          </button>

          {/* Time */}
          <span className="text-white/70 text-xs tabular-nums">
            {fmtTime(current)} / {fmtTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Speed */}
          <button
            onClick={cycleSpeed}
            className="text-white/70 hover:text-white text-xs font-mono w-8 text-center transition-colors"
          >
            {playbackRate}x
          </button>

          {/* Volume */}
          <div className="flex items-center gap-1.5 group/vol">
            <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors">
              {muted || volume === 0
                ? <SpeakerSlash size={18} />
                : <SpeakerHigh size={18} />
              }
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={handleVolume}
              className="w-0 group-hover/vol:w-16 overflow-hidden transition-all duration-200 accent-[#2da07a] h-1 cursor-pointer"
            />
          </div>

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors">
            {fullscreen ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUDIO PLAYER
// ═══════════════════════════════════════════════════════════════
export function AudioPlayer({ src, fileName }: { src: string; fileName: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    playing ? a.pause() : a.play();
    setPlaying(!playing);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressRef.current!.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audioRef.current) audioRef.current.currentTime = pct * duration;
  };

  const pct = duration ? (current / duration) * 100 : 0;

  // Extract a nice name without extension
  const title = fileName.replace(/\.[^/.]+$/, "");

  return (
    <div className="w-full max-w-sm">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      {/* Album art placeholder */}
      <div
        className="w-full aspect-square rounded-2xl flex items-center justify-center mb-6 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #1a2a1a 0%, #0d1a0d 100%)" }}
      >
        {/* Animated rings when playing */}
        {playing && (
          <>
            <div className="absolute inset-0 rounded-2xl border-2 animate-ping opacity-10" style={{ borderColor: TEAL }} />
            <div className="absolute inset-4 rounded-2xl border animate-ping opacity-10 animation-delay-150" style={{ borderColor: TEAL }} />
          </>
        )}
        <div
          className={cn(
            "w-24 h-24 rounded-full flex items-center justify-center transition-transform duration-[3000ms]",
            playing ? "rotate-[360deg]" : ""
          )}
          style={{
            background: `radial-gradient(circle, ${TEAL}33 0%, transparent 70%)`,
            border: `2px solid ${TEAL}44`,
            animation: playing ? "spin 8s linear infinite" : "none",
          }}
        >
          <MusicNote size={40} weight="duotone" style={{ color: TEAL }} />
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-6">
        <p className="text-sm font-semibold text-foreground truncate">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{fileName.split(".").pop()?.toUpperCase()}</p>
      </div>

      {/* Progress */}
      <div
        ref={progressRef}
        className="relative h-1 rounded-full bg-muted cursor-pointer mb-2 group"
        onClick={handleSeek}
      >
        <div
          className="absolute h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: TEAL }}
        />
        <div
          className="absolute top-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${pct}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground mb-6">
        <span>{fmtTime(current)}</span>
        <span>{fmtTime(duration)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6">
        <button onClick={() => { if (audioRef.current) audioRef.current.currentTime -= 10; }} className="text-muted-foreground hover:text-foreground transition-colors">
          <SkipBack size={20} weight="fill" />
        </button>

        <button
          onClick={togglePlay}
          className="w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          style={{ backgroundColor: TEAL }}
        >
          {playing
            ? <Pause size={24} weight="fill" />
            : <Play size={24} weight="fill" className="ml-1" />
          }
        </button>

        <button onClick={() => { if (audioRef.current) audioRef.current.currentTime += 10; }} className="text-muted-foreground hover:text-foreground transition-colors">
          <SkipForward size={20} weight="fill" />
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 mt-6">
        <button onClick={() => { setMuted(!muted); if (audioRef.current) audioRef.current.muted = !muted; }} className="text-muted-foreground hover:text-foreground transition-colors">
          {muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : volume}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setVolume(val);
            if (audioRef.current) audioRef.current.volume = val;
          }}
          className="flex-1 accent-[#2da07a] h-1 cursor-pointer"
        />
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMAGE VIEWER
// ═══════════════════════════════════════════════════════════════
export function ImageViewer({ src, fileName }: { src: string; fileName: string }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 5));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25));
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({
      x: panStart.current.x + (e.clientX - dragStart.current.x),
      y: panStart.current.y + (e.clientY - dragStart.current.y),
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.25, Math.min(5, z - e.deltaY * 0.001)));
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full h-full">
      {/* Image container */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden w-full rounded-xl"
        style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
        onWheel={onWheel}
      >
        <img
          src={src}
          alt={fileName}
          draggable={false}
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl select-none transition-transform duration-100"
          style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` }}
        />
      </div>

      {/* Zoom controls */}
      <div className="flex items-center gap-2 bg-card/80 backdrop-blur-sm border border-border rounded-full px-4 py-2">
        <button onClick={zoomOut} disabled={zoom <= 0.25} className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
          <MagnifyingGlassMinus size={16} />
        </button>
        <span className="text-xs tabular-nums text-foreground min-w-[40px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={zoomIn} disabled={zoom >= 5} className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
          <MagnifyingGlassPlus size={16} />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button onClick={reset} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowCounterClockwise size={16} />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN DIALOG
// ═══════════════════════════════════════════════════════════════
export function FilePreviewDialog({ fileId, fileName, mimeType, onClose }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { download, downloading, getPreviewUrl } = useDownload();
  const isDownloading = downloading.has(fileId);
  const previewing = canPreview(mimeType);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!previewing) { setLoading(false); return; }
    getPreviewUrl(fileId).then((url) => {
      setPreviewUrl(url);
      setLoading(false);
    });
  }, [fileId, previewing]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 py-3 bg-background/80 backdrop-blur-sm border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* File type chip */}
          <span className="flex-shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider text-white" style={{ backgroundColor: TEAL }}>
            {fileName.split(".").pop()}
          </span>
          <p className="text-sm font-medium text-foreground truncate">{fileName}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          <button
            onClick={() => download(fileId, fileName)}
            disabled={isDownloading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-all",
              isDownloading ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
            )}
            style={{ backgroundColor: TEAL }}
          >
            <DownloadSimple size={15} weight="bold" />
            {isDownloading ? "Downloading..." : "Download"}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Preview area ── */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden min-h-0">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-muted animate-pulse" />
            <p className="text-xs text-muted-foreground">Loading preview...</p>
          </div>
        ) : !previewing || !previewUrl ? (
          /* No preview */
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="w-24 h-24 rounded-2xl flex items-center justify-center border border-border bg-card">
              <File size={48} weight="duotone" className="text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">{fileName}</p>
              <p className="text-xs text-muted-foreground mt-1">No preview available for this file type</p>
            </div>
            <button
              onClick={() => download(fileId, fileName)}
              disabled={isDownloading}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all",
                isDownloading ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
              )}
              style={{ backgroundColor: TEAL }}
            >
              <DownloadSimple size={16} weight="bold" />
              Download file
            </button>
          </div>
        ) : (
          <>
            {mimeType.startsWith("image/") && (
              <ImageViewer src={previewUrl} fileName={fileName} />
            )}
            {mimeType === "application/pdf" && (
              <iframe
                src={previewUrl}
                className="w-full h-full rounded-xl border border-border bg-white"
                title={fileName}
              />
            )}
            {mimeType.startsWith("video/") && (
              <VideoPlayer src={previewUrl} fileName={fileName} />
            )}
            {mimeType.startsWith("audio/") && (
              <AudioPlayer src={previewUrl} fileName={fileName} />
            )}
          </>
        )}
      </div>
    </div>
  );
}