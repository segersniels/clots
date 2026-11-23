import type { ApprovalDecision, BotId, PendingApproval } from "@clots/contracts";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";

import { client, useStore } from "../client.ts";
import { formatClock } from "../time.ts";

/** A new time label shows when this much time passed since the previous message. */
const TIME_LABEL_GAP_MS = 30 * 60 * 1000;

/** The bubble shape of the thread: larger text and rounder corners than the shadcn default. */
const BUBBLE_TEXT = "rounded-[1.15rem] px-4 py-2.5 text-base leading-[1.45] whitespace-pre-wrap";

/** Shows something that the bot says or asks, on the bot's side of the thread. */
function FromBot({ children }: { children: ReactNode }) {
  return (
    <Message>
      <MessageContent>
        <Bubble variant="muted">
          <BubbleContent className={BUBBLE_TEXT}>{children}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function Approval({ botId, approval }: { botId: BotId; approval: PendingApproval }) {
  const resolve = (decision: ApprovalDecision) => client.resolveApproval(botId, approval.id, decision);

  return (
    <FromBot>
      <p className="font-medium">Allow {approval.toolName}?</p>
      <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-background p-3 text-xs text-muted-foreground">
        {approval.input}
      </pre>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => resolve("allow")}>Allow once</Button>
        {approval.canAllowAlways && (
          <Button variant="outline" onClick={() => resolve("allowAlways")}>
            Always allow
          </Button>
        )}
        <Button variant="outline" onClick={() => resolve("deny")}>
          Skip
        </Button>
      </div>
    </FromBot>
  );
}

export function Chat({ botId, botName }: { botId: BotId; botName: string }) {
  const thread = useStore(client.thread(botId));
  const [draft, setDraft] = useState("");
  const { live } = thread;

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (text === "") return;

    setDraft("");
    void client.sendMessage(botId, text);
  };

  const sendOnEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    send();
  };

  return (
    <>
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-1.5 px-6 py-4">
              {thread.messages.map((message, index) => {
                const previous = thread.messages[index - 1];
                const showsTime = previous === undefined || message.createdAt - previous.createdAt > TIME_LABEL_GAP_MS;
                const fromBot = message.role === "assistant";
                // Messages from the same side sit close together. A change of side gets more room.
                const changesSide = previous !== undefined && (previous.role === "assistant") !== fromBot;

                return (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={!fromBot}
                    className={changesSide && !showsTime ? "pt-3" : ""}
                  >
                    {showsTime && (
                      <p className="py-3 text-center text-xs text-muted-foreground">{formatClock(message.createdAt)}</p>
                    )}

                    {fromBot ? (
                      <FromBot>{message.text}</FromBot>
                    ) : (
                      <Message align="end">
                        <MessageContent>
                          {message.role === "routine" && <MessageHeader className="justify-end">Routine</MessageHeader>}
                          <Bubble align="end" variant={message.role === "routine" ? "outline" : "default"}>
                            <BubbleContent className={BUBBLE_TEXT}>{message.text}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    )}
                  </MessageScrollerItem>
                );
              })}

              {live.streamingText !== "" && (
                <MessageScrollerItem messageId="streaming" className="pt-3">
                  <FromBot>{live.streamingText}</FromBot>
                </MessageScrollerItem>
              )}

              {live.approvals.map((approval) => (
                <MessageScrollerItem key={approval.id} messageId={approval.id} className="pt-3">
                  <Approval botId={botId} approval={approval} />
                </MessageScrollerItem>
              ))}

              {live.handoff !== null && (
                <MessageScrollerItem messageId={live.handoff.id} className="pt-3">
                  <FromBot>
                    <p className="font-medium">Take over {botName}'s screen</p>
                    <p className="mt-1 text-sm text-muted-foreground">{live.handoff.reason}</p>
                    <Button className="mt-4" onClick={() => client.resolveHandoff(botId, live.handoff!.id)}>
                      I am done
                    </Button>
                  </FromBot>
                </MessageScrollerItem>
              )}

              {live.status === "working" && live.streamingText === "" && (
                <p className="animate-pulse motion-reduce:animate-none px-1 pt-2 text-sm text-muted-foreground">{live.activity ?? "Thinking"}</p>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form onSubmit={send} className="px-6 pb-4">
        {/* An empty draft disables the send button. That must not gray out the whole composer. */}
        <InputGroup className="items-end rounded-[1.6rem] bg-background py-1 pl-2 pr-1.5 shadow-sm has-disabled:bg-background has-disabled:opacity-100">
          <InputGroupTextarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={sendOnEnter}
            rows={1}
            placeholder={`Message ${botName}`}
            className="max-h-40 min-h-9 text-base md:text-base"
          />
          <InputGroupAddon align="inline-end" className="pb-1">
            {live.status === "idle" ? (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                aria-label="Send"
                disabled={draft.trim() === ""}
                className="rounded-full"
              >
                <ArrowUpIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                variant="default"
                size="icon-sm"
                aria-label="Stop"
                className="rounded-full"
                onClick={() => client.interruptBot(botId)}
              >
                <SquareIcon className="size-3 fill-current" />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </>
  );
}
