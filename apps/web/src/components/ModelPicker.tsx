import { BotModel, type BotSummary } from "@clots/contracts";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { client } from "../client.ts";

/** Lets the operator change the model of a bot, for example a faster one for simple tasks. */
export function ModelPicker({ bot }: { bot: BotSummary }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm text-muted-foreground">Model</h2>
      <ToggleGroup
        value={[bot.model]}
        // A click on the active model sends an empty list. A bot always has a model, so that click does nothing.
        onValueChange={([model]) => model !== undefined && client.setBotModel(bot.id, model as BotModel)}
        variant="outline"
        spacing={0}
        className="w-full"
        aria-label="Model"
      >
        {BotModel.literals.map((model) => (
          <ToggleGroupItem key={model} value={model} className="flex-1 capitalize">
            {model}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </section>
  );
}
