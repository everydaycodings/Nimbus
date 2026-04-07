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
  CircleNotch,
  WarningCircle,
} from "@phosphor-icons/react";
import { useDownload } from "@/hooks/useDownload";
import { cn } from "@/lib/utils";

interface Props {
  fileId: string;
  fileName: string;
  mimeType: string;
  signedUrl?: string | null;
  downloadUrl?: string | null;
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
  if (!isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mmss = `${m}:${sec.toString().padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss.padStart(5, "0")}` : mmss;
}

// ═══════════════════════════════════════════════════════════════
// VIDEO PLAYER
// ═══════════════════════════════════════════════════════════════
export function VideoPlayer({ src, fileName }: { src: string; fileName: string }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
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
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => setError(true));
    } else {
      v.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setMuted(val === 0);
    }
  };

  const updateSeek = useCallback((clientX: number) => {
    if (!progressRef.current || !videoRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = pct * duration;
    setCurrent(newTime);
    videoRef.current.currentTime = newTime;
  }, [duration]);

  const onProgressMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    updateSeek(e.clientX);
  };

  const onProgressTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    updateSeek(e.touches[0].clientX);
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => updateSeek(e.clientX);
    const handleTouchMove = (e: TouchEvent) => { e.preventDefault(); updateSeek(e.touches[0].clientX); };
    const handleEnd = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleEnd);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging, updateSeek]);

  const skip = (secs: number) => {
    if (videoRef.current) videoRef.current.currentTime += secs;
  };

  const cycleSpeed = () => {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "arrowleft":
          e.preventDefault();
          skip(-5);
          break;
        case "arrowright":
          e.preventDefault();
          skip(5);
          break;
        case "arrowup":
          e.preventDefault();
          setVolume((v) => {
            const nv = Math.min(1, v + 0.1);
            if (videoRef.current) videoRef.current.volume = nv;
            return nv;
          });
          break;
        case "arrowdown":
          e.preventDefault();
          setVolume((v) => {
            const nv = Math.max(0, v - 0.1);
            if (videoRef.current) videoRef.current.volume = nv;
            return nv;
          });
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [togglePlay, toggleFullscreen, toggleMute]);

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowCtrls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (playing && !isDragging) setShowCtrls(false);
    }, 3000);
  }, [playing, isDragging]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [playing, resetHideTimer]);

  const pct = duration ? (current / duration) * 100 : 0;
  const buffPct = duration ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-5xl bg-black sm:rounded-2xl overflow-hidden group shadow-2xl flex flex-col items-center justify-center select-none"
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
      onMouseLeave={() => playing && !isDragging && setShowCtrls(false)}
      onDoubleClick={toggleFullscreen}
      style={{ aspectRatio: isMobile ? "auto" : "16/9", maxHeight: isMobile ? "70vh" : undefined }}
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (!isDragging) setCurrent(v.currentTime);
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => { setPlaying(true); setWaiting(false); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onError={() => setError(true)}
        onCanPlay={() => setWaiting(false)}
      />

      {/* Loading Overlay */}
      {waiting && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[2px] pointer-events-none">
          <CircleNotch size={48} className="text-white animate-spin opacity-80" />
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md text-white p-6 text-center">
          <WarningCircle size={48} weight="duotone" className="text-red-500 mb-4" />
          <p className="text-lg font-semibold">Unable to play video</p>
          <p className="text-sm text-white/60 mt-2 max-w-xs">There was an issue loading the video. Please check your connection or the file format.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors border border-white/10"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Big Play Overlay */}
      {!playing && !error && !waiting && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer hover:bg-black/10 transition-colors"
          onClick={togglePlay}
        >
          <div className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/20 transition-all hover:scale-110 hover:bg-black/60 shadow-2xl">
            <Play size={36} weight="fill" className="text-white ml-1" />
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 transition-all duration-300 px-3 pb-3 pt-10 sm:px-6 sm:pb-6 sm:pt-12",
          showCtrls || !playing || isDragging ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 40%, transparent 100%)",
        }}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-1.5 sm:h-1.5 rounded-full bg-white/20 cursor-pointer mb-3 sm:mb-4 group/bar overflow-visible touch-none"
          onMouseDown={onProgressMouseDown}
          onTouchStart={onProgressTouchStart}
        >
          {/* Buffered */}
          <div
            className="absolute h-full rounded-full bg-white/20 transition-all duration-500"
            style={{ width: `${buffPct}%` }}
          />
          {/* Played */}
          <div
            className="absolute h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: TEAL }}
          />
          {/* Virtual "hit area" for easier scrubbing — larger on mobile */}
          <div className="absolute -inset-y-4 sm:-inset-y-3 left-0 right-0" />
          
          {/* Thumb — always visible on mobile for discoverability */}
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-xl border-2 transition-transform",
              isDragging ? "scale-125 select-none" : isMobile ? "scale-100" : "scale-100 group-hover/bar:scale-125 opacity-0 group-hover/bar:opacity-100"
            )}
            style={{ left: `${pct}%`, transform: "translate(-50%, -50%)", borderColor: TEAL }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => skip(-10)} className="p-1.5 sm:p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all" title="Back 10s">
              <SkipBack size={isMobile ? 16 : 20} weight="fill" />
            </button>

            <button onClick={togglePlay} className="p-1.5 sm:p-2 text-white hover:scale-110 transition-transform bg-white/10 hover:bg-white/20 rounded-full" title={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={isMobile ? 20 : 24} weight="fill" /> : <Play size={isMobile ? 20 : 24} weight="fill" />}
            </button>

            <button onClick={() => skip(10)} className="p-1.5 sm:p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all" title="Forward 10s">
              <SkipForward size={isMobile ? 16 : 20} weight="fill" />
            </button>
          </div>

          <span className="text-white text-xs sm:text-sm font-medium tabular-nums">
            {fmtTime(current)} <span className="text-white/40 mx-0.5">/</span> {fmtTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Volume — mute only on mobile, slider on desktop */}
          <button onClick={toggleMute} className="p-1.5 sm:p-2 text-white/70 hover:text-white transition-colors sm:hidden" title="Mute">
            {muted || volume === 0 ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
          </button>
          <div className="hidden sm:flex items-center gap-1 bg-white/5 rounded-2xl px-2 py-1">
            <button onClick={toggleMute} className="p-2 text-white/70 hover:text-white transition-colors">
              {muted || volume === 0 ? <SpeakerSlash size={20} /> : <SpeakerHigh size={20} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={muted ? 0 : volume}
              onChange={handleVolume}
              className="w-20 accent-[#2da07a] h-1.5 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
            />
          </div>

          <button
            onClick={cycleSpeed}
            className="px-2 py-0.5 sm:px-3 sm:py-1 text-white/70 hover:text-white hover:bg-white/10 rounded-xl text-[10px] sm:text-xs font-bold transition-all border border-white/10"
            title="Playback Speed"
          >
            {playbackRate}x
          </button>

          <button onClick={toggleFullscreen} className="p-1.5 sm:p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all" title="Fullscreen (f)">
            {fullscreen ? <ArrowsIn size={isMobile ? 18 : 22} /> : <ArrowsOut size={isMobile ? 18 : 22} />}
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
  const [waiting, setWaiting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    playing ? a.pause() : a.play().catch(() => {});
    setPlaying(!playing);
  };

  const updateSeek = useCallback((clientX: number) => {
    if (!progressRef.current || !audioRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = pct * duration;
    setCurrent(newTime);
    audioRef.current.currentTime = newTime;
  }, [duration]);

  const onProgressMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    updateSeek(e.clientX);
  };

  const onProgressTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    updateSeek(e.touches[0].clientX);
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => updateSeek(e.clientX);
    const handleTouchMove = (e: TouchEvent) => { e.preventDefault(); updateSeek(e.touches[0].clientX); };
    const handleEnd = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleEnd);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging, updateSeek]);

  const pct = duration ? (current / duration) * 100 : 0;
  const title = fileName.replace(/\.[^/.]+$/, "");

  return (
    <div className="w-full max-w-sm select-none">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={(e) => { if (!isDragging) setCurrent(e.currentTarget.currentTime); }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => { setPlaying(true); setWaiting(false); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
      />

      {/* Album art placeholder */}
      <div
        className="w-full aspect-square rounded-2xl flex items-center justify-center mb-6 relative overflow-hidden shadow-2xl"
        style={{ background: "linear-gradient(135deg, #1a2a1a 0%, #0d1a0d 100%)" }}
      >
        {/* Animated rings when playing */}
        {playing && (
          <>
            <div className="absolute inset-0 rounded-2xl border-2 animate-ping opacity-10" style={{ borderColor: TEAL }} />
            <div className="absolute inset-4 rounded-2xl border animate-ping opacity-10 animation-delay-150" style={{ borderColor: TEAL }} />
          </>
        )}
        
        {waiting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-10">
            <CircleNotch size={40} className="text-white animate-spin opacity-80" />
          </div>
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
        <p className="text-sm font-semibold text-foreground truncate px-4">{title}</p>
        <p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-widest bg-muted/50 w-fit mx-auto px-2 py-0.5 rounded-md">
          {fileName.split(".").pop()}
        </p>
      </div>

      {/* Progress */}
      <div
        ref={progressRef}
        className="relative h-1.5 rounded-full bg-muted cursor-pointer mb-2 group overflow-visible touch-none"
        onMouseDown={onProgressMouseDown}
        onTouchStart={onProgressTouchStart}
      >
        <div
          className="absolute h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: TEAL }}
        />
        <div className="absolute -inset-y-4 sm:-inset-y-3 left-0 right-0" />
        <div
          className={cn(
            "absolute top-1/2 w-4 h-4 rounded-full bg-white shadow-xl border-2 transition-transform",
            isDragging ? "scale-125" : "scale-100 group-hover:scale-125 opacity-0 group-hover:opacity-100"
          )}
          style={{ left: `${pct}%`, transform: "translate(-50%, -50%)", borderColor: TEAL }}
        />
      </div>

      <div className="flex justify-between text-[11px] font-medium text-muted-foreground mb-6 tabular-nums">
        <span>{fmtTime(current)}</span>
        <span>{fmtTime(duration)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6">
        <button onClick={() => { if (audioRef.current) audioRef.current.currentTime -= 10; }} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-all">
          <SkipBack size={20} weight="fill" />
        </button>

        <button
          onClick={togglePlay}
          className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-xl transition-all hover:scale-105 active:scale-95 shadow-teal-500/20"
          style={{ backgroundColor: TEAL }}
        >
          {playing ? <Pause size={28} weight="fill" /> : <Play size={28} weight="fill" className="ml-1" />}
        </button>

        <button onClick={() => { if (audioRef.current) audioRef.current.currentTime += 10; }} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full transition-all">
          <SkipForward size={20} weight="fill" />
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-3 mt-8 bg-muted/30 px-4 py-2 rounded-2xl">
        <button onClick={() => { setMuted(!muted); if (audioRef.current) audioRef.current.muted = !muted; }} className="text-muted-foreground hover:text-foreground transition-colors">
          {muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setVolume(val);
            if (audioRef.current) {
              audioRef.current.volume = val;
              audioRef.current.muted = val === 0;
              setMuted(val === 0);
            }
          }}
          className="flex-1 accent-[#2da07a] h-1.5 cursor-pointer"
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
          loading="lazy"
          decoding="async"
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
export function FilePreviewDialog({ fileId, fileName, mimeType, signedUrl, downloadUrl, onClose }: Props) {
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
    getPreviewUrl(fileId, signedUrl).then((url) => {
      setPreviewUrl(url);
      setLoading(false);
    });
  }, [fileId, previewing, signedUrl]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-3 py-2 sm:px-5 sm:py-3 bg-background/80 backdrop-blur-sm border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* File type chip */}
          <span className="flex-shrink-0 px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider text-white" style={{ backgroundColor: TEAL }}>
            {fileName.split(".").pop()}
          </span>
          <p className="text-xs sm:text-sm font-medium text-foreground truncate">{fileName}</p>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-2 sm:ml-4">
          <button
            onClick={() => download(fileId, fileName, "file", downloadUrl)}
            disabled={isDownloading}
            className={cn(
              "flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 rounded-xl text-sm font-medium text-white transition-all",
              isDownloading ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
            )}
            style={{ backgroundColor: TEAL }}
          >
            <DownloadSimple size={15} weight="bold" />
            <span className="hidden sm:inline">{isDownloading ? "Downloading..." : "Download"}</span>
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
      <div className="flex-1 flex items-center justify-center p-2 sm:p-6 overflow-hidden min-h-0">
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
              onClick={() => download(fileId, fileName, "file", downloadUrl)}
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