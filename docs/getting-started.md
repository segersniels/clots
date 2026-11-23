# Getting started

Open the web client: `http://127.0.0.1:4587` on the host, or your tailnet address from another device.

## Create a bot

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/new-bot-dark.png" />
  <img src="./assets/new-bot-light.png" alt="The new bot form: a character preview, the name field, the shape and color pickers, and the instructions" width="70%" />
</picture>

1. Click **+** in the sidebar, then **New bot**.
2. Enter a name.
3. Pick a shape and a color for the bot's character.
4. Enter the instructions. The instructions say what the bot does and how it behaves. clots adds them to the system prompt of Claude Code.
5. Click **Get started**.

Each bot gets its own working directory under `~/.clots/bots/`. The bot keeps its notes there, for example in `CLAUDE.md`. That is its durable memory.

## Projects

A project groups bots, and it can point at a folder on the server, for example a repository.

1. Click **+** in the sidebar and choose **New project**.
2. Enter a name. Optionally enter the directory, for example `~/code/mejl`.
3. Open a bot's details (click its name at the top of the chat) and pick the project under **Project**.

A bot of a project with a directory works in that directory. It then also gets the `CLAUDE.md`, the skills and the settings of that folder. Its own notes stay in its notes directory under `~/.clots/bots/`.

When you move a bot to another project, it starts a new Claude Code session, because a session belongs to one directory. The chat history stays, but the bot does not remember it.

The sidebar shows each project as a section that you can collapse. Bots without a project are under **Personal**.

## Chat

A bot has one ongoing thread. Write a message and press Enter. Shift+Enter adds a line.

- The reply shows when the bot finishes it. While the bot works, the thread shows its tool calls.
- The square button stops the current turn.
- After a server restart, the history is there and the bot continues the same session.

## Files and images

Paste a file or an image into the message field, drop it there, or click **+** next to the field. The files show above the field until you send. A message can be files only.

- The bot sees an image at once (PNG, JPEG, GIF, WebP).
- For each file, the bot also gets the path of the stored copy, so it can read or use the file.
- The server keeps the files in the bot's notes directory, under `attachments/`. A file can be 10 MB at most.

While a bot works, a closed line in the thread shows its current tool call. Click it to see all steps. When the bot finishes, the steps stay in the thread as a closed "Worked for …" line.

## Approvals

A bot runs in the auto permission mode of Claude Code: a classifier allows safe tool calls and denies dangerous ones. When the classifier cannot decide, the bot asks you. The request shows in the thread:

- **Allow once** runs this one call.
- **Always allow** also saves a permission rule, so the bot does not ask again for the same kind of call.
- **Skip** denies the call. The bot continues without it.

A bot that waits for you shows "Needs you" and a blue dot in the sidebar.

## The bot's screen

The details pane on the right shows the bot's browser live, when the bot has one open. Use the monitor icon in the chat header to open or close the pane.

- Click the screen to **take over**. Your mouse and keyboard then go to the page.
- Click **Give back** to return control.
- When a page needs you (a login, a captcha, a payment), the bot asks for a handoff in the thread. Take over, do the step, and click **I am done**.

Each bot has its own browser profile, so its logins stay.

## Model

The details pane has a model menu with four choices: **Haiku**, **Sonnet**, **Opus** and **Fable**. A choice changes the model at once, also in the middle of a thread. clots stores only the class. Claude Code picks the newest model of that class that your account can use.

A new bot starts on Opus.

## Routines

A routine sends a prompt to the bot on a schedule.

1. Click **+** next to **Routines** in the details pane.
2. Enter the prompt, for example "Morning briefing".
3. Pick a schedule, or pick **Custom cron** and enter a cron expression with five fields.
4. Click **Add routine**.

The clock icon pauses and resumes a routine. Schedules use the time zone of the host. A routine that was due while the server was down runs once after the start.
