import { Character } from "@clots/character";
import type { BotId } from "@clots/contracts";
import {
  mergeAttributes,
  Node,
  resolveExtensions,
  type Editor,
  type JSONContent,
} from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { BoxIcon } from "lucide-react";
import { useImperativeHandle, useState, type Ref } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";

import { client, useStore } from "../client.ts";
import {
  findReferenceQuery,
  knownNames,
  matchItems,
  splitReferences,
  type KnownNames,
  type ReferenceKind,
} from "../references.ts";
import { ReferencePicker, type PickerItem } from "./ReferencePicker.tsx";
import { ReferenceChip } from "./ReferenceText.tsx";

/** The most items that the picker lists at once. The operator narrows the list by typing. */
const MAX_LISTED_ITEMS = 50;

/** The character that stands for a chip when the field reads the text before the caret. */
const CHIP_CHARACTER = "￼";

/** The character that holds the place of a chip while the field parses markdown, so the parser never reads a chip's text. */
const CHIP_PLACEHOLDER = "\uE000";

/** What the composer can ask of the field. */
export interface ComposerFieldHandle {
  clear(): void;
  /** Puts text back in the field, for example after a failed send. Known references become chips. */
  setText(text: string): void;
  /** Puts the caret at the end of the text. */
  focus(): void;
}

/** The attributes of a reference chip. */
interface ReferenceAttributes {
  readonly kind: ReferenceKind;
  readonly name: string;
}

/** Writes a reference the way Claude reads it: `/name` for a skill, `@Name` for a bot. */
const referenceText = ({ kind, name }: ReferenceAttributes) =>
  `${kind === "skill" ? "/" : "@"}${name}`;

/** Draws a reference in the field as the same chip that a sent message shows. */
function ReferenceNodeView({ node }: NodeViewProps) {
  const { kind, name } = node.attrs as { kind: ReferenceKind; name: string };
  const bot = useStore(client.bots).find((candidate) => kind === "bot" && candidate.name === name);

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <ReferenceChip kind={kind} name={name} bot={bot} />
    </NodeViewWrapper>
  );
}

/**
 * A reference to a skill or a bot in the field. It is one unit: the caret steps over it and
 * Backspace removes it whole. As text it becomes `/name` or `@Name`, which is what Claude reads.
 */
const ReferenceNode = Node.create({
  name: "reference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: "skill" }, name: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-reference]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-reference": "" }, HTMLAttributes)];
  },
  renderText({ node }) {
    return referenceText(node.attrs as ReferenceAttributes);
  },
  renderMarkdown: (node) => referenceText(node.attrs as ReferenceAttributes),
  addNodeView() {
    return ReactNodeViewRenderer(ReferenceNodeView);
  },
});

/**
 * The formats that the field writes as markdown. Typing their markdown, such as `**`, a backtick or
 * `1. ` or `> `, formats the text at once. Headings stay on, because the editor drops the whole
 * text when the parser makes a node that it lacks, such as a `##` heading in the instructions of a
 * template. Links stay off: they would turn a bare URL into `[url](url)`.
 */
const FORMATS = StarterKit.configure({
  dropcursor: false,
  gapcursor: false,
  link: false,
  trailingNode: false,
  underline: false,
});

/** Reads markdown into field content, before the editor exists, such as for a saved draft. */
const markdown = new MarkdownManager({ extensions: resolveExtensions([FORMATS, ReferenceNode]) });

/** The private method of the markdown package that escapes plain text. */
type TextEncoder = (text: string, node: JSONContent, parent: JSONContent | null) => string;

/**
 * Makes the field write plain text as typed, so that the bot gets `foo_bar` and not `foo\_bar`.
 * The package escapes every markdown character, so that a draft reads back unchanged. Text that
 * markdown would read as formatting, such as `2*3*4`, keeps those escapes.
 */
