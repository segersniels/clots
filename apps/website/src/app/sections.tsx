import { Character, type CharacterMood } from "@clots/character";
import type { CharacterColor, CharacterShape } from "@clots/character/traits";
import { ChevronDown } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

import intro from "../../../../docs/assets/intro-light.png";

/** Describes the clot that illustrates an item. */
interface Clot {
  shape: CharacterShape;
  color: CharacterColor;
  mood: CharacterMood;
}

/** Lists what a bot gets from Claude Code, the core of the "Grok Bot for Claude Code" message. */
const CLAUDE_CODE_POINTS: { title: string; body: string; clot: Clot }[] = [
  {
    title: "Your Claude subscription",
    clot: { shape: "drop", color: "blue", mood: "idle" },
    body: "Clots uses the Claude Code login you already have. No API keys, no extra bill.",
  },
  {
    title: "Your skills and tools",
    clot: { shape: "bud", color: "pink", mood: "idle" },
    body: "Bots get your skills, plugins, MCP servers and connectors from day one.",
  },
  {
    title: "One thread that never ends",
    clot: { shape: "worm", color: "green", mood: "working" },
    body: "Each bot is a Claude Code session. Clots picks it up again after every restart.",
  },
  {
    title: "Claude only",
    clot: { shape: "lump", color: "orange", mood: "idle" },
    body: "Pick Haiku, Sonnet, Opus or Fable for each bot. Clots stays close to how Claude Code already works.",
  },
];

/** Lists the steps from download to a working bot. */
const STEPS: { title: string; body: string; clot: Clot }[] = [
  {
    title: "Install the app",
    clot: { shape: "drop", color: "gray", mood: "idle" },
    body: "One line on a Mac, or clots up on a server that stays on.",
  },
  {
    title: "Make a bot",
    clot: { shape: "bean", color: "purple", mood: "waiting" },
    body: "Give it a name, a job and a model, or start from a template.",
  },
  {
    title: "Let it work",
    clot: { shape: "tumble", color: "red", mood: "working" },
    body: "Talk to it from the app, a browser or your phone.",
  },
];

/** Lists what a bot can do today. Add an item only when the feature has shipped. */
const ABILITIES: { title: string; body: string; clot: Clot }[] = [
  {
    title: "Its own browser",
    clot: { shape: "bean", color: "blue", mood: "working" },
    body: "Each bot has a browser with its own logins. Watch its screen live, and take over for a login or a captcha.",
  },
  {
    title: "Routines",
    clot: { shape: "dollop", color: "amber", mood: "idle" },
    body: "“Morning briefing, every day at 9:00.” Routines send a prompt on a schedule.",
  },
  {
    title: "Memory and skills",
    clot: { shape: "grape", color: "green", mood: "idle" },
    body: "A bot remembers what it learns and keeps its own skills. You and the bot can both edit them.",
  },
  {
    title: "You stay in control",
    clot: { shape: "stack", color: "purple", mood: "waiting" },
    body: "Bots ask you before they run a tool that is not clearly safe.",
  },
  {
    title: "Teamwork",
    clot: { shape: "twin", color: "teal", mood: "working" },
    body: "Bots message each other, clone themselves to split a task, and share a site login inside a project.",
  },
];

/** Answers the questions people ask search engines and AI answers about clots. */
const FAQ = [
  {
    question: "Is there a Grok Bot for Claude Code?",
    answer:
      "Yes. Clots gives you always-on bots like Grok Bot, built on Claude Code and your Claude subscription. It is free and open source.",
  },
  {
    question: "Does Clots use my Claude subscription?",
    answer:
      "Yes. It works with Pro, Max, Team and Enterprise. Clots starts the Claude Code you installed and never reads your login.",
  },
  {
    question: "Do I need an API key?",
    answer: "No. Clots supports only the Claude subscription login.",
  },
  {
    question: "Does Clots work with other models?",
    answer: "No. Clots runs Claude only, so each bot works the way Claude Code does.",
  },
  {
    question: "Is Clots free?",
    answer:
      "Yes. Clots is open source under the MIT license. There is no hosted service and no account.",
  },
  {
    question: "What does it run on?",
    answer:
      "The app runs on Macs with Apple Silicon. The server runs on Linux and macOS, and you reach it from a browser or your phone over Tailscale.",
  },
  {
    question: "Do my bots stop when my Mac sleeps?",
    answer:
      "Yes, when they run on that Mac. Run the server on a machine that stays on, and they keep working.",
  },
];

