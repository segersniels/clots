import { Character, type Gaze } from "@clots/character";
import type { BotColor, BotShape } from "@clots/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { client } from "../client.ts";
import { BotList } from "../components/BotList.tsx";
import { CharacterPicker } from "../components/CharacterPicker.tsx";

/** The characters from the middle of the name field to its edge, where the eyes of the preview look furthest aside. */
const NAME_HALF_WIDTH = 14;

/** Makes the preview look down at the caret, so it reads along while the operator types its name. */
function gazeAtCaret(event: SyntheticEvent<HTMLInputElement>): Gaze {
  const field = event.currentTarget;

  // The field centers its text, so the caret moves out from the middle.
  const offset = (field.selectionStart ?? 0) - field.value.length / 2;

  return { x: Math.max(-1, Math.min(1, offset / NAME_HALF_WIDTH)) * 0.9, y: 1 };
}

export const Route = createFileRoute("/")({ component: NewBot });

function NewBot() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [color, setColor] = useState<BotColor>("blue");
  const [shape, setShape] = useState<BotShape>("bean");
  const [gaze, setGaze] = useState<Gaze>();
  const [creating, setCreating] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);

    const bot = await client.createBot({ name: name.trim(), instructions: instructions.trim(), color, shape });
    await navigate({ to: "/bots/$botId", params: { botId: bot.id } });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="window-drag flex h-14 shrink-0 items-center gap-2.5 border-b px-5">
        <Character shape={shape} color={color} size={24} />
        <h1 className="font-semibold">{name.trim() || "New Bot"}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <form onSubmit={create} className="mx-auto flex max-w-sm flex-col px-4 pb-10 pt-[9vh]">
          <div className="flex justify-center pb-6">
            <Character shape={shape} color={color} size={112} gaze={gaze} />
          </div>

          <Input
            id="bot-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => setGaze(gazeAtCaret(event))}
            onSelect={(event) => setGaze(gazeAtCaret(event))}
            onBlur={() => setGaze(undefined)}
            required
            autoFocus
            aria-label="Name"
            placeholder="Name your bot"
            className="h-11 rounded-xl text-center text-base md:text-base"
          />

          <div className="pt-6">
            <CharacterPicker color={color} shape={shape} onColorChange={setColor} onShapeChange={setShape} />
          </div>

          <Textarea
            id="bot-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            onFocus={() => setGaze({ x: 0, y: 1 })}
            onBlur={() => setGaze(undefined)}
            rows={4}
            aria-label="Instructions"
            placeholder="What this bot does and how it behaves"
            className="mt-6 resize-none rounded-xl"
          />

          <Button type="submit" size="lg" disabled={creating || name.trim() === ""} className="mt-7 self-center px-5">
            Get started
          </Button>
        </form>

        {/* A phone has no sidebar, so the bot list shows under the form. */}
        <div className="border-t md:hidden">
          <BotList />
        </div>
      </div>
    </div>
  );
}
