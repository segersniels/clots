import type { BotSummary } from "@clots/contracts";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { client, useStore } from "../client.ts";

/** The select value for a bot without a project. */
const PERSONAL = "personal";

/** Lets the operator move a bot to a project. The bot then works in the directory of that project. */
export function ProjectPicker({ bot }: { bot: BotSummary }) {
  const projects = useStore(client.projects);
  const options = [
    { label: "Personal", value: PERSONAL },
    ...projects.map((project) => ({ label: project.name, value: project.id })),
  ];
  const directory = projects.find((project) => project.id === bot.projectId)?.directory;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[0.8125rem] text-muted-foreground">Project</h2>
      <div className="rounded-xl bg-muted/60 py-1.5 pr-1.5 pl-3">
        <div className="flex items-center justify-between">
          <span>Works in</span>
          <Select
            items={options}
            value={bot.projectId ?? PERSONAL}
            onValueChange={(value) => client.setBotProject(bot.id, value === PERSONAL ? null : (value as string))}
          >
            <SelectTrigger size="sm" aria-label="Project" className="border-transparent bg-transparent dark:bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {directory != null && <p className="truncate pb-1 font-mono text-xs text-muted-foreground">{directory}</p>}
      </div>
    </section>
  );
}
