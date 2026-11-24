import { MAX_UPLOAD_BYTES, type BotId, type BotStatus, type Upload } from "@clots/contracts";
import { ArrowUpIcon, FileTextIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { useMessageScroller } from "@/components/ui/message-scroller";

import { client } from "../client.ts";
import { drafts, saveDraft } from "../drafts.ts";
import { Collapse } from "./Collapse.tsx";
import { ComposerField, type ComposerFieldHandle } from "./ComposerField.tsx";

/** A file that waits in the composer. `previewUrl` is set for an image. */
interface DraftFile {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string | undefined;
}

/** The files that wait in the composer of each bot. A file cannot go in storage, so it stays until the page reloads. */
const draftFiles = new Map<BotId, ReadonlyArray<DraftFile>>();

/** Formats a file size, for example "2.4 MB". */
export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Reads a file as base64, which is how a file travels in a message to the server. */
const toUpload = async (file: File): Promise<Upload> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";

  // A single call with all bytes can exceed the argument limit of the JavaScript engine.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return { name: file.name, mediaType: file.type || "application/octet-stream", data: btoa(binary) };
};

/** The message field of a thread. It takes text, and files by paste, by drop or from the file dialog. */
export function Composer({
  botId,
  botName,
  status,
  autoFocus = true,
}: {
  botId: BotId;
  botName: string;
  status: BotStatus;
  /** Gives the field the focus when the bot opens. A new bot leaves it to its instructions. */
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(() => drafts.get().get(botId)?.text ?? "");
  const [files, setFiles] = useState(() => draftFiles.get(botId) ?? []);
  const [tooLarge, setTooLarge] = useState(false);
  const fileDialog = useRef<HTMLInputElement>(null);
  const field = useRef<ComposerFieldHandle>(null);
  const { scrollToEnd } = useMessageScroller();
  const canSend = draft.trim() !== "" || files.length > 0;

  // The draft outlives the composer, so it is still there when the operator comes back to the bot.
  useEffect(() => {
    draftFiles.set(botId, files);
    saveDraft(botId, { text: draft, fileCount: files.length });
  }, [botId, draft, files]);

  const addFiles = (added: Iterable<File>) => {
    const accepted = [...added].filter((file) => file.size <= MAX_UPLOAD_BYTES);
    setTooLarge(accepted.length < [...added].length);
    setFiles((current) => [
      ...current,
      ...accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      })),
    ]);
  };

  const removeFile = (removed: DraftFile) => {
    if (removed.previewUrl !== undefined) URL.revokeObjectURL(removed.previewUrl);
    setFiles((current) => current.filter((file) => file.id !== removed.id));
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;

    // A sent message wants its answer in view, so the thread follows its end again, as the arrow button does.
    scrollToEnd({ behavior: "smooth" });

    const text = draft.trim();
    const sending = files;
    field.current?.clear();
    setFiles([]);
    setTooLarge(false);

    try {
      await client.sendMessage(botId, text, await Promise.all(sending.map((file) => toUpload(file.file))));
    } catch {
      // A failed send keeps the message and its files, so the operator can send it again.
      field.current?.setText(text);
      setFiles(sending);

      return;
    }

    for (const file of sending) if (file.previewUrl !== undefined) URL.revokeObjectURL(file.previewUrl);
  };

  const dropFiles = (event: DragEvent) => {
    if (event.dataTransfer.files.length === 0) return;

    event.preventDefault();
    addFiles(event.dataTransfer.files);
  };

  return (
    <form onSubmit={send} onDrop={dropFiles} onDragOver={(event) => event.preventDefault()} className="px-4 pb-4">
      <input
        ref={fileDialog}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          addFiles(event.target.files ?? []);
          // The same file can then be picked again.
          event.target.value = "";
        }}
      />

      <div className="relative rounded-[1.25rem] border border-input bg-muted/40 transition-colors duration-150 focus-within:border-ring">
        <Collapse open={files.length > 0 || tooLarge}>
          <AttachmentGroup className="px-2 pt-2">
            {files.map((file) => (
              <Attachment
                key={file.id}
                size="sm"
                className="transition-[opacity,scale] duration-200 ease-out starting:scale-95 starting:opacity-0 motion-reduce:starting:scale-100"
              >
                {file.previewUrl === undefined ? (
                  <AttachmentMedia>
                    <FileTextIcon />
                  </AttachmentMedia>
                ) : (
                  <AttachmentMedia variant="image">
                    <img src={file.previewUrl} alt="" />
                  </AttachmentMedia>
                )}
                <AttachmentContent>
                  <AttachmentTitle>{file.file.name}</AttachmentTitle>
                  <AttachmentDescription>{formatSize(file.file.size)}</AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction aria-label={`Remove ${file.file.name}`} onClick={() => removeFile(file)}>
                    <XIcon />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>
          {tooLarge && <p className="px-3.5 pt-2 text-xs text-destructive">A file is larger than 10 MB and was left out.</p>}
        </Collapse>

        {/* The wrapper draws the border, so the group itself has none. An empty draft must not gray it out. */}
        <InputGroup className="h-auto items-end border-0 bg-transparent py-1 pr-1 pl-1 has-disabled:bg-transparent has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent dark:has-disabled:bg-transparent">
          <InputGroupAddon align="inline-start" className="py-0.5">
            <InputGroupButton
              size="icon-xs"
              aria-label="Attach files"
              className="size-7 rounded-full text-muted-foreground"
              onClick={() => fileDialog.current?.click()}
            >
              <PlusIcon />
            </InputGroupButton>
          </InputGroupAddon>
          <ComposerField
            ref={field}
            botId={botId}
            placeholder={files.length > 0 ? "Add a message, or hit send" : `Message ${botName}`}
            initialText={draft}
            onTextChange={setDraft}
            onEnter={() => void send()}
            onFiles={addFiles}
            autoFocus={autoFocus}
          />
          <InputGroupAddon align="inline-end" className="py-0.5">
            {status === "idle" ? (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-xs"
                aria-label="Send"
                disabled={!canSend}
                className="size-7 rounded-full"
              >
                <ArrowUpIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                variant="default"
                size="icon-xs"
                aria-label="Stop"
                className="size-7 rounded-full"
                onClick={() => client.interruptBot(botId)}
              >
                <SquareIcon className="size-3 fill-current" />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </form>
  );
}
