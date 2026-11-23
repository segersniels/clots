import { BotColor, BotShape } from "@clots/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { client } from "../client.ts";
import { Avatar, COLOR_HEX } from "../components/Avatar.tsx";
import { BotList } from "../components/BotList.tsx";

export const Route = createFileRoute("/")({ component: NewBot });

function NewBot() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [color, setColor] = useState<BotColor>("blue");
  const [shape, setShape] = useState<BotShape>("circle");
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
        <Avatar name={name} color={color} shape={shape} size={24} />
        <h1 className="font-semibold">{name.trim() || "New Bot"}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <form onSubmit={create} className="mx-auto flex max-w-sm flex-col px-4 pb-10 pt-[9vh]">
          <div className="flex justify-center pb-6">
            <Avatar name={name} color={color} shape={shape} size={96} />
          </div>

          <div className="flex justify-between" role="radiogroup" aria-label="Color">
            {BotColor.literals.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === color}
                aria-label={option}
                onClick={() => setColor(option)}
                className="size-7 rounded-full outline-2 outline-offset-2"
                style={{ background: COLOR_HEX[option], outlineStyle: option === color ? "solid" : "none", outlineColor: COLOR_HEX[option] }}
              />
            ))}
          </div>

          <div className="flex justify-between pt-5" role="radiogroup" aria-label="Shape">
            {BotShape.literals.map((option) => (
              <Button
                key={option}
                type="button"
                variant={option === shape ? "outline" : "ghost"}
                size="icon-lg"
                role="radio"
                aria-checked={option === shape}
                aria-label={option}
                onClick={() => setShape(option)}
              >
                <Avatar name="" color={color} shape={option} className="size-7" />
              </Button>
            ))}
          </div>

          <FieldGroup className="pt-7">
            <Field>
              <FieldLabel htmlFor="bot-name">Name</FieldLabel>
              <Input
                id="bot-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                placeholder="New Bot"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="bot-instructions">Instructions</FieldLabel>
              <Textarea
                id="bot-instructions"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={4}
                placeholder="What this bot does and how it behaves"
                className="resize-none"
              />
            </Field>
          </FieldGroup>

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
