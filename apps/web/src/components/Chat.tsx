import type { ApprovalDecision, BotId, MessageRole, PendingApproval, TraceStep } from "@clots/contracts";
import { CircleCheckIcon, LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScrollerScrollable,
} from "@/components/ui/message-scroller";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

import { client, useStore } from "../client.ts";
import { formatClock, formatDuration } from "../time.ts";
import { Collapse } from "./Collapse.tsx";
import { Composer } from "./Composer.tsx";
import { Markdown } from "./Markdown.tsx";
import { MessageAttachments } from "./MessageAttachments.tsx";
import { knownNames } from "../references.ts";
import { ReferenceText } from "./ReferenceText.tsx";

/** A new time label shows when this much time passed since the previous message. */
const TIME_LABEL_GAP_MS = 30 * 60 * 1000;

/** The bubble shape of the thread: larger text and rounder corners than the shadcn default. */
const BUBBLE = "rounded-[1.1rem] px-3.5 py-2 text-sm leading-normal";

/**
 * Eases a new thread item in, so that the thread does not jump when it arrives. The transition
 * runs once, when the item first renders.
 */
const ENTER =
  "transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:starting:translate-y-0";

/** The label above a message on the operator's side that the operator did not type. */
const SENDER_LABELS: Partial<Record<MessageRole, string>> = { routine: "Routine", bot: "Bot message" };

/** What the operator typed shows as typed, with its line breaks. A bot reply is markdown. */
const BUBBLE_TEXT = `${BUBBLE} whitespace-pre-wrap`;

