import { BotModel, type BotSummary } from "@clots/contracts";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { client } from "../client.ts";

/** Lets the operator change the model of a bot, for example a faster one for simple tasks. */
export function ModelPicker({ bot }: { bot: BotSummary }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[0.8125rem] text-muted-foreground">Model</h2>
      <div className="flex items-center justify-between rounded-xl bg-muted/60 py-1.5 pr-1.5 pl-3">
        <span>Claude</span>
        <Select value={bot.model} onValueChange={(model) => client.setBotModel(bot.id, model as BotModel)}>
          <SelectTrigger size="sm" aria-label="Model" className="border-transparent bg-transparent dark:bg-transparent">
            <SelectValue className="capitalize" />
          </SelectTrigger>
          <SelectContent align="end">
            {BotModel.literals.map((model) => (
              <SelectItem key={model} value={model} className="capitalize">
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
