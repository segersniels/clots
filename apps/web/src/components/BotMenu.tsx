import type { BotSummary } from "@clots/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { BellDotIcon, BellIcon, FolderInputIcon, PencilIcon, UserRoundPlusIcon, UserRoundXIcon } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { client, useStore } from "../client.ts";

/** The value of the "Personal" choice under "Move to". Personal bots have no project id. */
const PERSONAL = "personal";

/** Keeps the item icons quieter than the labels, as in the other menus. */
const ICON = "text-muted-foreground";

/**
 * Opens the actions for one bot on a right-click or a long press on `children`.
 * When the menu closes after "Rename", the focus goes to `renameField`.
 */
export function BotMenu({
  bot,
  onRename,
  renameField,
  children,
}: {
  bot: BotSummary;
  onRename: () => void;
  renameField: RefObject<HTMLInputElement | null>;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const openBotId = useParams({ strict: false }).botId;
  const projects = useStore(client.projects);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const duplicate = async () => {
    const copy = await client.duplicateBot(bot.id);
    void navigate({ to: "/bots/$botId", params: { botId: copy.id } });
  };

  const remove = () => {
    setConfirmingDelete(false);

    // The page of a deleted bot has nothing to show, so the operator leaves it first.
    if (openBotId === bot.id) void navigate({ to: "/" });

    void client.deleteBot(bot.id);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="rounded-xl transition-colors duration-150 data-popup-open:bg-sidebar-accent/60">
          {children}
        </ContextMenuTrigger>

        <ContextMenuContent className="w-48" finalFocus={() => renameField.current ?? true}>
          <ContextMenuItem onClick={() => client.setBotUnread(bot.id, !bot.unread)}>
            {bot.unread ? <BellIcon className={ICON} /> : <BellDotIcon className={ICON} />}
            {bot.unread ? "Mark as read" : "Mark as unread"}
          </ContextMenuItem>

          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={projects.length === 0}>
              <FolderInputIcon className={ICON} />
              Move to
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-44">
              <ContextMenuRadioGroup
                value={bot.projectId ?? PERSONAL}
                onValueChange={(value: string) => client.setBotProject(bot.id, value === PERSONAL ? null : value)}
              >
                {projects.map((project) => (
                  <ContextMenuRadioItem key={project.id} value={project.id}>
                    <span className="truncate">{project.name}</span>
                  </ContextMenuRadioItem>
                ))}
                <ContextMenuRadioItem value={PERSONAL}>Personal</ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator />

          <ContextMenuItem onClick={onRename}>
            <PencilIcon className={ICON} />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={duplicate}>
            <UserRoundPlusIcon className={ICON} />
            Clone
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
            <UserRoundXIcon />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {bot.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the thread, the routines and the notes of the bot. You cannot undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
