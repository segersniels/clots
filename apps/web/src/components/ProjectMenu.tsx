import type { Project } from "@clots/contracts";
import { FolderXIcon, PencilIcon, UserRoundPlusIcon } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";

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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";

import { client } from "../client.ts";
import { NewBotDialog } from "./CreateDialog.tsx";

/** Keeps the item icons quieter than the labels, as in the other menus. */
const ICON = "text-muted-foreground";

/** Tells the operator what happens to the bots and the folder of a project that they delete. */
function describeDelete(project: Project, botCount: number) {
  const bots = {
    0: "The project has no bots.",
    1: "Its bot moves to Personal and keeps its thread.",
  }[botCount] ?? `Its ${botCount} bots move to Personal and keep their threads.`;
  const folder = project.directory === null ? "" : " The folder on disk stays.";

  return `${bots}${folder} You cannot undo this.`;
}

/**
 * Opens the actions for one project on a right-click or a long press on `children`.
 * When the menu closes after "Rename", the focus goes to `renameField`.
 */
export function ProjectMenu({
  project,
  botCount,
  onRename,
  renameField,
  children,
}: {
  project: Project;
  botCount: number;
  onRename: () => void;
  renameField: RefObject<HTMLInputElement | null>;
  children: ReactNode;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [creatingBot, setCreatingBot] = useState(false);
  // The menu closes after the dialog opens, so it must leave the focus in the dialog's name field.
  const openingDialog = useRef(false);

  const createBot = () => {
    openingDialog.current = true;
    setCreatingBot(true);
  };

  /** Chooses where the focus goes when the menu closes: the rename field, the dialog, or back to the header. */
  const focusAfterMenu = () => {
    if (openingDialog.current) {
      openingDialog.current = false;

      return false;
    }

    return renameField.current ?? true;
  };

  const remove = () => {
    setConfirmingDelete(false);
    void client.deleteProject(project.id);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="rounded-lg transition-colors duration-150 data-popup-open:bg-sidebar-accent/60">
          {children}
        </ContextMenuTrigger>

        <ContextMenuContent className="w-44" finalFocus={focusAfterMenu}>
          <ContextMenuItem onClick={createBot}>
            <UserRoundPlusIcon className={ICON} />
            New bot
          </ContextMenuItem>

          <ContextMenuItem onClick={onRename}>
            <PencilIcon className={ICON} />
            Rename
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
            <FolderXIcon />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <NewBotDialog open={creatingBot} onOpenChange={setCreatingBot} projectId={project.id} />

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>{describeDelete(project, botCount)}</AlertDialogDescription>
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