/** Tells search engines that the questions below are an FAQ, so AI answers and results can quote them. */
const FAQ_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};

/** Lists the bots in the sidebar card of "Clots is built with Clots", as our own sidebar shows them. */
const TEAM: (Clot & { name: string; preview: string; time: string; selected?: boolean })[] = [
  {
    name: "Designer",
    preview: "The update rows are approved",
    time: "10:52",
    shape: "bud",
    color: "pink",
    mood: "idle",
  },
  {
    name: "Engineer #1",
    preview: "Building the new header pill",
    time: "10:48",
    shape: "tumble",
    color: "red",
    mood: "working",
    selected: true,
  },
  {
    name: "Engineer #2",
    preview: "Proof shots are in shots/",
    time: "10:31",
    shape: "twin",
    color: "teal",
    mood: "idle",
  },
  {
    name: "Engineer #3",
    preview: "Lint, typecheck and build pass",
    time: "10:12",
    shape: "bean",
    color: "blue",
    mood: "working",
  },
  {
    name: "Marketing",
    preview: "Drafted the landing page sections",
    time: "9:40",
    shape: "lump",
    color: "orange",
    mood: "idle",
  },
  {
    name: "Optimizer",
    preview: "Cut the bundle by 38 KB",
    time: "9:05",
    shape: "grape",
    color: "green",
    mood: "idle",
  },
  {
    name: "Bob",
    preview: "Rewrote the Designer template",
    time: "8:20",
    shape: "dollop",
    color: "amber",
    mood: "idle",
  },
];

/** Lists the clots that float above the final call to download, smallest at the edges. */
const FINAL_CAST: (Clot & { size: number; delay: string })[] = [
  { shape: "puddle", color: "orange", mood: "idle", size: 56, delay: "-1s" },
  { shape: "bud", color: "pink", mood: "working", size: 64, delay: "-3s" },
  { shape: "drop", color: "blue", mood: "waiting", size: 88, delay: "-5s" },
  { shape: "grape", color: "green", mood: "idle", size: 64, delay: "-2s" },
  { shape: "stack", color: "purple", mood: "idle", size: 56, delay: "-4s" },
];

/** Styles the heading of a section. The intro and the final section use a bigger one. */
const SECTION_HEADING = "text-[40px] leading-[1.05] font-semibold tracking-[-0.025em] text-balance";

/** Styles the heading of the intro and the final section. */
const BIG_HEADING =
  "text-[clamp(36px,5vw,56px)] leading-[1.02] font-semibold tracking-[-0.03em] text-balance";

/** Styles the text under a centered heading. */
const CENTERED_SUB = "mx-auto mt-5 max-w-[36rem] text-lg text-pretty text-muted-foreground";

/** Styles the text of a card or row. */
const BODY = "mt-1.5 text-base leading-normal text-pretty text-muted-foreground";

/** Styles the title of a card. */
const CARD_TITLE = "text-lg leading-[1.3] font-semibold tracking-[-0.01em]";

