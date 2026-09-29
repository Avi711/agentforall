"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { Spinner } from "@/app/app/Marks";
import { prefersReducedMotion } from "@/components/motion";
import type { PlatformVideo } from "@/lib/blog";
import { SITE_NAME, mediaUrl } from "@/lib/site";
import { PlayIcon } from "./icons";
import {
  CollapseIcon,
  ExpandIcon,
  IconButton,
  PauseIcon,
  ReplayIcon,
  SEEK_STEP_SEC,
  SpeedMenu,
  Timeline,
  VolumeControl,
  formatTime,
} from "./PlayerControls";

const PREVIEW_PASSES = 2;
const DOUBLE_TAP_MS = 300;
// Wider than this in device pixels, the 720p file starts to look soft.
const HD_ABOVE_DEVICE_PX = 760;
export const CONTROLS_HEIGHT = "h-20";

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

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

function usePlayback(ref: RefObject<HTMLVideoElement | null>, tracking: boolean) {
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
      if (tracking) frame = requestAnimationFrame(tick);
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
    if (tracking && !v.paused) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      events.forEach(([name, fn]) => v.removeEventListener(name, fn));
    };
  }, [ref, tracking]);

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

// A short silent clip of the opening plays twice while on screen, so the player reads as a video at a glance.
function usePreview(videoRef: RefObject<HTMLVideoElement | null>, url: string, enabled: boolean) {
  useEffect(() => {
    const v = videoRef.current;
    if (!enabled || !v) return;
    const connection: unknown = "connection" in navigator ? navigator.connection : undefined;
    const saveData = typeof connection === "object" && connection !== null && "saveData" in connection && connection.saveData === true;
    if (saveData || prefersReducedMotion()) return;
    let passes = 0;
    const backToPoster = () => {
      v.removeAttribute("src");
      v.load();
    };
    const onEnded = () => {
      passes += 1;
      if (passes < PREVIEW_PASSES) v.play().catch(backToPoster);
      else backToPoster();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          v.pause();
          return;
        }
        if (passes >= PREVIEW_PASSES) return;
        if (!v.getAttribute("src")) v.src = url;
        v.muted = true;
        v.play().catch(backToPoster);
      },
      { threshold: 0.4 },
    );
    v.addEventListener("ended", onEnded);
    observer.observe(v);
    return () => {
      observer.disconnect();
      v.removeEventListener("ended", onEnded);
    };
  }, [videoRef, url, enabled]);
}

// Fullscreen can be refused (user settings, an embedding frame); the player keeps working inline.
function ignoreRefusal() {
  return undefined;
}

