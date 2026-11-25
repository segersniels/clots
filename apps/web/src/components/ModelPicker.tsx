import { BotModel, type BotSummary } from "@clots/contracts";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { client } from "../client.ts";

/** Lets the operator change the model of a bot, for example a faster one for simple tasks. Every model is a Claude model, so the pill in the pane header names only the model. */
export function ModelSelect({ bot }: { bot: BotSummary }) {
  return (
    <Select
      value={bot.model}
      onValueChange={(model) => client.setBotModel(bot.id, model as BotModel)}
    >
      <SelectTrigger
        aria-label="Model"
        className="justify-center gap-[5px] rounded-[10px] border-transparent bg-secondary px-2.5 font-medium text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] data-popup-open:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] data-[size=default]:h-[30px] dark:bg-secondary dark:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:data-popup-open:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] [&_svg]:size-3.5"
      >
        <SelectValue className="capitalize" />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectGroup>
          {BotModel.literals.map((model) => (
            <SelectItem key={model} value={model} className="capitalize">
              {model}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