/** Renders the sections below the hero that explain what clots is and how it works. */
export function Sections({ download }: { download: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1040px] px-5 pb-32">
      <section className="pt-36 text-center">
        <h2 className={BIG_HEADING}>Grok Bot for Claude Code</h2>
        <p className={CENTERED_SUB}>
          Clots turns Claude Code into a team of bots that keep working while you are away. Each bot
          has its own job, browser and memory. They run on your machine, with your Claude
          subscription.
        </p>
        <img
          src={intro.src}
          width={intro.width}
          height={intro.height}
          alt="The clots app: bots grouped by project in the sidebar, and a bot at work in its thread"
          className="mt-12 w-full rounded-3xl"
        />
      </section>

      <Section title="Everything you set up in Claude Code, always on">
        <div className="grid grid-cols-2 gap-3">
          {CLAUDE_CODE_POINTS.map((point) => (
            <Tile key={point.title} {...point} />
          ))}
        </div>
      </Section>

      <Section title="Up and running in three steps">
        <ol className="grid grid-cols-3 gap-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col rounded-3xl bg-muted/60 p-7">
              {/* The clots grow from 52 to 72 from the first step to the last. */}
              <div className="flex h-[72px] items-end">
                <Character {...step.clot} size={52 + index * 10} />
              </div>
              <span className="mt-6 text-sm text-muted-foreground tabular-nums">{index + 1}</span>
              <h3 className={cn("mt-1", CARD_TITLE)}>{step.title}</h3>
              <p className={BODY}>{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="A bot with a computer of its own">
        <div className="grid grid-cols-6 gap-3">
          {ABILITIES.map((ability, index) => (
            // The first row holds three tiles and the second row two wider ones.
            <Tile
              key={ability.title}
              {...ability}
              className={index < 3 ? "col-span-2" : "col-span-3"}
            />
          ))}
        </div>
      </Section>

      <section className="pt-36 text-center">
        <h2 className={SECTION_HEADING}>Clots is built with Clots</h2>
        <p className={CENTERED_SUB}>
          Our own bots write the code, review it and draft the copy on this page.
        </p>
        <div className="mx-auto mt-12 max-w-[420px] rounded-3xl bg-muted/60 p-2 text-left">
          <div className="flex items-center justify-between px-3 pt-3 pb-1.5 text-[13px] text-muted-foreground">
            clots
            <ChevronDown className="size-3.5" />
          </div>
          {TEAM.map((bot) => (
            <div
              key={bot.name}
              className={cn(
                "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[14px] px-2.5 py-2",
                bot.selected && "bg-muted/80",
              )}
            >
              <Character shape={bot.shape} color={bot.color} mood={bot.mood} size={28} />
              <span>
                <span className="block text-sm font-medium">{bot.name}</span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {bot.preview}
                </span>
              </span>
              <span className="self-start pt-0.5 text-xs text-muted-foreground">{bot.time}</span>
            </div>
          ))}
        </div>
      </section>

      <Section title="Questions, answered">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(FAQ_STRUCTURED_DATA),
          }}
        />
        {/* Closed answers stay in the page, so search engines and find in page still reach them. */}
        <Accordion multiple hiddenUntilFound defaultValue={[FAQ[0]!.question]} className="gap-3">
          {FAQ.map(({ question, answer }) => (
            <AccordionItem
              key={question}
              value={question}
              className="rounded-[18px] bg-muted/60 px-5 not-last:border-b-0 has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-attention"
            >
              <AccordionTrigger className="min-h-[60px] items-center gap-4 border-0 py-0 focus-visible:ring-0 focus-visible:after:content-none text-[17px] font-semibold tracking-[-0.01em] hover:no-underline">
                {question}
              </AccordionTrigger>
              <AccordionContent className="-mt-1.5 pr-9 pb-5 text-base leading-normal text-pretty text-muted-foreground">
                {answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      <section className="pt-40 text-center">
        <div aria-hidden className="mb-8 flex items-end justify-center gap-3">
          {FINAL_CAST.map((clot) => (
            <div
              key={clot.shape}
              className="animate-float motion-reduce:animate-none"
              style={{ animationDelay: clot.delay, "--tilt": "0deg" } as React.CSSProperties}
            >
              <Character shape={clot.shape} color={clot.color} mood={clot.mood} size={clot.size} />
            </div>
          ))}
        </div>
        <h2 className={BIG_HEADING}>Meet your first bot</h2>
        {download}
      </section>
    </div>
  );
}

/** Renders one titled section of the page. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-36">
      <h2 className={SECTION_HEADING}>{title}</h2>
      <div className="mt-10">{children}</div>
    </section>
  );
}

/** Renders a card with a clot, a title and a short text. */
function Tile({
  title,
  body,
  clot,
  className,
}: {
  title: string;
  body: string;
  clot: Clot;
  className?: string;
}) {
  return (
    <div className={cn("rounded-3xl bg-muted/60 p-7", className)}>
      <Character {...clot} size={56} />
      <h3 className={cn("mt-4", CARD_TITLE)}>{title}</h3>
      <p className={BODY}>{body}</p>
    </div>
  );
}