// Controls sit in a bar under the picture, not over it: the video has subtitles burned into its lower third.
export function GuidePlayer({
  clip,
  title,
  startAt,
  onEngage,
}: {
  clip: PlatformVideo;
  title: string;
  startAt: number | null;
  onEngage: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const [engaged, setEngaged] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { state, play, toggle, seek, setVolume, setRate } = usePlayback(videoRef, engaged);
  usePreview(videoRef, mediaUrl(clip.preview), !engaged && startAt === null);

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

  const start = (at = startAt ?? 0) => {
    const v = videoRef.current;
    const card = cardRef.current;
    if (!v || !card) return;
    const full = mediaUrl(card.clientWidth * window.devicePixelRatio > HD_ABOVE_DEVICE_PX ? clip.hd : clip.sd);
    if (v.getAttribute("src") !== full) v.src = full;
    v.muted = false;
    if (at > 0) {
      if (v.readyState >= HTMLMediaElement.HAVE_METADATA) seek(at);
      else v.addEventListener("loadedmetadata", () => seek(at), { once: true });
    }
    setEngaged(true);
    onEngage();
    play();
    requestAnimationFrame(() => playButtonRef.current?.focus());
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
    if (!engaged) start();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(ignoreRefusal);
    } else if (document.fullscreenEnabled) {
      card.requestFullscreen().catch(ignoreRefusal);
    } else {
      v.webkitEnterFullscreen?.();
    }
  };
  const lastTapAt = useRef(0);
  const onVideoPointerUp = (e: PointerEvent<HTMLVideoElement>) => {
    if (e.button !== 0) return;
    const isDoubleTap = e.timeStamp - lastTapAt.current < DOUBLE_TAP_MS;
    lastTapAt.current = isDoubleTap ? 0 : e.timeStamp;
    if (isDoubleTap) toggleFullscreen();
  };
  const replay = () => {
    seek(0);
    play();
    playButtonRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
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
      role="group"
      aria-label={title}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`flex w-full flex-col overflow-hidden bg-[#121214] outline-none focus-visible:ring-4 focus-visible:ring-terra/60 ${fullscreen ? "h-full" : "rounded-[22px]"}`}
    >
      <div className={`group relative w-full ${fullscreen ? "min-h-0 flex-1 bg-black" : "aspect-[9/16] bg-cream-dark"}`}>
        <video
          ref={videoRef}
          poster={mediaUrl(clip.poster)}
          preload="none"
          muted
          playsInline
          aria-label={title}
          onClick={togglePlay}
          onPointerUp={onVideoPointerUp}
          className="absolute inset-0 h-full w-full touch-manipulation object-contain"
        />
        {!engaged ? <StartOverlay duration={clip.durationSec} resumeAt={startAt} onStart={() => start()} /> : null}
        {engaged && state.ended ? <EndOverlay onReplay={replay} /> : null}
        {engaged && state.buffering && state.playing ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
            <span className="rounded-full bg-espresso/55 p-3 backdrop-blur-sm">
              <Spinner className="h-7 w-7" />
            </span>
          </div>
        ) : null}
      </div>

      <div dir="ltr" className={`${CONTROLS_HEIGHT} flex flex-col justify-center px-3 text-white`}>
        <Timeline duration={clip.durationSec} time={time} chapters={clip.chapters} onSeek={(t) => (engaged ? seek(t) : start(t))} />
        <div className="flex items-center gap-1">
          <IconButton buttonRef={playButtonRef} label={playing ? "השהיה" : "הפעלה"} onClick={togglePlay}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <span className="ms-1 whitespace-nowrap text-xs font-semibold tabular-nums text-white/85">
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

function StartOverlay({ duration, resumeAt, onStart }: { duration: number; resumeAt: number | null; onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      aria-label={resumeAt ? `הפעלת המדריך מ־${formatTime(resumeAt)}, עם קול` : "הפעלת המדריך בווידאו, עם קול"}
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-white"
    >
      <span className="relative flex h-20 w-20 items-center justify-center">
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-terra/40 motion-safe:animate-ping" />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-terra text-white shadow-[0_18px_40px_-10px_rgba(199,82,42,0.8)] ring-[6px] ring-white/40 transition duration-300 group-hover:scale-105">
          <PlayIcon className="h-9 w-9 translate-x-[2px]" />
        </span>
      </span>
      <span className="flex flex-col items-center gap-1 rounded-2xl bg-white/95 px-4 py-2 text-espresso shadow-lg backdrop-blur">
        <span className="text-base font-bold">{resumeAt ? "ממשיכים מאותו רגע" : "צפו במדריך"}</span>
        <span className="text-xs font-semibold tabular-nums text-espresso-light">
          {resumeAt ? `מ־${formatTime(resumeAt)}` : formatTime(duration)} · עם קול
        </span>
      </span>
    </button>
  );
}

function EndOverlay({ onReplay }: { onReplay: () => void }) {
  const replayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => replayRef.current?.focus(), []);
  return (
    <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-espresso/80 px-6 text-center backdrop-blur-[2px]">
      <p className="font-display text-2xl text-white">זהו, הסוכן מחובר</p>
      <button
        ref={replayRef}
        type="button"
        onClick={onReplay}
        className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-espresso transition hover:bg-cream focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-terra-light"
      >
        <ReplayIcon />
        צפייה חוזרת
      </button>
      <a href="#guide" className="text-sm font-semibold text-white underline-offset-4 hover:underline">
        למדריך הכתוב
      </a>
    </div>
  );
}
