import { Character } from "@clots/character";
import type { BotId } from "@clots/contracts";
import { mergeAttributes, Node, type Editor, type JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { BoxIcon } from "lucide-react";
import { useImperativeHandle, useRef, useState, type Ref } from "react";

import { client, useStore } from "../client.ts";
import { findReferenceQuery, knownNames, matchItems, splitReferences, type KnownNames, type ReferenceKind } from "../references.ts";
import { ReferencePicker, type PickerItem } from "./ReferencePicker.tsx";
import { ReferenceChip } from "./ReferenceText.tsx";

/** The most items that the picker lists at once. The operator narrows the list by typing. */
const MAX_LISTED_ITEMS = 50;

/** The character that stands for a chip when the field reads the text before the caret. */
const CHIP_CHARACTER = "￼";

/** What the composer can ask of the field. */
export interface ComposerFieldHandle {
  clear(): void;
  /** Puts text back in the field, for example after a failed send. Known references become chips. */
  setText(text: string): void;
}

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
    return `${node.attrs.kind === "skill" ? "/" : "@"}${node.attrs.name}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ReferenceNodeView);
  },
});

/** Builds the field's content from plain text, such as a saved draft, with a chip for each known reference. */
const toContent = (text: string, known: KnownNames): JSONContent => ({
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: splitReferences(line, known).map((part) =>
      part.reference === null ? { type: "text", text: part.text } : { type: "reference", attrs: part.reference },
    ),
  })),
});

/** Finds the reference that the operator types at the caret, with its range in the document. */
const queryAt = (editor: Editor) => {
  const { $from, empty } = editor.state.selection;

  if (!empty) return null;

  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, CHIP_CHARACTER);
  const query = findReferenceQuery(before, before.length);

  if (query === null) return null;

  return { ...query, from: $from.start() + query.start, to: $from.pos };
};

/**
 * The text field of the composer. It shows each skill or bot reference as a chip, and opens a
 * picker when the operator types `$` or `/` for a skill, or `@` for a bot.
 */
export function ComposerField({
  botId,
  placeholder,
  initialText,
  onTextChange,
  onEnter,
  onFiles,
  ref,
}: {
  botId: BotId;
  placeholder: string;
  initialText: string;
  onTextChange: (text: string) => void;
  onEnter: () => void;
  onFiles: (files: FileList) => void;
  ref: Ref<ComposerFieldHandle>;
}) {
  const skills = useStore(client.skills(botId));
  // A bot does not mention itself.
  const otherBots = useStore(client.bots).filter((bot) => bot.id !== botId);
  const known = knownNames(
    skills.map((skill) => skill.name),
    otherBots.map((bot) => bot.name),
  );

  const [query, setQuery] = useState<ReturnType<typeof queryAt>>(null);
  const [activeItem, setActiveItem] = useState(0);
  // Escape closes the picker for the reference that is open, not for the next one.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pickerOpen = query !== null && query.from !== dismissedAt;

  const skillItems = skills.map((skill) => ({ ...skill, icon: <BoxIcon className="text-skill" /> }));
  const botItems = otherBots.map((bot) => ({
    name: bot.name,
    description: bot.statusLine,
    icon: <Character shape={bot.shape} color={bot.color} mood="idle" size={16} />,
  }));
  const pickerSource: ReadonlyArray<PickerItem> = query?.kind === "bot" ? botItems : skillItems;
  const matchingItems = pickerOpen ? matchItems(pickerSource, query.query).slice(0, MAX_LISTED_ITEMS) : [];

  // The editor keeps its first handlers, so they read the current ones through these refs.
  const latest = useRef({ onTextChange, onEnter, onFiles, placeholder, handleKey: (_event: KeyboardEvent): boolean => false });
  latest.current = { onTextChange, onEnter, onFiles, placeholder, handleKey: (event) => handleKey(event) };

  const editor = useEditor({
    extensions: [
      // The field writes plain text, so every rich text feature stays off.
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder: () => latest.current.placeholder }),
      ReferenceNode,
    ],
    content: toContent(initialText, known),
    editorProps: {
      attributes: {
        "aria-label": placeholder,
        "aria-multiline": "true",
        role: "textbox",
        class:
          "px-2.5 py-1.5 text-sm wrap-break-word whitespace-pre-wrap outline-none [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
      },
      handleKeyDown: (_view, event) => latest.current.handleKey(event),
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;

        if (files === undefined || files.length === 0) return false;

        latest.current.onFiles(files);

        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;

        if (files === undefined || files.length === 0) return false;

        event.preventDefault();
        latest.current.onFiles(files);

        return true;
      },
    },
    onUpdate: ({ editor: updated }) => {
      latest.current.onTextChange(updated.getText({ blockSeparator: "\n" }));
      setQuery(queryAt(updated));
      setActiveItem(0);
    },
    onSelectionUpdate: ({ editor: updated }) => setQuery(queryAt(updated)),
  });

  useImperativeHandle(ref, () => ({
    clear: () => editor?.commands.clearContent(true),
    setText: (text) => editor?.commands.setContent(toContent(text, known), { emitUpdate: true }),
  }));

  /** Puts the picked reference as a chip in place of what the operator typed, with a space after it. */
  const insertReference = (item: PickerItem) => {
    if (editor === null || query === null) return;

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
  const handleKey = (event: KeyboardEvent) => {
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

    if (pickerOpen && event.key === "Escape") {
      setDismissedAt(query.from);

      return true;
    }

    // Shift+Enter makes a new line. Enter alone sends.
    if (event.key !== "Enter" || event.shiftKey) return false;

    latest.current.onEnter();

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
      />
      <EditorContent editor={editor} className="max-h-40 min-h-8 min-w-0 flex-1 overflow-y-auto" />
    </>
  );
}

/** Builds the text that the picker shows when nothing matches. A new bot lists its skills a moment after it opens. */
const emptyPickerText = (kind: ReferenceKind, noSkillsYet: boolean) => {
  if (kind === "bot") return "No bot matches.";

  return noSkillsYet ? "Loading the skills…" : "No skill matches.";
};
