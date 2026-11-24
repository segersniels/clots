import { Character, type Gaze } from "@clots/character";
import type { BotId, BotSummary } from "@clots/contracts";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { client } from "../client.ts";
import { flashInstructions } from "./BotSettings.tsx";
import { Collapse } from "./Collapse.tsx";
import { ComposerField, type ComposerFieldHandle } from "./ComposerField.tsx";

/** The examples that a click puts in the field, for the operator to change. */
const STARTERS = [
  {
    label: "Review pull requests",
    text: "Review the open pull requests every morning. Point out bugs and missing tests, and keep your comments short.",
  },
  {
    label: "Write a morning briefing",
    text: "Write me a short briefing every morning: my meetings of the day, the emails that need an answer, and the news in my field.",
  },
  {
    label: "Watch mentions of my product",
    text: "Watch for mentions of my product on X, Reddit and Hacker News. Tell me about each one that needs an answer.",
  },
  {
    label: "Plan my week",
    text: "Help me plan my week every Monday morning: list my meetings and deadlines, and give each task a time.",
  },
];

/** Makes the eyes look down at the field while the operator types in it. */
const LOOK_AT_FIELD: Gaze = { x: 0, y: 0.87 };

/** Makes the eyes look further down, at the composer, once the field is done. */
const LOOK_AT_COMPOSER: Gaze = { x: 0, y: 1 };

/** The keys that save the field. */
const SAVE_KEYS = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘↵" : "Ctrl+↵";

/** The bots whose instructions the operator skipped. The thread asks again after the app starts again. */
const skippedBots = new Set<BotId>();

/** What the empty thread shows: the field for the instructions, the saved instructions, or one line after a skip. */
type Step = "field" | "saved" | "skipped";

/**
 * Asks for the instructions of a bot whose thread has no messages yet. They are optional: the
 * operator can skip them and send a message. The text is the same as Instructions in the details pane.
 */
export function EmptyThread({ bot, focusOnOpen, onDone }: { bot: BotSummary; focusOnOpen: boolean; onDone: () => void }) {
  const [step, setStep] = useState<Step>(() => {
    if (bot.instructions.trim() !== "") return "saved";

    return skippedBots.has(bot.id) ? "skipped" : "field";
  });
  const [text, setText] = useState(bot.instructions);
  const [typing, setTyping] = useState(false);
  const [hops, setHops] = useState(0);
  const field = useRef<ComposerFieldHandle>(null);
  const saved = useRef(bot.instructions);
  // The field is inert until its step renders, so it takes the caret after that.
  const focusField = useRef(false);
  const empty = text.trim() === "";

  useEffect(() => {
    if (step !== "field" || !focusField.current) return;

    focusField.current = false;
    field.current?.focus();
  }, [step]);

  // The instructions can change in the details pane while the thread shows them.
  useEffect(() => {
    if (bot.instructions === saved.current) return;

    saved.current = bot.instructions;
    field.current?.setText(bot.instructions);
  }, [bot.instructions]);

  /** Saves the field through the same update as the details pane. */
  const save = () => {
    const trimmed = text.trim();

    if (trimmed === saved.current) return;

    saved.current = trimmed;
    void client.updateBot(bot.id, { instructions: trimmed });
  };

  const finish = () => {
    if (empty) return;

    save();
    setStep("saved");
    setHops((count) => count + 1);
    flashInstructions(bot.id);
    onDone();
  };

  const skip = () => {
    skippedBots.add(bot.id);
    setStep("skipped");
    onDone();
  };

  const edit = () => {
    skippedBots.delete(bot.id);
    focusField.current = true;
    setStep("field");
  };

  const start = (example: string) => {
    field.current?.setText(example);
    field.current?.focus();
  };

  const gaze = step === "field" ? (typing ? LOOK_AT_FIELD : undefined) : LOOK_AT_COMPOSER;

  return (
    <div className="flex w-full max-w-[520px] flex-col text-center">
      <Character shape={bot.shape} color={bot.color} size={96} gaze={gaze} hops={hops} className="mb-3.5 self-center" />

      <Collapse open={step === "field"} unclipWhenOpen>
        <h2 className="mb-1 text-xl font-semibold tracking-[-0.01em]">What should {bot.name} do?</h2>
        <p className="mx-auto mb-[18px] max-w-[42ch] text-sm text-muted-foreground">
          Give it instructions before its first message. You can change them later in its details.
        </p>

        {/* The picker of the field opens above it. */}
        <div
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          className="relative w-full rounded-2xl bg-muted px-1 pt-1.5 pb-2.5 text-left transition-[background-color,box-shadow] duration-150 focus-within:bg-[color-mix(in_oklab,var(--muted),var(--foreground)_4%)] focus-within:ring-1 focus-within:ring-ring/40"
        >
          <ComposerField
            ref={field}
            botId={bot.id}
            label="Instructions"
            placeholder="For example: review the open pull requests every morning and point out bugs."
            initialText={bot.instructions}
            onTextChange={setText}
            onSubmit={finish}
            onBlur={save}
            autoFocus={focusOnOpen && step === "field"}
            className="max-h-60 overflow-y-auto [&_.ProseMirror]:min-h-[4.875rem] [&_.ProseMirror]:text-[14.5px] [&_.ProseMirror]:leading-normal"
          />
          <div className="mt-2 flex items-center gap-1 px-2.5">
            <span className="text-xs text-muted-foreground">{empty ? "Optional" : `${SAVE_KEYS} to save`}</span>
            <Button variant="ghost" size="sm" className="ml-auto h-8 rounded-full text-muted-foreground" onClick={skip}>
              Skip
            </Button>
            <Button size="sm" className="h-8 rounded-full px-3.5" disabled={empty} onClick={finish}>
              Save
            </Button>
          </div>
        </div>

        <Collapse open={empty}>
          <div className="flex flex-wrap justify-center gap-2 pt-3.5">
            {STARTERS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                onClick={() => start(starter.text)}
                className="h-[30px] rounded-full px-3 text-[13px] text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] transition-colors duration-150 outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {starter.label}
              </button>
            ))}
          </div>
        </Collapse>
      </Collapse>

      <Collapse open={step !== "field"}>
        <h2 className="mb-1 text-xl font-semibold tracking-[-0.01em]">{bot.name}</h2>
        <p className="mx-auto max-w-[42ch] text-sm text-muted-foreground">Send {bot.name} its first message.</p>

        <Collapse open={step === "saved"}>
          <div className="mt-[18px] flex w-full gap-3 rounded-2xl bg-muted px-3.5 py-3 text-left">
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckIcon className="size-3.5 text-emerald-500 dark:text-emerald-400" />
                Instructions
              </p>
              <p className="line-clamp-2 text-sm">{bot.instructions}</p>
            </div>
            <button
              type="button"
              onClick={edit}
              className="self-start rounded-sm text-[13px] text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Edit
            </button>
          </div>
        </Collapse>

        <Collapse open={step === "skipped"}>
          <p className="mt-[18px] text-[13.5px] text-muted-foreground">
            No instructions yet.{" "}
            <button
              type="button"
              onClick={edit}
              className="rounded-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Add them
            </button>
          </p>
        </Collapse>
      </Collapse>
    </div>
  );
}
