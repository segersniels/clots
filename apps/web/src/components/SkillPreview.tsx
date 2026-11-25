import type { BotSummary } from "@clots/contracts";
import { BoxIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";

import { useMediaQuery } from "../hooks/use-media-query.ts";
import { BUBBLE } from "./Chat.tsx";
import { ReferencePicker } from "./ReferencePicker.tsx";
import { ReferenceChip } from "./ReferenceText.tsx";

/** What the preview shows for a field that is still empty. */
const NAME_PLACEHOLDER = "skill-name";
const WHEN_PLACEHOLDER = "Use it when …";

/** What the composer of the preview holds. An empty draft shows the placeholder. */
interface Draft {
  readonly chip: boolean;
  readonly text: string;
}

const EMPTY_DRAFT: Draft = { chip: false, text: "" };

/** Waits, or stops the loop when the preview unmounts. */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Shows a skill name as the chip of a message. A missing name shows muted. */
function SkillChip({ name }: { name: string }) {
  return (
    <span className={name === "" ? "opacity-45" : undefined}>
      <ReferenceChip kind="skill" name={name || NAME_PLACEHOLDER} />
    </span>
  );
}

/**
 * Plays how the operator calls the skill in the bot's thread: the composer types a slash, the
 * picker shows the skill, Enter makes the chip, and the chip lands as the operator's bubble.
 * Each round reads the fields again. With reduced motion, only the sent message shows.
 */
export function SkillPreview({ bot, name, when }: { bot: BotSummary; name: string; when: string }) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const fields = useRef({ name, when });
  const [round, setRound] = useState({ name, when });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fields.current = { name, when };
  });

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const stop = new AbortController();
    const pause = (ms: number) => wait(ms, stop.signal);

    const play = async () => {
      for (;;) {
        setSent(false);
        setDraft(EMPTY_DRAFT);
        await pause(700);

        const current = fields.current;
        setRound(current);

        const slash = `/${(current.name || NAME_PLACEHOLDER).slice(0, 3)}`;
        for (let length = 1; length <= slash.length; length++) {
          setDraft({ chip: false, text: slash.slice(0, length) });
          setPickerOpen(true);
          await pause(110);
        }

        await pause(1100);
        setPickerOpen(false);
        setDraft({ chip: true, text: " " });
        await pause(950);
        setDraft(EMPTY_DRAFT);
        setSent(true);
        await pause(3000);
      }
    };

    // The loop ends only when the preview unmounts.
    play().catch(() => {});

    return () => stop.abort();
  }, [reducedMotion]);

  // A loop that reduced motion stopped halfway leaves its state, so reduced motion ignores it.
  const shown = reducedMotion ? { name, when } : round;
  const typed = reducedMotion ? EMPTY_DRAFT : draft;

  return (
    <div
      aria-hidden
      inert
      className="relative h-[120px] shrink-0 overflow-hidden rounded-[14px] bg-background ring-1 ring-border ring-inset"
    >
      {/* The sent bubble lands with a small overshoot. At the next round it only fades, then drops back unseen. */}
      <div className="absolute inset-x-3.5 top-3.5 bottom-[62px] flex flex-col justify-end">
        <Bubble
          align="end"
          className={
            sent || reducedMotion
              ? "translate-y-0 opacity-100 [transition:opacity_250ms_var(--ease-out),translate_300ms_cubic-bezier(0.2,0.9,0.3,1.2)]"
              : "translate-y-2.5 opacity-0 [transition:opacity_150ms_var(--ease-out),translate_0s_150ms]"
          }
        >
          <BubbleContent className={`${BUBBLE} whitespace-nowrap`}>
            <SkillChip name={shown.name} />
          </BubbleContent>
        </Bubble>
      </div>

      <div className="absolute inset-x-3 bottom-3">
        <ReferencePicker
          open={pickerOpen && !reducedMotion}
          label="Skills"
          items={[
            {
              name: shown.name || NAME_PLACEHOLDER,
              description: shown.when || WHEN_PLACEHOLDER,
              icon: <BoxIcon className="text-skill" />,
            },
          ]}
          activeIndex={0}
          emptyText=""
          onPick={() => {}}
          onHover={() => {}}
          className={
            shown.name === "" ? "[&_[role=option]>span:first-of-type]:opacity-45" : undefined
          }
        />
        <div className="flex h-10 items-center overflow-hidden rounded-full border bg-popover px-3.5 text-sm whitespace-pre">
          {typed === EMPTY_DRAFT ? (
            <span className="text-muted-foreground">Message {bot.name}</span>
          ) : (
            <>
              {typed.chip && (
                <span className="animate-in duration-300 ease-[cubic-bezier(0.2,0.9,0.3,1.4)] fade-in zoom-in-75">
                  <SkillChip name={shown.name} />
                </span>
              )}
              {typed.text}
              <span className="ml-px inline-block h-4 w-[1.5px] animate-[caret-blink_1s_steps(1)_infinite] bg-foreground" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
