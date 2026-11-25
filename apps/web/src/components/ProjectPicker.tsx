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
