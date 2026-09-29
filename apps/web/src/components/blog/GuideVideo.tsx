"use client";

import { useEffect, useRef, useState } from "react";
import type { DevicePlatform, PostVideo } from "@/lib/blog";
import { CONTROLS_HEIGHT, GuidePlayer } from "./GuidePlayer";
import { CheckIcon } from "./icons";
import { PLATFORM_OPTIONS, detectPlatform, usePlatformChoice } from "./PlatformGuide";

// 372px = the page header, the phone switch and the controls bar, so on desktop the whole player fits the screen.
const STAGE_WIDTH = "w-full max-w-[440px] lg:max-w-[clamp(320px,calc((100svh-372px)*0.5625+32px),440px)]";

export function GuideVideo({ video }: { video: PostVideo }) {
  const choice = usePlatformChoice();
  const [platform, setPlatform] = useState<DevicePlatform | null>(null);
  const [startAt, setStartAt] = useState<number | null>(null);
  const watching = useRef(false);

  // A shared link picks the phone for this visit only, and a chapter link starts the video there.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("v");
    const detected = detectPlatform();
    if (linked === "ios" || linked === "android") {
      choice?.choose(linked, false);
      setPlatform(linked);
    } else {
      setPlatform(detected === "all" ? "ios" : detected);
    }
    const t = Number(params.get("t"));
    if (Number.isFinite(t) && t > 0) {
      setStartAt(t);
      document.getElementById("video")?.scrollIntoView({ block: "center" });
    }
  }, []);

  // Follows a phone picked elsewhere on the page, but never swaps the video under someone watching it.
  useEffect(() => {
    if (choice && choice.platform !== "all" && !watching.current) setPlatform(choice.platform);
  }, [choice]);

  const pick = (p: DevicePlatform) => {
    watching.current = false;
    setPlatform(p);
    choice?.choose(p);
  };

  return (
    <section id="video" aria-label="מדריך וידאו" className="flex scroll-mt-28 flex-col items-center gap-3">
      <PlatformSwitch value={platform} onChange={pick} />
      <div className={`${STAGE_WIDTH} rounded-[32px] bg-[radial-gradient(120%_80%_at_50%_8%,#3A3A40_0%,#1E1E22_60%,#141416_100%)] p-3 shadow-[0_40px_80px_-40px_rgba(20,12,8,0.7)] sm:p-4`}>
        {platform ? (
          <GuidePlayer
            key={platform}
            clip={video.byPlatform[platform]}
            title={video.title}
            startAt={startAt}
            onEngage={() => {
              watching.current = true;
            }}
          />
        ) : (
          <div aria-hidden="true" className="overflow-hidden rounded-[22px] bg-[#121214]">
            <div className="aspect-[9/16]" />
            <div className={CONTROLS_HEIGHT} />
          </div>
        )}
      </div>
    </section>
  );
}

function PlatformSwitch({ value, onChange }: { value: DevicePlatform | null; onChange: (p: DevicePlatform) => void }) {
  return (
    <div className={STAGE_WIDTH}>
      <p id="video-platform" className="mb-2 text-center text-sm font-bold text-espresso">
        באיזה טלפון אתם?
      </p>
      <div role="group" aria-labelledby="video-platform" className="grid grid-cols-2 gap-2">
        {PLATFORM_OPTIONS.map((p) => {
          const on = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(p.id)}
              className={`flex h-14 items-center justify-center gap-2.5 rounded-2xl text-base font-bold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-terra/40 ${
                on
                  ? "bg-espresso text-white shadow-[0_12px_28px_-14px_rgba(44,24,16,0.8)]"
                  : "border-2 border-sand-light bg-white text-espresso hover:border-espresso"
              }`}
            >
              {p.icon}
              {p.label}
              {on ? <CheckIcon /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
