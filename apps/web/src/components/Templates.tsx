import { Character } from "@clots/character";
import type { BotSkill } from "@clots/contracts";
import { BoxIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import type { BotTemplate } from "../templates.ts";
import { Collapse } from "./Collapse.tsx";
import { ROW } from "./SearchDialog.tsx";

/** How long the page waits before its character hops, so the hop starts once the page has slid in. */
const HOP_DELAY_MS = 120;

/** Renders template text as the details pane would: `## ` lines as headings, `- ` lines as a list, other lines as paragraphs. */
function TemplateText({ text }: { text: string }) {
  const blocks: Array<ReactNode> = [];
  let items: Array<string> = [];

  const endList = () => {
    if (items.length === 0) return;

    blocks.push(
      <ul key={blocks.length} className="grid list-disc gap-[3px] pl-[18px] marker:text-muted-foreground">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    );
    items = [];
  };

  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) {
      items.push(line.slice(2));

      continue;
    }

    endList();

    if (line.startsWith("## ")) blocks.push(<h3 key={blocks.length} className="mt-2 -mb-0.5 font-semibold first:mt-0">{line.slice(3)}</h3>);
    else if (line.trim() !== "") blocks.push(<p key={blocks.length}>{line}</p>);
  }

  endList();

  return <div className="grid gap-1.5 text-left text-[13px] leading-[1.55]">{blocks}</div>;
}

/**
 * Lists the templates, one row each. The pointer and the arrow keys move one highlight, and Enter
 * or a click opens the template's page.
 */
export function TemplateList({ templates, active, onOpen }: { templates: ReadonlyArray<BotTemplate>; active: boolean; onOpen: (template: BotTemplate) => void }) {
  const [highlighted, setHighlighted] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) list.current?.focus({ preventScroll: true });
  }, [active]);

  const moveHighlight = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(templates[highlighted]!);

      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    const next = (highlighted + (event.key === "ArrowDown" ? 1 : -1) + templates.length) % templates.length;
    setHighlighted(next);
    list.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="flex h-full flex-col">
      <p className="mt-1 mb-2.5 text-[13px] text-muted-foreground">Start from a ready-made bot. You can change everything later.</p>
      <div
        ref={list}
        role="listbox"
        aria-label="Templates"
        tabIndex={0}
        aria-activedescendant={`template-${templates[highlighted]?.id}`}
        onKeyDown={moveHighlight}
        className="-mx-2.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 outline-none [scrollbar-width:none]"
      >
        {templates.map((template, index) => (
          <div
            key={template.id}
            id={`template-${template.id}`}
            role="option"
            aria-selected={index === highlighted}
            data-highlighted={index === highlighted || undefined}
            onMouseMove={() => setHighlighted(index)}
            onClick={() => onOpen(template)}
            className={`${ROW} shrink-0`}
          >
            <Character shape={template.shape} color={template.color} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block leading-[1.3] font-medium">{template.name}</span>
              <span className="line-clamp-2 text-[13px] leading-[1.35] text-muted-foreground">{template.description}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One skill: its name and when the bot loads it. A click unfolds its text. */
function SkillRow({ skill }: { skill: BotSkill }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl bg-muted/45">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2.5 rounded-xl py-2.5 pr-3 pl-3.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
      >
        <BoxIcon className="mt-0.5 size-4 shrink-0 text-skill" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] leading-[1.35] font-medium">{skill.name}</span>
          <span className="block text-[12.5px] leading-[1.4] text-muted-foreground">{skill.description}</span>
        </span>
        <ChevronDownIcon className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`} />
      </button>
      <Collapse open={open}>
        <div className="pr-3.5 pb-3 pl-10">
          <TemplateText text={skill.body} />
        </div>
      </Collapse>
    </div>
  );
}

/**
 * Shows what a template makes: its character, which hops once, its description, its instructions
 * and its skills. The body scrolls under the floating header, and the footer stays.
 */
export function TemplatePage({
  template,
  active,
  onBack,
  onUse,
}: {
  template: BotTemplate;
  active: boolean;
  onBack: () => void;
  onUse: () => void;
}) {
  const [hops, setHops] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const use = useRef<HTMLButtonElement>(null);

  // Each open starts at the top with a hop, and Enter uses the template.
  useEffect(() => {
    if (!active) return;

    body.current?.scrollTo({ top: 0 });
    use.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => setHops((count) => count + 1), HOP_DELAY_MS);

    return () => clearTimeout(timer);
  }, [active, template]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={body}
        className="min-h-0 flex-1 overflow-y-auto px-6 pt-11 pb-4 [mask-image:linear-gradient(transparent_36px,#000_60px,#000_calc(100%-24px),transparent)] [scrollbar-width:none]"
      >
        <div className="text-center">
          <div className="flex h-[104px] items-end justify-center">
            <Character shape={template.shape} color={template.color} size={96} hops={hops} />
          </div>
          <p className="mt-3.5 mb-0.5 text-[22px] font-semibold tracking-[-0.015em]">{template.name}</p>
          <p className="mx-auto max-w-[330px] text-[13.5px] leading-[1.45] text-muted-foreground">{template.description}</p>
        </div>

        <p className="mt-[22px] mb-[7px] px-1 text-[13px] text-muted-foreground">Instructions</p>
        <div className="rounded-xl bg-muted/45 px-3.5 py-3">
          <TemplateText text={template.instructions} />
        </div>

        {template.skills.length > 0 && (
          <>
            <p className="mt-[22px] mb-[7px] px-1 text-[13px] text-muted-foreground">Skills</p>
            <div className="grid gap-1">
              {template.skills.map((skill) => (
                <SkillRow key={`${template.id}-${skill.name}`} skill={skill} />
              ))}
            </div>
            <p className="mt-1.5 px-1 text-[12px] text-muted-foreground">Only this bot gets them. A skill loads when a task matches it, and you can edit them in the bot's details.</p>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 px-6 pt-3 pb-5">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button ref={use} type="button" onClick={onUse}>
          Use template
        </Button>
      </div>
    </div>
  );
}
