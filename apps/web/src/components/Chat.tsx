import { Character } from "@clots/character";
import { unconfirmedMessages } from "@clots/client-runtime";
import type {
  ApprovalDecision,
  BotId,
  BotSummary,
  LoginRequest,
  Message as ThreadMessage,
  MessageRole,
  PendingApproval,
  TraceStep,
  TraceStepKind,
} from "@clots/contracts";
import {
  AppWindowIcon,
  ArrowRightIcon,
  BrainIcon,
  CheckIcon,
  CircleAlertIcon,
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  MessageSquareIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffectEvent, useRef, useState, type ReactNode } from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
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
import { useMountEffect } from "@/hooks/use-mount-effect";

import { client, useStore } from "../client.ts";
import { releasePreview, sentMessages, type SentMessage } from "../sent-messages.ts";
import { readCachedThread, saveCachedThread } from "../thread-cache.ts";
import { formatAgo, formatClock, formatDuration } from "../time.ts";
import { Composer } from "./Composer.tsx";
import { Markdown } from "./Markdown.tsx";
import { EmptyThread } from "./EmptyThread.tsx";
import { LOGIN_RISK } from "./LoginBar.tsx";
import { MessageAttachments } from "./MessageAttachments.tsx";
import { knownNames } from "../references.ts";

/** A new time label shows when this much time passed since the previous message. */
const TIME_LABEL_GAP_MS = 30 * 60 * 1000;

/** The bubble shape of the thread: larger text and rounder corners than the shadcn default. */
export const BUBBLE = "rounded-[1.1rem] px-3.5 py-2 text-sm leading-normal";

/**
 * Eases a new thread item in, so that the thread does not jump when it arrives. The transition
 * runs once, when the item first renders.
 */
const ENTER =
  "transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:starting:translate-y-0";

/** The icon of each kind of step. A step without a kind, such as one of an older trace, shows the wrench. */
const STEP_ICONS: Readonly<Record<TraceStepKind, LucideIcon>> = {
  command: TerminalIcon,
  read: FileTextIcon,
  edit: FilePenIcon,
  search: SearchIcon,
  web: GlobeIcon,
  browser: AppWindowIcon,
  message: MessageSquareIcon,
  tool: WrenchIcon,
};

/** The label above a message on the operator's side that the operator did not type. */
const SENDER_LABELS: Partial<Record<MessageRole, string>> = {
  routine: "Routine",
  bot: "Bot message",
};

/** Shows a sent message as a thread message, after the stored ones, until the server's copy takes its place. */
const toThreadMessage = (sent: SentMessage): ThreadMessage => ({
  id: sent.id,
  botId: sent.botId,
  sequence: Number.POSITIVE_INFINITY,
  role: "user",
  text: sent.text,
  attachments: sent.files.map((file, index) => ({
    id: String(index),
    name: file.name,
    mediaType: file.mediaType,
    size: file.size,
  })),
  steps: [],
  createdAt: sent.createdAt,
});

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
 * shimmers while a step runs, and shows the icon of that step, which keeps it when it finishes.
 */
