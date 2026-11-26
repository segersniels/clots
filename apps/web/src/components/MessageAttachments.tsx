import { ATTACHMENTS_PATH, type Message } from "@clots/contracts";
import { FileTextIcon } from "lucide-react";

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { formatSize } from "./Composer.tsx";

/**
 * Shows an image of a message. A click opens it large inside the app, so the desktop app does not
 * send it to a browser. An image that the operator just sent shows its local `previewUrl` until the
 * server's copy at `url` has loaded, so it does not blink.
 */
function ImageAttachment({
  url,
  previewUrl,
  name,
  onLoaded,
}: {
  url: string | undefined;
  previewUrl: string | undefined;
  name: string;
  onLoaded: () => void;
}) {
  const shownUrl = previewUrl ?? url;

  return (
    <Dialog>
      <DialogTrigger
        aria-label={`Open ${name}`}
        className="cursor-zoom-in rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {/* A fixed height keeps the thread still while the image loads. The muted box holds its place. */}
        <img
          src={shownUrl}
          alt={name}
          decoding="async"
          className="h-56 w-auto min-w-24 max-w-full rounded-2xl border bg-muted object-contain"
        />
        {/* The hidden copy loads the server's image behind the preview. */}
        {previewUrl !== undefined && url !== undefined && (
          <img src={url} alt="" hidden onLoad={onLoaded} />
        )}
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="w-auto max-w-[calc(100vw-2rem)] bg-transparent p-0 ring-0 sm:max-w-[calc(100vw-4rem)]"
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        {/* A click on the image closes it, as a click next to it does. */}
        <DialogClose aria-label={`Close ${name}`} className="cursor-zoom-out outline-none">
          <img
            src={shownUrl}
            alt={name}
            className="max-h-[calc(100dvh-4rem)] max-w-full rounded-2xl object-contain"
          />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shows the files of a message: an image as a picture, another file as a card that opens it. The
 * operator's files sit on the right. The images that a bot opened sit in a row on the bot's side.
 * A message that the operator sent shows the local `previews` of its images, and while it is
 * `sending`, the server has no files to open yet.
 */
export function MessageAttachments({
  message,
  previews = [],
  sending = false,
  onPreviewLoaded,
}: {
  message: Message;
  previews?: ReadonlyArray<string | undefined>;
  sending?: boolean;
  onPreviewLoaded?: (fileIndex: number) => void;
}) {
  if (message.attachments.length === 0) {
    return null;
  }

  return (
    <div
      className={
        message.role === "trace"
          ? "flex flex-wrap gap-1.5 pt-1.5"
          : "flex flex-col items-end gap-1.5"
      }
    >
      {message.attachments.map((attachment, index) => {
        const url = sending ? undefined : `${ATTACHMENTS_PATH}/${message.botId}/${attachment.id}`;

        // The server gives the files of a sent message new ids, so the files keep their place by their order.
        if (attachment.mediaType.startsWith("image/")) {
          return (
            <ImageAttachment
              key={index}
              url={url}
              previewUrl={previews[index]}
              name={attachment.name}
              onLoaded={() => onPreviewLoaded?.(index)}
            />
          );
        }

        return (
          <Attachment key={index} size="sm">
            <AttachmentMedia>
              <FileTextIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{attachment.name}</AttachmentTitle>
              <AttachmentDescription>{formatSize(attachment.size)}</AttachmentDescription>
            </AttachmentContent>
            {url !== undefined && (
              <AttachmentTrigger
                render={
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${attachment.name}`}
                  />
                }
              />
            )}
          </Attachment>
        );
      })}
    </div>
  );
}
