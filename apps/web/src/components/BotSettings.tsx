import { Character } from "@clots/character";
import type { BotId, BotSummary } from "@clots/contracts";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { client } from "../client.ts";
import { CharacterPicker } from "./CharacterPicker.tsx";
import { ComposerField, type ComposerFieldHandle } from "./ComposerField.tsx";

/** The look of a form field with skill and bot chips: the filled surface of the details pane. Each use adds its height. */
export const CHIP_FIELD_CLASSES =
  "max-h-60 overflow-y-auto rounded-xl bg-muted/60 transition-[background-color,box-shadow] duration-150 focus-within:bg-muted focus-within:ring-1 focus-within:ring-ring/40";

/** Caps the picker of a pane field at about six rows, so it covers at most the row above and never its label. */
export const CHIP_PICKER_CLASSES = "max-h-[13.5rem]";

/** Shows the character and the name of a bot. A click on either one edits it. */
export function BotIdentity({ bot }: { bot: BotSummary }) {
  const [name, setName] = useState(bot.name);

  const saveName = () => {
    const trimmed = name.trim();

    // A bot always has a name, so an empty field goes back to the saved one.
    if (trimmed === "") return setName(bot.name);
    if (trimmed !== bot.name) void client.updateBot(bot.id, { name: trimmed });
  };

  return (
    <section className="flex flex-col items-center gap-1.5">
      <Popover>
        <PopoverTrigger aria-label="Edit character" className="rounded-2xl p-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
          <Character shape={bot.shape} color={bot.color} mood={bot.status} size={64} />
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

/** Lets the operator edit the instructions of a bot. The bot reads them when its next session starts. */
export function BotInstructions({ bot }: { bot: BotSummary }) {
  const [instructions, setInstructions] = useState(bot.instructions);
  const [flashing, setFlashing] = useState(false);
  const field = useRef<ComposerFieldHandle>(null);

  const saveInstructions = () => {
    if (instructions.trim() !== bot.instructions) void client.updateBot(bot.id, { instructions: instructions.trim() });
  };

  // The instructions can change in another place, such as the thread of a new bot.
  useEffect(() => {
    if (bot.instructions !== instructions.trim()) field.current?.setText(bot.instructions);
  }, [bot.instructions]);

  useEffect(() => {
    instructionFlashes.set(bot.id, () => setFlashing(true));

    return () => {
      instructionFlashes.delete(bot.id);
    };
  }, [bot.id]);

  useEffect(() => {
    if (!flashing) return;

    const timer = setTimeout(() => setFlashing(false), FLASH_MS);

    return () => clearTimeout(timer);
  }, [flashing]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[0.8125rem] text-muted-foreground">Instructions</h2>
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
          className={`${CHIP_FIELD_CLASSES} min-h-24 ${flashing ? "ring-2 ring-attention/50" : ""}`}
          pickerClassName={CHIP_PICKER_CLASSES}
        />
      </div>
    </section>
  );
}