function Steps({
  steps,
  title,
  running,
  runningKind,
}: {
  steps: ReadonlyArray<TraceStep>;
  title: string;
  running: boolean;
  runningKind?: TraceStepKind | undefined;
}) {
  let RunningIcon: LucideIcon | undefined;
  if (runningKind !== undefined) {
    RunningIcon = STEP_ICONS[runningKind];
  } else if (running) {
    // A running trace without a running step means that the bot thinks.
    RunningIcon = BrainIcon;
  }

  // Before the first tool call, such as while the bot thinks, there is nothing to open.
  if (steps.length === 0) {
    return (
      <Trace>
        <TraceLine {...(running ? { status: "running" as const } : {})}>
          {RunningIcon && (
            <TraceIcon>
              <RunningIcon />
            </TraceIcon>
          )}
          <TraceTitle>{title}</TraceTitle>
        </TraceLine>
      </Trace>
    );
  }

  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine {...(running ? { status: "running" as const } : {})}>
            {RunningIcon && (
              <TraceIcon>
                <RunningIcon />
              </TraceIcon>
            )}
            <TraceTitle>{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {steps.map((step) => {
              const StepIcon = STEP_ICONS[step.kind ?? "tool"];

              // The shimmer of a running title shows the status, so the icon shows the action.
              return (
                <TraceLine
                  key={step.id}
                  {...(step.status === "running" ? { status: "running" as const } : {})}
                  className={ENTER}
                >
                  <TraceIcon>
                    <StepIcon />
                  </TraceIcon>
                  <TraceTitle>{step.title}</TraceTitle>
                </TraceLine>
              );
            })}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function Approval({ botId, approval }: { botId: BotId; approval: PendingApproval }) {
  const resolve = (decision: ApprovalDecision) =>
    client.resolveApproval(botId, approval.id, decision);

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

/** Asks the operator to copy another bot's login into this bot's browser, and shows how the copy goes. */
function LoginRequestCard({
  botId,
  target,
  request,
}: {
  botId: BotId;
  target: BotSummary;
  request: LoginRequest;
}) {
  const { from } = request;
  const resolve = (decision: "allow" | "skip") =>
    client.resolveLoginRequest(botId, request.id, decision);

  if (request.state === "done") {
    return (
      <FromBot>
        <p className="flex items-center gap-2">
          <CheckIcon className="size-4 text-attention" />
          Copied. {target.name} reloads the page.
        </p>
      </FromBot>
    );
  }

  const copying = request.state === "copying";
  const allowLabel = { asking: "Allow", copying: "Copying…", failed: "Try again" }[request.state];

  return (
    <FromBot>
      <p className="font-medium">
        Use {from.name}'s login on {request.host}?
      </p>
      <div className="mt-3 rounded-[10px] bg-background px-3 py-2.5">
        <p className="flex items-center gap-2 text-[13.5px] font-medium">
          <span className="flex items-center gap-1.5">
            <Character shape={from.shape} color={from.color} size={22} />
            {from.name}
          </span>
          <ArrowRightIcon className="size-[15px] text-muted-foreground" />
          <span className="flex items-center gap-1.5">
            <Character shape={target.shape} color={target.color} size={22} />
            {target.name}
          </span>
        </p>
        <p className="mt-1.5 text-[12.5px] leading-normal text-muted-foreground">
          Copies this site's cookies and saved data. {target.name} never sees them. {from.name}{" "}
          logged in {formatAgo(from.updatedAt)}. {LOGIN_RISK}
        </p>
      </div>
      {request.state === "failed" && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-destructive">
          <CircleAlertIcon className="size-4 shrink-0" />
          {request.error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={copying} onClick={() => resolve("allow")}>
          {copying && <Spinner className="motion-reduce:animate-none" />}
          {allowLabel}
        </Button>
        <Button variant="outline" disabled={copying} onClick={() => resolve("skip")}>
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
  const [leftTheTop, setLeftTheTop] = useState(false);
  if (canScrollUp && !leftTheTop) {
    setLeftTheTop(true);
  }

  // Each arrival at the top mounts the loader again, so one visit loads one page.
  if (canScrollUp || !hasOlder || !leftTheTop) {
    return null;
  }

  return <LoadOlderMessages onLoad={onLoad} />;
}

/** Loads one page of older messages when it mounts. */
function LoadOlderMessages({ onLoad }: { onLoad: () => void }) {
  useMountEffect(onLoad);

  return null;
}

/** How long a message that the search opened keeps the mark that tints its bubble. It matches the fade in the styles. */
const JUMP_HIGHLIGHT_MS = 1200;

/**
 * Scrolls the thread to a message as soon as the scroller has it, then reports that it did. It
 * scrolls once per mount, so the caller keys it by the message.
 */
function ScrollToMessage({ messageId, onScrolled }: { messageId: string; onScrolled: () => void }) {
  const { scrollToMessage } = useMessageScroller();
  const reportScrolled = useEffectEvent(onScrolled);

  useMountEffect(() => {
    let frame = 0;
    const scrollWhenReady = () => {
      if (scrollToMessage(messageId, { align: "center" })) {
        reportScrolled();
      } else {
        frame = requestAnimationFrame(scrollWhenReady);
      }
    };

    frame = requestAnimationFrame(scrollWhenReady);

    return () => cancelAnimationFrame(frame);
  });

  return null;
}

export function Chat({
  botId,
  botName,
  justCreated = false,
  jumpTo,
  onJumped,
}: {
  botId: BotId;
  botName: string;
  /** The operator just created the bot, so the caret starts in its instructions and not in the composer. */
  justCreated?: boolean;
  /** A message to scroll to, such as one that the search found. */
  jumpTo?: string | undefined;
  /** Reports that the thread scrolled to `jumpTo`, so the page can forget it. */
  onJumped?: () => void;
}) {
  // The open conversation is read, even while the window is in the background, so the bot does not turn unread.
  useMountEffect(() => client.viewBot(botId));
  const thread = useStore(client.thread(botId));
  // After the app starts again, the thread shows its last messages from before, until the server sends the history.
  const [cached] = useState(() => (thread.synced ? null : readCachedThread(botId)));
  const messages = thread.synced || cached === null ? thread.messages : cached;
  const sentHere = useStore(sentMessages).filter((sent) => sent.botId === botId);
  const unconfirmed = unconfirmedMessages(sentHere, messages);
  const sendingIds = new Set(unconfirmed.map((sent) => sent.id));
  // The sent messages that the server has not stored yet follow its messages, so the sync and the cache never see them.
  const shownMessages = [...messages, ...unconfirmed.map(toThreadMessage)];
  // The messages that the thread shows first stay still. Only later ones that arrive live ease in.
  const [shownThrough, setShownThrough] = useState(
    thread.synced ? thread.lastSequence : (cached?.at(-1)?.sequence ?? null),
  );

  if (shownThrough === null && thread.synced) {
    setShownThrough(thread.lastSequence);
  }

  // Only a thread with nothing to show yet fades in. A thread in memory or in the cache is there at once.
  const [loadsLate] = useState(!thread.synced && cached === null);
  const { live } = thread;
  const composer = useRef<{ focus(): void }>(null);
  // A thread without messages asks for the instructions. The first message fades it out.
  const empty = thread.synced && shownMessages.length === 0;
  const [emptyShown, setEmptyShown] = useState(false);
  if (empty && !emptyShown) {
    setEmptyShown(true);
  }

  const [shownCount, setShownCount] = useState(MESSAGES_PER_PAGE);
  const firstShown = Math.max(0, messages.length - shownCount);

  // The synced thread is the one to show at the next start.
  useMountEffect(() => {
    const store = client.thread(botId);
    let saved: typeof thread.messages | undefined;
    const save = () => {
      const { synced, messages } = store.get();

      if (synced && messages !== saved) {
        saved = messages;
        saveCachedThread(botId, messages);
      }
    };

    save();

    return store.subscribe(save);
  });

  const showOlder = () => setShownCount((count) => count + MESSAGES_PER_PAGE);
  const [highlightedId, setHighlightedId] = useState<string>();

  const jumpIndex =
    jumpTo === undefined || !thread.synced
      ? -1
      : messages.findIndex((message) => message.id === jumpTo);

  // A search result opens the thread at its message. An older message first needs enough pages on screen.
  const [pagedJumpIndex, setPagedJumpIndex] = useState(-1);
  if (jumpIndex !== pagedJumpIndex) {
    setPagedJumpIndex(jumpIndex);

    const pagesNeeded = Math.ceil((messages.length - jumpIndex) / MESSAGES_PER_PAGE);

    if (jumpIndex >= 0 && pagesNeeded * MESSAGES_PER_PAGE > shownCount) {
      setShownCount(pagesNeeded * MESSAGES_PER_PAGE);
    }
  }

  const skills = useStore(client.skills(botId));
  const bots = useStore(client.bots);
  const bot = bots.find((candidate) => candidate.id === botId);
  const known = knownNames(
    skills.map((skill) => skill.name),
    bots.map((bot) => bot.name),
  );
  const runningStep = live.steps.findLast((step) => step.status === "running");
  const thinking = live.status === "working" && runningStep === undefined;
  // The login card keeps the last request while it leaves, so it does not vanish at once.
  const [shownLogin, setShownLogin] = useState(live.loginRequest);
  if (live.loginRequest !== null && live.loginRequest !== shownLogin) {
    setShownLogin(live.loginRequest);
  }

  const loginLeaving = live.loginRequest === null;

  /**
   * Eases in a message that arrived live while the thread was on screen. The messages that a new
   * subscription replays, such as the ones a hidden window missed, appear at once with the rest.
   */
  const entrance = (sequence: number) => {
    if (shownThrough === null || sequence <= shownThrough || sequence <= thread.replayedThrough) {
      return "";
    }

    return ENTER;
  };

  return (
    <>
      {/* No item is a scroll anchor: the thread follows its end, so a request from the bot is always in view. */}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        {/* A thread that loads stays hidden until its history is in, then fades in once, complete and at its end. */}
        <MessageScroller
          className={`flex-1 ${loadsLate ? "transition-opacity duration-150 ease-out" : ""} ${thread.synced || cached !== null ? "" : "opacity-0"}`}
        >
          <OlderMessagesLoader hasOlder={firstShown > 0} onLoad={showOlder} />
          {jumpTo !== undefined && jumpIndex >= firstShown && (
            <ScrollToMessage
              key={jumpTo}
              messageId={jumpTo}
              onScrolled={() => {
                setHighlightedId(jumpTo);
                setTimeout(
                  () => setHighlightedId((current) => (current === jumpTo ? undefined : current)),
                  JUMP_HIGHLIGHT_MS,
                );
                onJumped?.();
              }}
            />
          )}
          {/* The thread runs under the floating header and fades out there. The top padding clears the header. */}
          <MessageScrollerViewport
            preserveScrollOnPrepend
            className="[mask-image:linear-gradient(to_bottom,transparent,black_4rem)]"
          >
            <MessageScrollerContent className="gap-1.5 px-4 pt-16 pb-3">
              {shownMessages.slice(firstShown).map((message, offset) => {
                // The full history still decides the time labels and the spacing at the first shown message.
                const index = firstShown + offset;
                const previous = shownMessages[index - 1];
                const showsTime =
                  previous === undefined ||
                  message.createdAt - previous.createdAt > TIME_LABEL_GAP_MS;
                const fromBot = message.role === "assistant" || message.role === "trace";
                // Messages from the same side sit close together. A change of side gets more room.
                const changesSide =
                  previous !== undefined &&
                  (previous.role === "assistant" || previous.role === "trace") !== fromBot;
                const enter = entrance(message.sequence);
                const sending = sendingIds.has(message.id);
                const sent = sentHere.find((candidate) => candidate.id === message.id);

                // A compaction or a settings change is no message but a divider: the bot works differently after it.
                if (message.role === "compact" || message.role === "settings") {
                  return (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      className={`py-3 ${enter}`}
                    >
                      <p className="flex items-center gap-3 text-[0.6875rem] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                        {message.text}
                      </p>
                    </MessageScrollerItem>
                  );
                }

                // A trace that takes the place of the live steps sits where they sat, so only a trace without them eases in.
                if (message.role === "trace") {
                  const traceEnter = live.steps.length === 0 ? enter : "";

                  return (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      className={`px-1 pt-2 ${traceEnter}`}
                    >
                      <Steps
                        steps={message.steps}
                        title={`Worked for ${formatDuration(message.createdAt - (previous?.createdAt ?? message.createdAt))}`}
                        running={false}
                      />
                      {/* What the bot looked at, such as a design, shows without opening the steps. */}
                      <MessageAttachments message={message} />
                    </MessageScrollerItem>
                  );
                }

                return (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    data-jumped={highlightedId === message.id || undefined}
                    className={`${changesSide && !showsTime ? "pt-3" : ""} ${enter}`}
                  >
                    {showsTime && (
                      <p className="py-3 text-center text-[0.6875rem] text-muted-foreground">
                        {formatClock(message.createdAt)}
                      </p>
                    )}

                    {fromBot ? (
                      <FromBot>
                        <Markdown>{message.text}</Markdown>
                      </FromBot>
                    ) : (
                      // A message that the server has not stored yet shows quieter.
                      <Message
                        align="end"
                        className={`transition-opacity duration-200 ease-out ${sending ? "opacity-60" : ""}`}
                      >
                        <MessageContent>
                          {SENDER_LABELS[message.role] !== undefined && (
                            <MessageHeader className="justify-end">
                              {SENDER_LABELS[message.role]}
                            </MessageHeader>
                          )}
                          <MessageAttachments
                            message={message}
                            previews={sent?.files.map((file) => file.previewUrl) ?? []}
                            sending={sending}
                            onPreviewLoaded={(fileIndex) => releasePreview(message.id, fileIndex)}
                          />
                          {/* A message can be files only. */}
                          {message.text !== "" && (
                            <Bubble
                              align="end"
                              variant={
                                SENDER_LABELS[message.role] === undefined ? "default" : "outline"
                              }
                            >
                              {/* Streamdown colors links with the primary color, which is the color of this bubble. */}
                              <BubbleContent
                                className={`${BUBBLE} [&_[data-streamdown=link]]:text-current`}
                              >
                                <Markdown references={{ known, bots }}>{message.text}</Markdown>
                              </BubbleContent>
                            </Bubble>
                          )}
                        </MessageContent>
                      </Message>
                    )}
                  </MessageScrollerItem>
                );
              })}

              {/* The tool calls of the running turn. The finished ones move into the thread as a trace. Between them the bot thinks. */}
              {(live.steps.length > 0 || thinking) && (
                <MessageScrollerItem messageId="steps" className={`px-1 pt-2 ${ENTER}`}>
                  <Steps
                    steps={live.steps}
                    title={runningStep?.title ?? (thinking ? "Thinking" : live.steps.at(-1)!.title)}
                    running={runningStep !== undefined || thinking}
                    runningKind={runningStep && (runningStep.kind ?? "tool")}
                  />
                </MessageScrollerItem>
              )}

              {live.approvals.map((approval) => (
                <MessageScrollerItem
                  key={approval.id}
                  messageId={approval.id}
                  className={`pt-3 ${ENTER}`}
                >
                  <Approval botId={botId} approval={approval} />
                </MessageScrollerItem>
              ))}

              {live.handoff !== null && (
                <MessageScrollerItem messageId={live.handoff.id} className={`pt-3 ${ENTER}`}>
                  <FromBot>
                    <p className="font-medium">Take over {botName}'s screen</p>
                    <p className="mt-1 text-sm text-muted-foreground">{live.handoff.reason}</p>
                    <Button
                      className="mt-4"
                      onClick={() => client.resolveHandoff(botId, live.handoff!.id)}
                    >
                      I am done
                    </Button>
                  </FromBot>
                </MessageScrollerItem>
              )}

              {shownLogin !== null && bot !== undefined && (
                <MessageScrollerItem messageId={shownLogin.id} className={`pt-3 ${ENTER}`}>
                  <div
                    inert={loginLeaving}
                    onTransitionEnd={(event) =>
                      event.target === event.currentTarget && loginLeaving && setShownLogin(null)
                    }
                    className={`transition-[opacity,translate] duration-200 ease-out ${loginLeaving ? "translate-y-2 opacity-0 motion-reduce:translate-y-0" : ""}`}
                  >
                    <LoginRequestCard botId={botId} target={bot} request={shownLogin} />
                  </div>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
          {emptyShown && bot !== undefined && (
            <div
              inert={!empty}
              onTransitionEnd={(event) =>
                event.target === event.currentTarget && !empty && setEmptyShown(false)
              }
              className={`absolute inset-0 flex items-center justify-center px-4 pt-16 pb-3 transition-opacity duration-200 ease-out ${empty ? "" : "opacity-0"}`}
            >
              <EmptyThread
                bot={bot}
                focusOnOpen={justCreated}
                onDone={() => composer.current?.focus()}
              />
            </div>
          )}
        </MessageScroller>

        {/* The composer sits inside the provider, so that sending can make the thread follow its end again. */}
        <Composer
          ref={composer}
          botId={botId}
          botName={botName}
          status={live.status}
          autoFocus={!justCreated}
        />
      </MessageScrollerProvider>
    </>
  );
}