const keepPlainText = (manager: MarkdownManager) => {
  const escaping = manager as unknown as { encodeTextForMarkdown?: TextEncoder };
  const escape = escaping.encodeTextForMarkdown?.bind(manager);

  // A later version of the package can rename the method. Then the text keeps its escapes, which is safe.
  if (escape === undefined) {
    return;
  }

  escaping.encodeTextForMarkdown = (text, node, parent) => {
    const escaped = escape(text, node, parent);
    if (escaped === text) {
      return text;
    }

    const [block] = manager.parse(text).content ?? [];
    const [only, ...rest] = block?.content ?? [];
    const readsAsText =
      block?.type === "paragraph" &&
      rest.length === 0 &&
      only?.type === "text" &&
      only.text === text &&
      only.marks === undefined;

    return readsAsText ? text : escaped;
  };
};

/**
 * Builds the field's content from markdown, such as a saved draft, with a chip for each known
 * reference. The chips leave the text before the parse, because a name or a path can hold
 * characters that markdown reads as formatting.
 */
const toContent = (text: string, known: KnownNames): JSONContent => {
  const parts = splitReferences(text, known);
  const chips = parts.flatMap(({ text, reference }) =>
    reference === null ? [] : [{ text, reference }],
  );
  const parsed = markdown.parse(
    parts.map((part) => (part.reference === null ? part.text : CHIP_PLACEHOLDER)).join(""),
  );
  let next = 0;

  /** Puts the chips back in place of their placeholders. Code takes text only, so a chip there stays its text. */
  const restore = (node: JSONContent, inCode: boolean): JSONContent[] => {
    if (node.type !== "text") {
      const code = inCode || node.type === "codeBlock";

      return [
        {
          ...node,
          ...(node.content === undefined
            ? {}
            : { content: node.content.flatMap((child) => restore(child, code)) }),
        },
      ];
    }

    const pieces = (node.text ?? "").split(CHIP_PLACEHOLDER);
    const keepText = inCode || node.marks?.some((mark) => mark.type === "code") === true;

    return pieces.flatMap((piece, index) => {
      const textNode = piece === "" ? [] : [{ ...node, text: piece }];
      if (index === pieces.length - 1) {
        return textNode;
      }

      const chip = chips[next++]!;
      const restored: JSONContent = keepText
        ? { ...node, text: chip.text }
        : { type: "reference", attrs: chip.reference };

      return [...textNode, restored];
    });
  };

  return restore(parsed, false)[0]!;
};

/** Finds the reference that the operator types at the caret, with its range in the document. */
const queryAt = (editor: Editor) => {
  const { $from, empty } = editor.state.selection;

  if (!empty) {
    return null;
  }

  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, CHIP_CHARACTER);
  const query = findReferenceQuery(before, before.length);

  if (query === null) {
    return null;
  }

  return { ...query, from: $from.start() + query.start, to: $from.pos };
};

/**
 * A text field that shows each skill or bot reference as a chip, and opens a picker when the
 * operator types `$` or `/` for a skill, or `@` for a bot. The composer sends on Enter and takes
 * files. A form field, such as the instructions, leaves those out: Enter makes a new line there.
 * The picker opens above the nearest positioned ancestor.
 */
