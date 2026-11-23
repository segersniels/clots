import type { BotId, BrowserCookie } from "@clots/contracts";
import { LogInIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { client } from "../client.ts";

declare global {
  interface Window {
    /** The bridge into the clots desktop app. A plain browser does not have it. */
    clotsDesktop?: { signIn?: (url: string) => Promise<ReadonlyArray<BrowserCookie>> };
  }
}

type Step = "idle" | "waiting" | "saving" | "done" | "failed";

/** The line under the button for each step of a sign-in. */
const STATUS: Record<Step, string> = {
  idle: "",
  waiting: "Sign in, then close the window.",
  saving: "Passing the login to the bot…",
  done: "Signed in. The bot's browser has the login.",
  failed: "The login did not reach the bot. Try again.",
};

/**
 * Lets the operator sign in to a site in a window on this machine, where the site sees a normal
 * browser, and passes the login to the bot's browser. Only the desktop app can open that window.
 */
export function SignInOnThisMachine({ botId }: { botId: BotId }) {
  const signIn = window.clotsDesktop?.signIn;
  const [asking, setAsking] = useState(false);
  const [site, setSite] = useState("");
  const [step, setStep] = useState<Step>("idle");

  if (signIn === undefined) return null;

  const start = async (event: FormEvent) => {
    event.preventDefault();

    const address = site.trim();

    if (address === "") return;

    // A bare host name such as `x.com` means HTTPS.
    const url = /^https?:\/\//.test(address) ? address : `https://${address}`;
    setAsking(false);
    setStep("waiting");

    try {
      const cookies = await signIn(url);
      setStep("saving");
      await client.importBrowserLogin(botId, url, cookies);
      setStep("done");
    } catch {
      setStep("failed");
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 pt-1 pl-1.5">
        <p className="min-w-0 text-[0.8125rem] text-muted-foreground">{STATUS[step]}</p>
        <Button
          variant="ghost"
          size="sm"
          disabled={step === "waiting" || step === "saving"}
          onClick={() => setAsking(true)}
          className="shrink-0 text-muted-foreground"
        >
          <LogInIcon />
          Sign in on this machine
        </Button>
      </div>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <form onSubmit={start} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Sign in on this machine</DialogTitle>
              <DialogDescription>
                A window opens here. Sign in as usual, then close the window. The bot's browser gets the login.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={site}
              onChange={(event) => setSite(event.target.value)}
              placeholder="x.com"
              aria-label="Site"
              autoFocus
            />
            <DialogFooter>
              <Button type="submit" disabled={site.trim() === ""}>
                Open
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
