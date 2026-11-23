import { BotModel, type BotSummary } from "@clots/contracts";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { client } from "../client.ts";

/** Lets the operator change the model of a bot, for example a faster one for simple tasks. */
export function ModelPicker({ bot }: { bot: BotSummary }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm text-muted-foreground">Model</h2>
      <Select value={bot.model} onValueChange={(model) => client.setBotModel(bot.id, model as BotModel)}>
        <SelectTrigger className="w-full" aria-label="Model">
          <SelectValue className="capitalize" />
        </SelectTrigger>
        <SelectContent>
          {BotModel.literals.map((model) => (
            <SelectItem key={model} value={model} className="capitalize">
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
