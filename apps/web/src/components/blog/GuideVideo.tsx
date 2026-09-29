"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Spinner } from "@/app/app/Marks";
import type { DevicePlatform, PlatformVideo, PostVideo, VideoChapter } from "@/lib/blog";
import { SITE_NAME, mediaUrl } from "@/lib/site";
import { usePlatformChoice } from "./PlatformGuide";

const PLATFORMS: { id: DevicePlatform; label: string }[] = [
  { id: "ios", label: "iPhone" },
  { id: "android", label: "Android" },
];
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
const SEEK_STEP_SEC = 5;
const PREVIEW_LOOP_SEC = 7;
// Wider than this in device pixels, the 720p file starts to look soft.
const HD_ABOVE_DEVICE_PX = 760;

export function GuideVideo({ video }: { video: PostVideo }) {
  const choice = usePlatformChoice();
  const [picked, setPicked] = useState<DevicePlatform>("ios");
  const platform: DevicePlatform = choice && choice.platform !== "all" ? choice.platform : picked;
  const startAt = useRef<number | null>(null);
  const deepLinkRead = useRef(false);

  const choose = useCallback(
    (p: DevicePlatform) => {
      setPicked(p);
      choice?.choose(p);
    },
    [choice],
  );

  useEffect(() => {
    if (deepLinkRead.current) return;
    deepLinkRead.current = true;
    const params = new URLSearchParams(window.location.search);
    const v = params.get("v");
    if (v === "ios" || v === "android") choose(v);
    const t = Number(params.get("t"));
    if (Number.isFinite(t) && t > 0) startAt.current = t;
  }, [choose]);

  return (
    <section aria-label="מדריך וידאו" className="mt-8 flex flex-col items-center gap-4">
      <PlatformSwitch value={platform} onChange={choose} />
      <VideoPlayer key={platform} clip={video.byPlatform[platform]} title={video.title} startAt={startAt} />
    </section>
  );
}

