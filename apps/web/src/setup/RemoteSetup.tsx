import { ArrowUpRightIcon, GlobeIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { desktop, SELF_HOSTING_GUIDE } from "./bridge.ts";
import { Screen, ScreenDescription, ScreenTitle } from "./Screen.tsx";

type Connection =
  | { readonly name: "idle" }
  | { readonly name: "connecting" }
  | { readonly name: "failed"; readonly host: string; readonly code: string };

/** Reduces an address such as `https://clots.example.ts.net/` to its host for the error message. */
const hostOf = (address: string) => address.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/**
 * Connects the app to a clots server on another machine. The app opens the page with the last
 * address and error when that server did not answer at start.
 */
export function RemoteSetup({ onBack }: { onBack: () => void }) {
  const params = new URLSearchParams(location.search);
  const [address, setAddress] = useState(params.get("address") ?? "");
  const startError = params.get("error");
  const [connection, setConnection] = useState<Connection>(
    startError === null
      ? { name: "idle" }
      : { name: "failed", host: hostOf(address), code: startError },
  );

  const connect = async () => {
    setConnection({ name: "connecting" });
    const result = await desktop.connect(address);

    if (!result.ok) {
      setConnection({ name: "failed", host: hostOf(address), code: result.code });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void connect();
  };

  const connecting = connection.name === "connecting";

  return (
    <Screen onBack={onBack}>
      <ScreenTitle>Connect to your clots server</ScreenTitle>
      <ScreenDescription>
        Enter the address of the clots server on your tailnet. This machine must be signed in to the
        same Tailscale network.
      </ScreenDescription>

      <form onSubmit={submit} className="mt-7">
        <Field>
          <FieldLabel htmlFor="address">Server address</FieldLabel>
          <div className="flex gap-2">
            <InputGroup className="h-10 rounded-xl border-transparent bg-muted/60 has-[[aria-invalid=true]]:border-destructive dark:bg-muted/60">
              <InputGroupAddon>
                <GlobeIcon />
                <InputGroupText>https://</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="clots.your-tailnet.ts.net"
                disabled={connecting}
                aria-invalid={connection.name === "failed"}
                autoFocus
                spellCheck={false}
              />
            </InputGroup>
            <Button
              type="submit"
              className="h-10 rounded-xl px-4"
              disabled={connecting || address.trim() === ""}
            >
              {connecting && <Spinner />}
              Connect
            </Button>
          </div>
          <FieldDescription>
            The address that <code className="font-mono">clots up</code> printed on the server.
          </FieldDescription>
        </Field>
      </form>

      {connection.name === "failed" && (
        <div className="mt-5 flex gap-3 animate-in fade-in duration-150 motion-reduce:animate-none">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive text-white">
            <XIcon className="size-3.5" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-destructive">Could not reach {connection.host}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check that the clots server runs, and that this machine is signed in to Tailscale.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void connect()}>
                <RotateCwIcon />
                Try again
              </Button>
              <code className="rounded-md bg-muted/60 px-2 py-1 font-mono text-xs select-text">
                {connection.code}
              </code>
            </div>
          </div>
        </div>
      )}

      <section className="mt-10 text-sm">
        <h2 className="font-medium">No server yet?</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>On the machine that will run your bots, follow the self-hosting guide.</li>
          <li>
            Run <code className="rounded bg-muted/60 px-1 font-mono">clots up</code>. It prints a
            Tailscale login link and then the server address.
          </li>
          <li>Enter that address above.</li>
        </ol>
        <a
          href={SELF_HOSTING_GUIDE}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 font-medium underline underline-offset-4"
        >
          Read the self-hosting guide
          <ArrowUpRightIcon className="size-3.5" />
        </a>
      </section>
    </Screen>
  );
}
