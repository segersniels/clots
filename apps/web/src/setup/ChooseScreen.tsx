import { Character } from "@clots/character";
import { ChevronRightIcon, LaptopIcon, ServerIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Screen, ScreenDescription, ScreenTitle } from "./Screen.tsx";

/** One place where clots can run. A click goes straight to its setup. */
function Choice({
  icon,
  title,
  description,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <Item
      render={<button type="button" onClick={onSelect} />}
      variant="muted"
      className="group/choice cursor-default rounded-xl bg-muted/60 px-4 py-3.5 text-left hover:bg-muted"
    >
      <ItemMedia variant="icon" className="translate-y-0! self-center! text-muted-foreground">
        {icon}
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-[0.9375rem]">{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-150 ease-out group-hover/choice:translate-x-0.5" />
      </ItemActions>
    </Item>
  );
}

/** Asks where the clots server runs: on this machine, or on another machine. */
export function ChooseScreen({ onChoose }: { onChoose: (where: "local" | "remote") => void }) {
  return (
    <Screen className="justify-center pb-16">
      <div className="mb-6 flex items-end justify-center gap-4">
        <Character shape="trio" color="red" size={44} />
        <Character shape="tumble" color="pink" size={56} />
        <Character shape="grape" color="blue" size={44} />
      </div>
      <ScreenTitle className="text-center">Where should clots run?</ScreenTitle>
      <ScreenDescription className="text-center">
        clots runs your bots on a server that you own.
      </ScreenDescription>
      <ItemGroup className="mt-8 gap-2">
        <Choice
          icon={<LaptopIcon className="size-5" />}
          title="On this machine"
          description="Runs in the background, also when the window is closed."
          onSelect={() => onChoose("local")}
        />
        <Choice
          icon={<ServerIcon className="size-5" />}
          title="On another machine"
          description="Connect to your server at home or on a VPS, over Tailscale."
          onSelect={() => onChoose("remote")}
        />
      </ItemGroup>
      <p className="mt-5 text-center text-xs text-muted-foreground">
        You can switch later with Server → Change Server…
      </p>
    </Screen>
  );
}