/** Shows something that the bot says or asks, on the bot's side of the thread. */
function FromBot({ children }: { children: ReactNode }) {
  return (
    <Message>
      <MessageContent>
        <Bubble variant="muted">
          <BubbleContent className={BUBBLE}>{children}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/**
 * Shows the tool calls of the bot as one closed summary line, which opens into the steps. The line
 * shimmers while a step runs.
 */
function Steps({ steps, title, running }: { steps: ReadonlyArray<TraceStep>; title: string; running: boolean }) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine {...(running ? { status: "running" as const } : {})}>
            <TraceTitle>{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {steps.map((step) => (
              <TraceLine key={step.id} {...(step.status === "running" ? { status: "running" as const } : {})} className={ENTER}>
                <TraceIcon>
                  {step.status === "running" ? (
                    <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <CircleCheckIcon />
                  )}
                </TraceIcon>
                <TraceTitle>{step.title}</TraceTitle>
              </TraceLine>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function Approval({ botId, approval }: { botId: BotId; approval: PendingApproval }) {
  const resolve = (decision: ApprovalDecision) => client.resolveApproval(botId, approval.id, decision);

  return (
    <FromBot>
      <p className="font-medium">Allow {approval.toolName}?</p>
      <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-background p-3 text-xs break-all whitespace-pre-wrap text-muted-foreground">
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

/**
 * How many of the latest messages a thread shows when it opens, and how many more it adds at the
 * top. A long history would otherwise render at once and block the page for a moment.
 */
const MESSAGES_PER_PAGE = 50;

/** Shows older messages when the operator scrolls to the top of the thread. */
function OlderMessagesLoader({ hasOlder, onLoad }: { hasOlder: boolean; onLoad: () => void }) {
  const { start: canScrollUp } = useMessageScrollerScrollable();
  // A thread opens at its end, but reads as being at the top until it gets there. That moment must not load anything.
  const leftTheTop = useRef(false);

  useEffect(() => {
    if (canScrollUp) {
      leftTheTop.current = true;

      return;
    }

    if (hasOlder && leftTheTop.current) onLoad();
  }, [hasOlder, canScrollUp, onLoad]);

  return null;
}

export function Chat({ botId, botName }: { botId: BotId; botName: string }) {
  const thread = useStore(client.thread(botId));
  // Only items that arrive while the thread is open ease in. The stored history shows at once.
  const openedAt = useRef(Date.now());
  const { live } = thread;
  const [shownCount, setShownCount] = useState(MESSAGES_PER_PAGE);
  const firstShown = Math.max(0, thread.messages.length - shownCount);
  // A stable callback, so that one visit to the top loads one page and not one per render.
  const showOlder = useCallback(() => setShownCount((count) => count + MESSAGES_PER_PAGE), []);
  const skills = useStore(client.skills(botId));
  const bots = useStore(client.bots);
  const known = knownNames(
    skills.map((skill) => skill.name),
    bots.map((bot) => bot.name),
  );
  const runningStep = live.steps.findLast((step) => step.status === "running");
  // The line keeps the last tasks while it closes, so it does not go blank before it is gone.
  const shownTasks = useRef(live.tasks);
  if (live.tasks.length > 0) shownTasks.current = live.tasks;
  const backgroundTitle =
    shownTasks.current.length === 1
      ? `In the background: ${shownTasks.current[0]!.description}`
      : `${shownTasks.current.length} tasks in the background`;

  return (
    <>
      {/* No item is a scroll anchor: the thread follows its end, so a request from the bot is always in view. */}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        {/* A quick fade in, so that switching bots does not cut hard from one thread to the next. */}
        <MessageScroller className="flex-1 transition-opacity duration-150 ease-out starting:opacity-0">
          <OlderMessagesLoader hasOlder={firstShown > 0} onLoad={showOlder} />
          {/* The thread runs under the floating header and fades out there. The top padding clears the header. */}
          <MessageScrollerViewport preserveScrollOnPrepend className="[mask-image:linear-gradient(to_bottom,transparent,black_4rem)]">
            <MessageScrollerContent className="gap-1.5 px-4 pt-16 pb-3">
              {thread.messages.slice(firstShown).map((message, offset) => {
                // The full history still decides the time labels and the spacing at the first shown message.
                const index = firstShown + offset;
                const previous = thread.messages[index - 1];
                const showsTime = previous === undefined || message.createdAt - previous.createdAt > TIME_LABEL_GAP_MS;
                const fromBot = message.role === "assistant" || message.role === "trace";
                // Messages from the same side sit close together. A change of side gets more room.
                const changesSide = previous !== undefined && (previous.role === "assistant" || previous.role === "trace") !== fromBot;

                // A compaction is no message but a divider: the bot's memory before it is a summary.
                if (message.role === "compact") {
                  return (
                    <MessageScrollerItem key={message.id} messageId={message.id} className="py-3">
                      <p className="flex items-center gap-3 text-[0.6875rem] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                        {message.text}
                      </p>
                    </MessageScrollerItem>
                  );
                }

                // A trace takes the place of the live steps, so it sits where they sat and does not ease in.
                if (message.role === "trace") {
                  return (
                    <MessageScrollerItem key={message.id} messageId={message.id} className="px-1 pt-2">
                      <Steps
                        steps={message.steps}
                        title={`Worked for ${formatDuration(message.createdAt - (previous?.createdAt ?? message.createdAt))}`}
                        running={false}
                      />
                    </MessageScrollerItem>
                  );
                }

                return (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    // A bot reply takes the place of its streamed text, so it must not ease in a second time.
                    className={`${changesSide && !showsTime ? "pt-3" : ""} ${!fromBot && message.createdAt >= openedAt.current ? ENTER : ""}`}
                  >
                    {showsTime && (
                      <p className="py-3 text-center text-[0.6875rem] text-muted-foreground">{formatClock(message.createdAt)}</p>
                    )}

                    {fromBot ? (
                      <FromBot>
                        <Markdown>{message.text}</Markdown>
                      </FromBot>
                    ) : (
                      <Message align="end">
                        <MessageContent>
                          {SENDER_LABELS[message.role] !== undefined && (
                            <MessageHeader className="justify-end">{SENDER_LABELS[message.role]}</MessageHeader>
                          )}
                          <MessageAttachments message={message} />
                          {/* A message can be files only. */}
                          {message.text !== "" && (
                            <Bubble align="end" variant={SENDER_LABELS[message.role] === undefined ? "default" : "outline"}>
                              <BubbleContent className={BUBBLE_TEXT}>
                                <ReferenceText text={message.text} known={known} bots={bots} />
                              </BubbleContent>
                            </Bubble>
                          )}
                        </MessageContent>
                      </Message>
                    )}
                  </MessageScrollerItem>
                );
              })}

              {/* The tool calls of the running turn. The finished ones move into the thread as a trace. */}
              {live.steps.length > 0 && (
                <MessageScrollerItem messageId="steps" className={`px-1 pt-2 ${ENTER}`}>
                  <Steps steps={live.steps} title={(runningStep ?? live.steps.at(-1)!).title} running={runningStep !== undefined} />
                </MessageScrollerItem>
              )}

              {live.approvals.map((approval) => (
                <MessageScrollerItem key={approval.id} messageId={approval.id} className={`pt-3 ${ENTER}`}>
                  <Approval botId={botId} approval={approval} />
                </MessageScrollerItem>
              ))}

              {live.handoff !== null && (
                <MessageScrollerItem messageId={live.handoff.id} className={`pt-3 ${ENTER}`}>
                  <FromBot>
                    <p className="font-medium">Take over {botName}'s screen</p>
                    <p className="mt-1 text-sm text-muted-foreground">{live.handoff.reason}</p>
                    <Button className="mt-4" onClick={() => client.resolveHandoff(botId, live.handoff!.id)}>
                      I am done
                    </Button>
                  </FromBot>
                </MessageScrollerItem>
              )}

              {live.status === "working" && runningStep === undefined && (
                <p className={`animate-pulse px-1 pt-2 text-[0.8125rem] text-muted-foreground motion-reduce:animate-none ${ENTER}`}>
                  Thinking
                </p>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>

        {/* Work in the background, such as a subagent, can outlive the turn. The line stays until the work ends. */}
        <Collapse open={live.tasks.length > 0}>
          <div className="px-5 pb-2">
            <Steps
              steps={shownTasks.current.map((task) => ({ id: task.id, title: task.description, status: "running" as const }))}
              title={backgroundTitle}
              running
            />
          </div>
        </Collapse>

        {/* The composer sits inside the provider, so that sending can make the thread follow its end again. */}
        <Composer botId={botId} botName={botName} status={live.status} />
      </MessageScrollerProvider>
    </>
  );
}
