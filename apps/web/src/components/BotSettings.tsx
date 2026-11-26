import { Character } from "@clots/character";
import type { BotId, BotSummary } from "@clots/contracts";
import { useEffectEvent, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { client } from "../client.ts";
import { CharacterPicker } from "./CharacterPicker.tsx";
import { ComposerField, type ComposerFieldHandle } from "./ComposerField.tsx";

/** The look of a form field with skill and bot chips: the filled surface of the details pane. Each use adds its height. */
export const CHIP_FIELD_CLASSES =
  "max-h-60 overflow-y-auto rounded-xl bg-muted/60 transition-[background-color,box-shadow] duration-150 focus-within:bg-muted focus-within:ring-1 focus-within:ring-ring/40";

/** The label row of a section in the details pane. Its text lines up with the group labels of the bot list. */
export const PANE_LABEL = "flex h-7 items-center px-1 text-[0.8125rem] text-muted-foreground";

/** The line that a section in the details pane shows while it has no rows. It sits on the label line. */
export const PANE_EMPTY = "px-1 text-sm text-muted-foreground";

/** Caps the picker of a pane field at about six rows, so it covers at most the row above and never its label. */
export const CHIP_PICKER_CLASSES = "max-h-[13.5rem]";

/**
 * Shows the character and the name of a bot. A click on either one edits it. A clone has the look of
 * the bot that it mirrors, so only its name is editable.
 */
export function BotIdentity({ bot }: { bot: BotSummary }) {
  const [name, setName] = useState(bot.name);

  const saveName = () => {
    const trimmed = name.trim();

    // A bot always has a name, so an empty field goes back to the saved one.
    if (trimmed === "") {
      return setName(bot.name);
    }

    if (trimmed !== bot.name) {
      void client.updateBot(bot.id, { name: trimmed });
    }
  };

  const character = <Character shape={bot.shape} color={bot.color} mood={bot.status} size={64} />;

  return (
    <section className="flex flex-col items-center gap-1.5">
      {bot.clonedFrom !== null && <div className="p-2">{character}</div>}
      {bot.clonedFrom === null && (
        <Popover>
          <PopoverTrigger
            aria-label="Edit character"
            className="rounded-2xl p-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {character}
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4">
            <CharacterPicker
              color={bot.color}
              shape={bot.shape}
              onColorChange={(color) => client.updateBot(bot.id, { color })}
              onShapeChange={(shape) => client.updateBot(bot.id, { shape })}
            />
          </PopoverContent>
        </Popover>
      )}

      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        aria-label="Name"
        className="h-8 w-auto max-w-full border-transparent bg-transparent text-center text-base font-medium shadow-none field-sizing-content hover:bg-muted md:text-base dark:bg-transparent"
      />
    </section>
  );
}

/** How long the instructions field shows its ring after a save from another place, such as the thread of a new bot. */
const FLASH_MS = 900;

/** The instruction fields on screen, so that a save from another place can point the operator at them. */
const instructionFlashes = new Map<BotId, () => void>();

/** Makes the instructions field of the bot, if the details pane shows it, light up once. */
export const flashInstructions = (botId: BotId) => instructionFlashes.get(botId)?.();

/**
 * Lets the operator edit the instructions of a bot. The bot reads them when its next session starts.
 * A clone shows the instructions of the bot that it mirrors as text, and hides the section when
 * there are none.
 */
export function BotInstructions({ bot }: { bot: BotSummary }) {
  const [instructions, setInstructions] = useState(bot.instructions);
  const [flashing, setFlashing] = useState(false);
  const field = useRef<ComposerFieldHandle>(null);

  const saveInstructions = () => {
    if (instructions.trim() !== bot.instructions) {
      void client.updateBot(bot.id, { instructions: instructions.trim() });
    }
  };

  const syncField = useEffectEvent((saved: string) => {
    if (saved !== instructions.trim()) {
      field.current?.setText(saved);
    }
  });

  // The instructions can change in another place, such as the thread of a new bot.
  useMountEffect(() => {
    let lastSaved = bot.instructions;

    return client.bots.subscribe(() => {
      const saved = client.bots.get().find((candidate) => candidate.id === bot.id)?.instructions;

      if (saved !== undefined && saved !== lastSaved) {
        lastSaved = saved;
        syncField(saved);
      }
    });
  });

  useMountEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    instructionFlashes.set(bot.id, () => {
      setFlashing(true);

      // A save during the ring does not make it last longer.
      if (timer !== undefined) {
        return;
      }

      timer = setTimeout(() => {
        timer = undefined;
        setFlashing(false);
      }, FLASH_MS);
    });

    return () => {
      instructionFlashes.delete(bot.id);
      clearTimeout(timer);
    };
  });

  if (bot.clonedFrom !== null) {
    if (bot.instructions.trim() === "") {
      return null;
    }

    return (
      <section className="flex flex-col gap-1">
        <h2 className={PANE_LABEL}>Instructions</h2>
        {/* The block matches the field of a bot that is no clone, so the text lines up when the operator switches between them. */}
        <p className="rounded-xl bg-muted/60 px-2.5 py-1.5 text-sm wrap-break-word whitespace-pre-wrap">
          {bot.instructions}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-1">
      <h2 className={PANE_LABEL}>Instructions</h2>
      <div className="relative">
        <ComposerField
          ref={field}
          botId={bot.id}
          label="Instructions"
          placeholder="What this bot does and how it behaves"
          initialText={bot.instructions}
          onTextChange={setInstructions}
          onBlur={saveInstructions}
          autoFocus={false}
          className={`${CHIP_FIELD_CLASSES} min-h-13 ${flashing ? "ring-2 ring-attention/50" : ""}`}
          pickerClassName={CHIP_PICKER_CLASSES}
        />
      </div>
    </section>
  );
}
