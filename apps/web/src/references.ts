/** What a reference in a message points at. */
export type ReferenceKind = "skill" | "bot";

/** A reference that the operator is typing: `$ani` or `/ani` for a skill, `@Eng` for a bot. */
export interface ReferenceQuery {
  readonly kind: ReferenceKind;
  /** The index of the `$`, `/` or `@` that opened the reference. */
  readonly start: number;
  readonly query: string;
}

/** A piece of a message: plain text, or a reference to a known skill or bot. */
export interface MessagePart {
  readonly text: string;
  readonly reference: { readonly kind: ReferenceKind; readonly name: string } | null;
}

/** The names that a message can refer to. */
export interface KnownNames {
  readonly skills: ReadonlySet<string>;
  /** Bot names, longest first, so that "Kill Team" wins over "Kill". */
  readonly bots: ReadonlyArray<string>;
}

/** Builds the known names. Bot names go longest first, because a name can contain a shorter one. */
export const knownNames = (skills: Iterable<string>, bots: Iterable<string>): KnownNames => ({
  skills: new Set(skills),
  bots: [...bots].sort((a, b) => b.length - a.length),
});

/**
 * Finds the reference that the caret is in. A second slash makes the word a path, and `$5` is an
 * amount of money, so neither one opens the picker.
 */
export const findReferenceQuery = (text: string, caret: number): ReferenceQuery | null => {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1]!)) {
    start -= 1;
  }

  const match = /^([$/@])([\w:.-]*)$/.exec(text.slice(start, caret));

  if (match === null) {
    return null;
  }

  const [, trigger, query] = match as unknown as [string, string, string];

  if (trigger === "$" && /^\d/.test(query)) {
    return null;
  }

  return { kind: trigger === "@" ? "bot" : "skill", start, query };
};

/** Orders items for a query: names that start with it first, then the other names and descriptions that contain it. */
export const matchItems = <T extends { readonly name: string; readonly description: string }>(
  items: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> => {
  const needle = query.toLowerCase();
  const startsWith: T[] = [];
  const contains: T[] = [];

  for (const item of items) {
    const name = item.name.toLowerCase();
    if (name.startsWith(needle)) {
      startsWith.push(item);
    } else if (name.includes(needle) || item.description.toLowerCase().includes(needle)) {
      contains.push(item);
    }
  }

  return [...startsWith, ...contains];
};

/** Finds a reference to a known skill or bot that starts at `index`. A reference starts a word. */
const referenceAt = (text: string, index: number, known: KnownNames) => {
  if (index > 0 && !/\s/.test(text[index - 1]!)) {
    return null;
  }

  if (text[index] === "/" || text[index] === "$") {
    const name = /^[a-zA-Z0-9](?:[\w:.-]*\w)?/.exec(text.slice(index + 1))?.[0];

    return name !== undefined && known.skills.has(name) ? { kind: "skill" as const, name } : null;
  }

  if (text[index] === "@") {
    const name = known.bots.find(
      (bot) => text.startsWith(bot, index + 1) && !/\w/.test(text[index + 1 + bot.length] ?? ""),
    );

    return name === undefined ? null : { kind: "bot" as const, name };
  }

  return null;
};

/** Splits a message into plain text and references. A `/word`, `$word` or `@word` that names nothing known stays plain text. */
export const splitReferences = (text: string, known: KnownNames): ReadonlyArray<MessagePart> => {
  const parts: MessagePart[] = [];
  let plainFrom = 0;

  for (let index = 0; index < text.length; index += 1) {
    const reference = referenceAt(text, index, known);

    if (reference === null) {
      continue;
    }

    if (index > plainFrom) {
      parts.push({ text: text.slice(plainFrom, index), reference: null });
    }

    const end = index + reference.name.length + 1;
    parts.push({ text: text.slice(index, end), reference });
    plainFrom = end;
    index = end - 1;
  }

  if (plainFrom < text.length) {
    parts.push({ text: text.slice(plainFrom), reference: null });
  }

  return parts;
};