export function ComposerField({
  botId,
  placeholder,
  label = placeholder,
  initialText,
  onTextChange,
  onEnter,
  onSubmit,
  onFiles,
  onBlur,
  onEscape,
  autoFocus = true,
  className = "max-h-40 min-h-8 min-w-0 flex-1 overflow-y-auto",
  pickerClassName,
  ref,
}: {
  botId: BotId;
  placeholder: string;
  label?: string;
  initialText: string;
  onTextChange: (text: string) => void;
  onEnter?: () => void;
  /** Runs on ⌘Enter or Ctrl+Enter, in a form field where Enter alone makes a new line. */
  onSubmit?: () => void;
  onFiles?: (files: FileList) => void;
  onBlur?: () => void;
  /** Runs on Escape when the picker is closed. The editor uses Escape itself otherwise. */
  onEscape?: () => void;
  autoFocus?: boolean;
  className?: string;
  pickerClassName?: string;
  ref?: Ref<ComposerFieldHandle>;
}) {
  const skills = useStore(client.skills(botId));
  const bots = useStore(client.bots);
  const projectId = bots.find((bot) => bot.id === botId)?.projectId ?? null;
  // A bot mentions only the other bots of its own project, so a bot with the same name in another project stays out.
  const otherBots = bots.filter((bot) => bot.id !== botId && bot.projectId === projectId);
  const known = knownNames(
    skills.map((skill) => skill.name),
    otherBots.map((bot) => bot.name),
  );

  const [query, setQuery] = useState<ReturnType<typeof queryAt>>(null);
  const [activeItem, setActiveItem] = useState(0);
  // Escape closes the picker for the reference that is open, not for the next one.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pickerOpen = query !== null && query.from !== dismissedAt;

  const skillItems = skills.map((skill) => ({
    ...skill,
    icon: <BoxIcon className="text-skill" />,
  }));
  const botItems = otherBots.map((bot) => ({
    name: bot.name,
    description: bot.statusLine,
    icon: <Character shape={bot.shape} color={bot.color} mood="idle" size={16} />,
  }));
  const pickerSource: ReadonlyArray<PickerItem> = query?.kind === "bot" ? botItems : skillItems;
  const matchingItems = pickerOpen
    ? matchItems(pickerSource, query.query).slice(0, MAX_LISTED_ITEMS)
    : [];

  // The editor takes the handlers and attributes of each render, but keeps its first extensions.
  const editor = useEditor({
    extensions: [
      FORMATS,
      Markdown,
      // The placeholder can change, so it reads the current one from the attributes.
      Placeholder.configure({
        placeholder: ({ editor: current }) => {
          const { attributes } = current.options.editorProps;

          return typeof attributes === "object" ? (attributes["data-placeholder"] ?? "") : "";
        },
      }),
      ReferenceNode,
    ],
    content: toContent(initialText, known),
    // Opening a bot is to talk to it. A touch screen would open its keyboard over the thread, so it waits for a tap there.
    autofocus: !autoFocus || matchMedia("(pointer: coarse)").matches ? false : "end",
    editorProps: {
      attributes: {
        "aria-label": label,
        "aria-multiline": "true",
        "data-placeholder": placeholder,
        role: "textbox",
        class:
          "px-2.5 py-1.5 text-sm wrap-break-word whitespace-pre-wrap outline-none [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_li_p]:my-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:my-1 [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_hr]:my-2 [&_hr]:border-border [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
      },
      handleKeyDown: (_view, event) => handleKey(event),
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;

        if (onFiles === undefined || files === undefined || files.length === 0) {
          return false;
        }

        onFiles(files);

        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;

        if (onFiles === undefined || files === undefined || files.length === 0) {
          return false;
        }

        event.preventDefault();
        onFiles(files);

        return true;
      },
    },
    onCreate: ({ editor: created }) => {
      if (created.markdown !== undefined) {
        keepPlainText(created.markdown);
      }
    },
    onUpdate: ({ editor: updated }) => {
      onTextChange(updated.getMarkdown());
      setQuery(queryAt(updated));
      setActiveItem(0);
    },
    onSelectionUpdate: ({ editor: updated }) => setQuery(queryAt(updated)),
    onBlur: () => onBlur?.(),
  });

  // Skills load after the field opens, so a known reference in the first text becomes a chip once they are there.
  const knownKey = [...skills.map((skill) => skill.name), ...otherBots.map((bot) => bot.name)].join(
    "\n",
  );

  useImperativeHandle(ref, () => ({
    clear: () => editor?.commands.clearContent(true),
    setText: (text) => editor?.commands.setContent(toContent(text, known), { emitUpdate: true }),
    focus: () => editor?.commands.focus("end"),
  }));

  /** Puts the picked reference as a chip in place of what the operator typed, with a space after it. */
  const insertReference = (item: PickerItem) => {
    if (editor === null || query === null) {
      return;
    }

    editor
      .chain()
      .focus()
      .insertContentAt({ from: query.from, to: query.to }, [
        { type: "reference", attrs: { kind: query.kind, name: item.name } },
        { type: "text", text: " " },
      ])
      .run();
  };

  /** Handles the keys of the picker, and Enter to send. Returns `true` for a key that it used. */
  const handleKey = (event: KeyboardEvent): boolean => {
    if (pickerOpen && matchingItems.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveItem((index) => (index + step + matchingItems.length) % matchingItems.length);

        return true;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        insertReference(matchingItems[activeItem] ?? matchingItems[0]!);

        return true;
      }
    }

    // Escape closes only the picker, not a dialog around the field.
    if (pickerOpen && event.key === "Escape") {
      event.stopPropagation();
      setDismissedAt(query.from);

      return true;
    }

    if (onEscape !== undefined && event.key === "Escape") {
      onEscape();

      return true;
    }

    if (event.key !== "Enter" || editor === null) {
      return false;
    }

    if (onSubmit !== undefined && (event.metaKey || event.ctrlKey)) {
      onSubmit();

      return true;
    }

    // In code, Enter makes a new line. Three Enters leave the code block, as the editor does on its own.
    if (editor.isActive("codeBlock")) {
      return event.shiftKey ? editor.commands.newlineInCode() : false;
    }

    // Shift+Enter in a list starts the next item, or leaves the list from an empty one.
    if (event.shiftKey && editor.isActive("listItem")) {
      return editor.commands.splitListItem("listItem") || editor.commands.liftListItem("listItem");
    }

    // Shift+Enter on an empty line of a quote leaves the quote. On a line with text it continues the quote.
    if (
      event.shiftKey &&
      editor.isActive("blockquote") &&
      editor.state.selection.$from.parent.content.size === 0
    ) {
      return editor.commands.lift("blockquote");
    }

    // Elsewhere it starts a new line as its own block, so that `1. ` or `- ` there can start a list.
    if (event.shiftKey) {
      return editor.commands.splitBlock();
    }

    // Enter alone sends, in a field that sends.
    if (onEnter === undefined) {
      return false;
    }

    onEnter();

    return true;
  };

  return (
    <>
      <ReferencePicker
        open={pickerOpen}
        label={query?.kind === "bot" ? "Bots" : "Skills"}
        items={matchingItems}
        activeIndex={activeItem}
        emptyText={emptyPickerText(query?.kind ?? "skill", skills.length === 0)}
        onPick={insertReference}
        onHover={setActiveItem}
        className={pickerClassName}
      />
      <EditorContent editor={editor} className={className} />
      {editor !== null && <KnownReferences key={knownKey} editor={editor} known={known} />}
    </>
  );
}

/** Turns the known references in the text into chips. The field keys it by the known names, so it runs again when they change. */
function KnownReferences({ editor, known }: { editor: Editor; known: KnownNames }) {
  useMountEffect(() => {
    // The field is focused when it opens. A caret inside the text means the operator edits it, so the text stays as it is.
    const atEnd = editor.state.selection.to === editor.state.doc.content.size - 1;
    if (editor.isFocused && !atEnd) {
      return;
    }

    editor.commands.setContent(toContent(editor.getMarkdown(), known), { emitUpdate: false });
    if (editor.isFocused) {
      editor.commands.focus("end");
    }
  });

  return null;
}

/** Builds the text that the picker shows when nothing matches. A new bot lists its skills a moment after it opens. */
const emptyPickerText = (kind: ReferenceKind, noSkillsYet: boolean) => {
  if (kind === "bot") {
    return "No bot matches.";
  }

  return noSkillsYet ? "Loading the skills…" : "No skill matches.";
};
