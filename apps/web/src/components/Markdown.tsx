import type { BotSummary } from "@clots/contracts";
import type { ComponentProps } from "react";
import { Streamdown, useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

import { splitReferences, type KnownNames } from "../references.ts";
import { ReferenceChip } from "./ReferenceText.tsx";

/** Marks inline code that stands for a chip. The parser never reads a chip's own text, which can hold markdown characters. */
const CHIP_MARK = "\uE000";

/** Matches fenced and inline code, where a reference stays plain text. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/** The known skills and bots, so that the references in a message show as chips. */
interface References {
  readonly known: KnownNames;
  readonly bots: ReadonlyArray<BotSummary>;
}

function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  // The closing fence has not arrived yet, so a copy would give half of the code.
  const incomplete = useIsCodeFenceIncomplete();
  const lines = useHighlightedCode(code, language);

  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function MarkdownCode({ node: _node, className, children, ...props }: ComponentProps<"code"> & ExtraProps) {
  // Streamdown marks fenced code with `data-block`. Everything else is inline code.
  if (!("data-block" in props)) {
    return (
      <code className="rounded-sm bg-background/60 px-1 py-0.5 font-mono text-[0.9em]" {...props}>
        {children}
      </code>
    );
  }

  return (
    <MarkdownCodeBlock
      code={typeof children === "string" ? children : ""}
      language={/language-(\S+)/.exec(className ?? "")?.[1] ?? ""}
    />
  );
}

const components = { code: MarkdownCode };

/**
 * Prepares what the operator wrote for the markdown parser. Each line break stays a line break, as
 * typed, and each reference outside code becomes inline code that names its chip.
 */
const prepareTyped = (text: string, known: KnownNames) => {
  const chips: Array<{ kind: "skill" | "bot"; name: string }> = [];
  const outsideCode = (part: string) =>
    splitReferences(part, known)
      .map(({ text: piece, reference }) => {
        if (reference === null) return piece.replaceAll(/(?<!\n)\n(?!\n)/g, "  \n");

        chips.push(reference);

        return `\`${CHIP_MARK}${chips.length - 1}\``;
      })
      .join("");

  let prepared = "";
  let from = 0;

  for (const match of text.matchAll(CODE)) {
    prepared += outsideCode(text.slice(from, match.index)) + match[0];
    from = match.index + match[0].length;
  }

  return { markdown: prepared + outsideCode(text.slice(from)), chips };
};

/** Renders a finished bot reply as markdown. With references, it renders what the operator wrote, with its chips. */
export function Markdown({ children, references }: { children: string; references?: References }) {
  if (references === undefined) {
    return (
      <Streamdown controls={false} components={components}>
        {children}
      </Streamdown>
    );
  }

  const { markdown, chips } = prepareTyped(children, references.known);

  /** Draws the inline code that names a chip as that chip. All other code renders as code. */
  const ChipOrCode = (props: ComponentProps<"code"> & ExtraProps) => {
    const chip = typeof props.children === "string" && props.children.startsWith(CHIP_MARK) ? chips[Number(props.children.slice(1))] : undefined;
    if (chip === undefined) return <MarkdownCode {...props} />;

    const bot = references.bots.find((candidate) => chip.kind === "bot" && candidate.name === chip.name);

    return <ReferenceChip kind={chip.kind} name={chip.name} bot={bot} />;
  };

  return (
    <Streamdown controls={false} components={{ code: ChipOrCode }}>
      {markdown}
    </Streamdown>
  );
}