function PlatformSwitch({ value, onChange }: { value: DevicePlatform; onChange: (p: DevicePlatform) => void }) {
  return (
    <div role="radiogroup" aria-label="סוג הטלפון בסרטון" className="inline-grid grid-cols-2 gap-1 rounded-full bg-sand-light/70 p-1">
      {PLATFORMS.map((p) => {
        const on = p.id === value;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(p.id)}
            className={`rounded-full px-5 py-2 text-sm font-bold transition ${
              on ? "bg-white text-espresso shadow-sm" : "text-espresso-light hover:text-espresso"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

interface PlaybackState {
  playing: boolean;
  ended: boolean;
  buffering: boolean;
  muted: boolean;
  volume: number;
  rate: number;
  time: number;
}

const IDLE: PlaybackState = { playing: false, ended: false, buffering: false, muted: true, volume: 1, rate: 1, time: 0 };

function usePlayback(ref: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<PlaybackState>(IDLE);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let frame = 0;
    const tick = () => {
      setState((s) => ({ ...s, time: v.currentTime }));
      frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setState((s) => ({ ...s, playing: true, ended: false }));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      cancelAnimationFrame(frame);
      setState((s) => ({ ...s, playing: false, time: v.currentTime }));
    };
    const onEnded = () => setState((s) => ({ ...s, playing: false, ended: true }));
    const onWaiting = () => setState((s) => ({ ...s, buffering: true }));
    const onReady = () => setState((s) => ({ ...s, buffering: false }));
    const onVolume = () => setState((s) => ({ ...s, muted: v.muted, volume: v.volume }));
    const onRate = () => setState((s) => ({ ...s, rate: v.playbackRate }));
    const onSeeked = () => setState((s) => ({ ...s, time: v.currentTime }));
    const events: [string, () => void][] = [
      ["play", onPlay],
      ["pause", onPause],
      ["ended", onEnded],
      ["waiting", onWaiting],
      ["playing", onReady],
      ["canplay", onReady],
      ["volumechange", onVolume],
      ["ratechange", onRate],
      ["seeked", onSeeked],
    ];
    events.forEach(([name, fn]) => v.addEventListener(name, fn));
    return () => {
      cancelAnimationFrame(frame);
      events.forEach(([name, fn]) => v.removeEventListener(name, fn));
    };
  }, [ref]);

  const play = useCallback(() => {
    ref.current?.play().catch(() => setState((s) => ({ ...s, playing: false, buffering: false })));
  }, [ref]);

  const toggle = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    if (v.paused || v.ended) play();
    else v.pause();
  }, [ref, play]);

  const seek = useCallback(
    (sec: number) => {
      const v = ref.current;
      if (!v) return;
      const end = Number.isFinite(v.duration) ? v.duration : sec;
      v.currentTime = Math.min(Math.max(sec, 0), end);
      setState((s) => ({ ...s, time: v.currentTime, ended: false }));
    },
    [ref],
  );

  const setVolume = useCallback(
    (level: number) => {
      const v = ref.current;
      if (!v) return;
      v.volume = Math.min(Math.max(level, 0), 1);
      v.muted = v.volume === 0;
    },
    [ref],
  );

  const setRate = useCallback(
    (rate: number) => {
      const v = ref.current;
      if (v) v.playbackRate = rate;
    },
    [ref],
  );

  return { state, play, toggle, seek, setVolume, setRate };
}

// A silent loop of the opening while on screen, so the player reads as a video at a glance.
function usePreviewLoop(
  frameRef: RefObject<HTMLDivElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const frame = frameRef.current;
    const v = videoRef.current;
    if (!enabled || !frame || !v) return;
    const saveData = "connection" in navigator && (navigator.connection as { saveData?: boolean } | undefined)?.saveData === true;
    if (saveData || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const loop = () => {
      if (v.currentTime >= PREVIEW_LOOP_SEC) v.currentTime = 0;
    };
    v.addEventListener("timeupdate", loop);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          v.muted = true;
          v.play().catch(() => v.pause());
        } else {
          v.pause();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(frame);
    return () => {
      observer.disconnect();
      v.removeEventListener("timeupdate", loop);
    };
  }, [frameRef, videoRef, enabled]);
}

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

// Controls sit in a bar under the picture, not over it: the video has subtitles burned into its lower third.
function VideoPlayer({ clip, title, startAt }: { clip: PlatformVideo; title: string; startAt: RefObject<number | null> }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [engaged, setEngaged] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { state, play, toggle, seek, setVolume, setRate } = usePlayback(videoRef);
  usePreviewLoop(frameRef, videoRef, !engaged && src !== undefined);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    setSrc(mediaUrl(el.clientWidth * window.devicePixelRatio > HD_ABOVE_DEVICE_PX ? clip.hd : clip.sd));
  }, [clip]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: SITE_NAME,
      artwork: [{ src: mediaUrl(clip.poster), sizes: "1080x1920", type: "image/webp" }],
    });
  }, [clip, title]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const start = (at?: number) => {
    const v = videoRef.current;
    if (!v) return;
    setEngaged(true);
    v.muted = false;
    seek(at ?? startAt.current ?? 0);
    startAt.current = null;
    play();
  };
  const togglePlay = () => (engaged ? toggle() : start());
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!engaged) {
      start();
      return;
    }
    if (v.muted && v.volume === 0) v.volume = 1;
    v.muted = !v.muted;
  };
  const toggleFullscreen = () => {
    const card = cardRef.current;
    const v = videoRef.current as FullscreenVideo | null;
    if (!card || !v) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (typeof card.requestFullscreen === "function") {
      void card.requestFullscreen();
    } else if (v.webkitEnterFullscreen) {
      // iPhone Safari only lets the video element itself go fullscreen.
      v.webkitEnterFullscreen();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLButtonElement) return;
    const actions: Record<string, () => void> = {
      " ": togglePlay,
      k: togglePlay,
      ArrowRight: () => seek(state.time + SEEK_STEP_SEC),
      ArrowLeft: () => seek(state.time - SEEK_STEP_SEC),
      m: toggleMute,
      f: toggleFullscreen,
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  const playing = engaged && state.playing;
  const time = engaged ? state.time : 0;

  return (
    <div
      ref={cardRef}
      onKeyDown={onKeyDown}
      className={`flex w-full flex-col overflow-hidden bg-espresso ${
        fullscreen ? "h-full" : "max-w-[min(420px,calc((80svh-80px)*0.5625))] rounded-[26px] shadow-[0_34px_80px_-36px_rgba(44,24,16,0.6)]"
      }`}
    >
      <div ref={frameRef} className={`group relative w-full bg-cream-dark ${fullscreen ? "min-h-0 flex-1 bg-black" : "aspect-[9/16]"}`}>
        <video
          ref={videoRef}
          src={src}
          poster={mediaUrl(clip.poster)}
          preload="none"
          muted
          playsInline
          aria-label={title}
          onClick={togglePlay}
          className="absolute inset-0 h-full w-full object-contain"
        />
        {!engaged ? <StartOverlay duration={clip.durationSec} onStart={() => start()} /> : null}
        {state.ended ? (
          <EndOverlay
            onReplay={() => {
              seek(0);
              play();
            }}
          />
        ) : null}
        {engaged && state.buffering && state.playing ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
            <span className="rounded-full bg-espresso/55 p-3 backdrop-blur-sm">
              <Spinner className="h-7 w-7" />
            </span>
          </div>
        ) : null}
      </div>

      <div dir="ltr" className="px-3 pb-2 pt-2 text-white">
        <Timeline duration={clip.durationSec} time={time} chapters={clip.chapters} onSeek={(t) => (engaged ? seek(t) : start(t))} />
        <div className="flex items-center gap-1">
          <IconButton label={playing ? "השהיה" : "הפעלה"} onClick={togglePlay}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <span className="ms-1 text-xs font-semibold tabular-nums text-white/85">
            {formatTime(time)} / {formatTime(clip.durationSec)}
          </span>
          <span className="flex-1" />
          <SpeedMenu rate={state.rate} open={menuOpen} onOpenChange={setMenuOpen} onPick={setRate} />
          <VolumeControl volume={engaged && state.muted ? 0 : state.volume} onToggleMute={toggleMute} onVolume={setVolume} />
          <IconButton label={fullscreen ? "יציאה ממסך מלא" : "מסך מלא"} onClick={toggleFullscreen}>
            {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function StartOverlay({ duration, onStart }: { duration: number; onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="הפעלת המדריך בווידאו, עם קול"
      className="absolute inset-0 flex flex-col items-center justify-center gap-4"
    >
      <span className="relative flex h-20 w-20 items-center justify-center">
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-terra/40 motion-safe:animate-ping" />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-terra text-white shadow-[0_18px_40px_-10px_rgba(199,82,42,0.8)] ring-[6px] ring-white/40 transition duration-300 group-hover:scale-105">
          <PlayIcon className="h-9 w-9 translate-x-[2px]" />
        </span>
      </span>
      <span className="flex flex-col items-center gap-1 rounded-2xl bg-white/92 px-4 py-2 text-espresso shadow-lg backdrop-blur">
        <span className="text-base font-bold">צפו במדריך</span>
        <span className="text-xs font-semibold tabular-nums text-espresso-light">
          {formatTime(duration)} · עם קול
        </span>
      </span>
    </button>
  );
}

function EndOverlay({ onReplay }: { onReplay: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-espresso/55 px-6 text-center backdrop-blur-[2px]">
      <p className="font-display text-2xl text-white">זהו, הסוכן מחובר</p>
      <button
        type="button"
        onClick={onReplay}
        className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-espresso transition hover:bg-cream"
      >
        <ReplayIcon />
        צפייה חוזרת
      </button>
      <a href="#guide" className="text-sm font-semibold text-white/90 underline-offset-4 hover:underline">
        למדריך הכתוב
      </a>
    </div>
  );
}

function Timeline({
  duration,
  time,
  chapters,
  onSeek,
}: {
  duration: number;
  time: number;
  chapters: VideoChapter[];
  onSeek: (sec: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const spans = chapters.map((c, i) => ({ label: c.label, from: c.startSec, to: chapters[i + 1]?.startSec ?? duration }));

  const timeAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * duration;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = timeAt(e.clientX);
    if (e.pointerType === "mouse") setHover(t);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(t);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowRight: SEEK_STEP_SEC, ArrowUp: SEEK_STEP_SEC, ArrowLeft: -SEEK_STEP_SEC, ArrowDown: -SEEK_STEP_SEC };
    if (e.key in step) onSeek(time + step[e.key]);
    else if (e.key === "Home") onSeek(0);
    else if (e.key === "End") onSeek(duration);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const hoverSpan = hover === null ? null : spans[chapterAt(chapters, hover)];

  return (
    <div
      ref={barRef}
      role="slider"
      tabIndex={0}
      aria-label="מיקום בסרטון"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${formatTime(time)} מתוך ${formatTime(duration)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      className="relative flex h-6 cursor-pointer touch-none items-center gap-[3px] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80"
    >
      {spans.map((s) => {
        const fill = Math.min(Math.max((time - s.from) / (s.to - s.from), 0), 1);
        return (
          <div key={s.from} style={{ flexGrow: s.to - s.from }} className="relative h-[5px] basis-0 overflow-hidden rounded-full bg-white/30">
            <div className="absolute inset-y-0 left-0 rounded-full bg-terra-light" style={{ width: `${fill * 100}%` }} />
          </div>
        );
      })}
      <div
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
        style={{ left: `${(Math.min(time, duration) / duration) * 100}%` }}
      />
      {hover !== null && hoverSpan ? (
        <div
          dir="rtl"
          className="pointer-events-none absolute bottom-7 -translate-x-1/2 whitespace-nowrap rounded-lg bg-espresso/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg"
          style={{ left: `${Math.min(Math.max((hover / duration) * 100, 14), 86)}%` }}
        >
          {hoverSpan.label} · <span className="tabular-nums">{formatTime(hover)}</span>
        </div>
      ) : null}
    </div>
  );
}

function SpeedMenu({
  rate,
  open,
  onOpenChange,
  onPick,
}: {
  rate: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (rate: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) onOpenChange(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`מהירות ניגון ${rate}`}
        className={`rounded-full px-2.5 py-1.5 text-xs font-bold tabular-nums text-white/90 transition hover:bg-white/15 focus-visible:bg-white/15 ${
          open ? "bg-white/15" : ""
        }`}
      >
        {rate}×
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="מהירות ניגון"
          dir="rtl"
          className="absolute bottom-full right-0 mb-2 w-36 rounded-2xl bg-espresso/95 p-1.5 text-white shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop-blur"
        >
          {SPEEDS.map((s) => {
            const on = s === rate;
            return (
              <button
                key={s}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  onPick(s);
                  onOpenChange(false);
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition hover:bg-white/10 ${
                  on ? "font-bold" : "text-white/85"
                }`}
              >
                <span className="flex h-4 w-4 items-center justify-center">{on ? <CheckIcon /> : null}</span>
                <span className="tabular-nums" dir="ltr">
                  {s}×
                </span>
                {s === 1 ? <span className="text-xs text-white/60">רגיל</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// The slider pops up above the button, so opening it never shifts the control row.
function VolumeControl({
  volume,
  onToggleMute,
  onVolume,
}: {
  volume: number;
  onToggleMute: () => void;
  onVolume: (level: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const levelAt = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return volume;
    return Math.min(Math.max((rect.bottom - clientY) / rect.height, 0), 1);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onVolume(levelAt(e.clientY));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onVolume(levelAt(e.clientY));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowUp: 0.1, ArrowRight: 0.1, ArrowDown: -0.1, ArrowLeft: -0.1 };
    if (!(e.key in step)) return;
    e.preventDefault();
    e.stopPropagation();
    onVolume(volume + step[e.key]);
  };

  return (
    <div className="group/vol relative">
      <IconButton label={volume === 0 ? "הפעלת קול" : "השתקה"} onClick={onToggleMute}>
        {volume === 0 ? <MutedIcon /> : <VolumeIcon />}
      </IconButton>
      <div className="invisible absolute bottom-full left-1/2 -translate-x-1/2 pb-2 opacity-0 transition-opacity duration-150 group-focus-within/vol:visible group-focus-within/vol:opacity-100 group-hover/vol:visible group-hover/vol:opacity-100 pointer-coarse:hidden">
        <div className="rounded-2xl bg-espresso/95 px-2 py-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="עוצמת קול"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(volume * 100)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
            onKeyDown={onKeyDown}
            className="relative flex h-24 w-6 cursor-pointer touch-none justify-center outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <div className="relative h-full w-1 rounded-full bg-white/30">
              <div className="absolute inset-x-0 bottom-0 rounded-full bg-white" style={{ height: `${volume * 100}%` }} />
            </div>
            <div
              className="pointer-events-none absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow"
              style={{ bottom: `${volume * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/15 focus-visible:bg-white/15 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

function chapterAt(chapters: VideoChapter[], time: number): number {
  let index = 0;
  chapters.forEach((c, i) => {
    if (time >= c.startSec) index = i;
  });
  return index;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PlayIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} fill-current`}>
      <path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.2-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />
    </svg>
  );
}
