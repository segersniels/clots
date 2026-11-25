import { Character } from "@clots/character";
import type { BotSummary } from "@clots/contracts";
import { BoxIcon } from "lucide-react";

import { splitReferences, type KnownNames, type ReferenceKind } from "../references.ts";

/**
 * Shows a reference to a skill or a bot as a chip, in a message and in the composer alike. The chip
 * takes the color of the text around it, so it reads in every bubble.
 */
export function ReferenceChip({
  kind,
  name,
  bot,
}: {
  kind: ReferenceKind;
  name: string;
  bot?: BotSummary | undefined;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-md bg-current/15 px-1 font-medium">
      {kind === "skill" && <BoxIcon className="size-3.5 shrink-0 translate-y-0.5" aria-hidden />}
      {bot !== undefined && (
        <span className="translate-y-0.5" aria-hidden>
          <Character shape={bot.shape} color={bot.color} mood="idle" size={14} />
        </span>
      )}
      {name}
    </span>
  );
}

/** Shows the text of a message with each reference to a known skill or bot as a chip. */
export function ReferenceText({
  text,
  known,
  bots,
}: {
  text: string;
  known: KnownNames;
  bots: ReadonlyArray<BotSummary>;
}) {
  return splitReferences(text, known).map((part, index) => {
    if (part.reference === null) {
      return part.text;
    }

    const { kind, name } = part.reference;

    return (
      <ReferenceChip
        key={index}
        kind={kind}
        name={name}
        bot={bots.find((bot) => kind === "bot" && bot.name === name)}
      />
    );
  });
}
