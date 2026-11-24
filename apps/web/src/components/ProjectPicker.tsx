import { FolderIcon } from "lucide-react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { client, useStore } from "../client.ts";

/** The select value for a bot without a project. */
const PERSONAL = "personal";

/** Lists the places where a bot can work: Personal, then each project. */
function useProjectOptions() {
  const projects = useStore(client.projects);

  return [{ label: "Personal", value: PERSONAL }, ...projects.map((project) => ({ label: project.name, value: project.id }))];
}

/** Shows the "Works in" row that chooses the project of a bot. The bot works in the directory of that project. */
export function ProjectPicker({
  projectId,
  onChange,
}: {
  projectId: string | null;
  onChange: (projectId: string | null) => void;
}) {
  const projects = useStore(client.projects);
  const options = useProjectOptions();
  const directory = projects.find((project) => project.id === projectId)?.directory;

  return (
    <div className="rounded-xl bg-muted/60 py-1.5 pr-1.5 pl-3">
      <div className="flex items-center justify-between">
        <span>Works in</span>
        <Select
          items={options}
          value={projectId ?? PERSONAL}
          onValueChange={(value) => onChange(value === PERSONAL ? null : (value as string))}
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
  );
}

/** Chooses the project of a bot with a small button, for a dialog footer. It shows only the name, without the path. */
export function ProjectSelect({
  projectId,
  onChange,
  className = "",
}: {
  projectId: string | null;
  onChange: (projectId: string | null) => void;
  className?: string;
}) {
  const options = useProjectOptions();

  return (
    <Select items={options} value={projectId ?? PERSONAL} onValueChange={(value) => onChange(value === PERSONAL ? null : (value as string))}>
      <SelectTrigger
        aria-label="Works in"
        title="Works in"
        className={`justify-center gap-[5px] rounded-[10px] border-transparent bg-muted/45 px-2.5 font-medium data-[size=default]:h-[34px] dark:bg-muted/45 [&_svg]:size-3.5 ${className}`}
      >
        <FolderIcon className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
