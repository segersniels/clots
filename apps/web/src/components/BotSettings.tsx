import { Character } from "@clots/character";
import type { BotSummary } from "@clots/contracts";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { client } from "../client.ts";
import { CharacterPicker } from "./CharacterPicker.tsx";
import { ComposerField } from "./ComposerField.tsx";

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

/** Lets the operator edit the instructions of a bot. The bot reads them when its next session starts. */
export function BotInstructions({ bot }: { bot: BotSummary }) {
  const [instructions, setInstructions] = useState(bot.instructions);

  const saveInstructions = () => {
    if (instructions.trim() !== bot.instructions) void client.updateBot(bot.id, { instructions: instructions.trim() });
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[0.8125rem] text-muted-foreground">Instructions</h2>
      <div className="relative">
        <ComposerField
          botId={bot.id}
          label="Instructions"
          placeholder="What this bot does and how it behaves"
          initialText={bot.instructions}
          onTextChange={setInstructions}
          onBlur={saveInstructions}
          autoFocus={false}
          className={`${CHIP_FIELD_CLASSES} min-h-24`}
          pickerClassName={CHIP_PICKER_CLASSES}
        />
      </div>
    </section>
  );
}
