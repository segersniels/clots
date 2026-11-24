import { BotModel, type BotSummary } from "@clots/contracts";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { client } from "../client.ts";

/** Lets the operator change the model of a bot, for example a faster one for simple tasks. */
export function ModelPicker({ bot }: { bot: BotSummary }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[0.8125rem] text-muted-foreground">Model</h2>
      {/* Every model is a Claude model, so the row names only the model. The whole row opens the list. */}
      <Select value={bot.model} onValueChange={(model) => client.setBotModel(bot.id, model as BotModel)}>
        <SelectTrigger
          aria-label="Model"
          className="h-auto w-full rounded-xl border-transparent bg-muted/60 py-2.5 pr-3 pl-3 text-base dark:bg-muted/60"
        >
          <SelectValue className="capitalize" />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            {BotModel.literals.map((model) => (
              <SelectItem key={model} value={model} className="capitalize">
                {model}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </section>
  );
}
