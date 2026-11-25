"use client";

import { Character, type CharacterMood } from "@clots/character";
import type { CharacterColor, CharacterShape } from "@clots/character/traits";
import { ArrowUpRight, Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Places the live clots around the edges of the screen, in % of the screen. A `wide` clot hides on
 * a narrow screen and a `tall` clot on a low one, so none of them covers the text.
 */
const CAST: {
  shape: CharacterShape;
  color: CharacterColor;
  mood: CharacterMood;
  left: string;
  top: string;
  size: number;
  tilt: string;
  delay: string;
  wide?: boolean;
  tall?: boolean;
}[] = [
  {
    shape: "tumble",
    color: "red",
    mood: "idle",
    left: "12%",
    top: "24%",
    size: 104,
    tilt: "-6deg",
    delay: "-1s",
    wide: true,
  },
  {
    shape: "bud",
    color: "pink",
    mood: "working",
    left: "30%",
    top: "9%",
    size: 62,
    tilt: "5deg",
    delay: "-3s",
    tall: true,
  },
  {
    shape: "bean",
    color: "blue",
    mood: "waiting",
    left: "73%",
    top: "11%",
    size: 78,
    tilt: "-4deg",
    delay: "-5s",
  },
  {
    shape: "grape",
    color: "green",
    mood: "idle",
    left: "89%",
    top: "30%",
    size: 112,
    tilt: "6deg",
    delay: "-2s",
    wide: true,
  },
  {
    shape: "dollop",
    color: "amber",
    mood: "working",
    left: "8%",
    top: "72%",
    size: 88,
    tilt: "4deg",
    delay: "-4s",
    wide: true,
  },
  {
    shape: "stack",
    color: "purple",
    mood: "idle",
    left: "24%",
    top: "88%",
    size: 58,
    tilt: "-5deg",
    delay: "-6s",
    wide: true,
    tall: true,
  },
  {
    shape: "twin",
    color: "teal",
    mood: "working",
    left: "80%",
    top: "84%",
    size: 96,
    tilt: "-3deg",
    delay: "-2.5s",
    wide: true,
  },
  {
    shape: "puddle",
    color: "orange",
    mood: "idle",
    left: "93%",
    top: "66%",
    size: 60,
    tilt: "5deg",
    delay: "-0.5s",
    wide: true,
    tall: true,
  },
];

const DOWNLOAD_URL = "https://github.com/segersniels/clots/releases/latest/download/Clots.dmg";

const REPOSITORY_URL = "https://github.com/segersniels/clots";

export default function Home() {
  const [hops, setHops] = useState(() => CAST.map(() => 0));

  /** The whole cast hops once, one after the other, when the pointer reaches the download button. */
  const hopAll = () =>
    CAST.forEach((_, index) =>
      setTimeout(() => setHops((counts) => counts.with(index, counts[index]! + 1)), index * 40),
    );

  return (
    <main className="relative grid h-dvh place-items-center overflow-hidden px-[max(20px,env(safe-area-inset-left))] py-6 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {CAST.map((clot, index) => (
          <div
            key={clot.shape}
            className={cn(
              "absolute -translate-1/2 animate-float motion-reduce:animate-none",
              clot.wide && "max-[820px]:hidden",
              clot.tall && "[@media(max-height:640px)]:hidden",
            )}
            style={
              {
                left: clot.left,
                top: clot.top,
                animationDelay: clot.delay,
                "--tilt": clot.tilt,
              } as React.CSSProperties
            }
          >
            <Character
              shape={clot.shape}
              color={clot.color}
              mood={clot.mood}
              size={clot.size}
              hops={hops[index]!}
            />
          </div>
        ))}
      </div>

      <div className="relative z-1 max-w-[760px]">
        <h1 className="text-[clamp(44px,8vw,96px)] leading-[0.98] font-semibold tracking-[-0.035em] text-balance">
          Bots that never stop working
        </h1>
        <p className="mx-auto mt-[26px] max-w-[33rem] text-[clamp(17px,2vw,20px)] leading-normal text-pretty text-muted-foreground">
          Claude bots with their own instructions, memory, browser and routines. Run them on a
          machine that stays on, and they keep going while you are away.
        </p>
        <Button
          nativeButton={false}
          render={<a href={DOWNLOAD_URL} />}
          onPointerEnter={hopAll}
          className="mt-9 h-[54px] gap-2.5 rounded-full pr-[26px] pl-[22px] text-base transition-[opacity,scale] hover:bg-primary hover:opacity-90 focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-attention"
        >
          <Download className="size-[19px]" />
          Download for macOS
        </Button>
        <div>
          <a
            href={REPOSITORY_URL}
            className="mt-[18px] inline-flex items-center gap-2 rounded-full text-[15px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-attention"
          >
            <GitHubIcon />
            Open source on GitHub
            <ArrowUpRight className="size-[13px]" />
          </a>
        </div>
        <p className="mt-3.5 text-[13px] text-muted-foreground opacity-80">
          Needs Claude Code with a Claude subscription
        </p>
      </div>
    </main>
  );
}

/** Draws the GitHub mark. Lucide no longer ships brand icons. */
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-[17px]">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
