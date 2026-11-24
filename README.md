<p align="center"><strong>clots</strong> runs always-on Claude bots on your own machine. You talk to them from the web, your phone or a desktop app, over your Tailscale network.</p>
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/clots-dark.png" />
    <img src="./docs/assets/clots-light.png" alt="The clots web client: bots grouped by project in the sidebar, a chat with a morning briefing and a bot mention, and the bot's details with its screen, project, model, routines and instructions" width="90%" />
  </picture>
</p>
</br>
Each bot is <a href="https://code.claude.com/docs/en/overview">Claude Code</a>, run through the Claude Agent SDK with your Claude subscription login. clots has no hosted service, no accounts and no API key support.

---

## Quickstart

### The server and the app

clots has two parts:

- **The server** runs your bots. It starts Claude Code for each bot, runs their browsers and routines, and keeps their threads. Your bots work only while the server runs.
- **The app** is a Mac window that you use to talk to a server. The server also serves the same client to any browser and to your phone, so the app is optional.

Pick where the server runs:

| Setup | Good for | Install |
| --- | --- | --- |
| **On your Mac** | Trying clots, or bots that work while you use your Mac | The app only. It installs the server on your Mac for you. |
| **On a machine that stays on** (a home server, a VPS, a Mac mini) | Bots that work day and night, also when your laptop sleeps or is closed | The server on that machine. Then talk to it from the app, a browser or your phone. |

You need [Claude Code](https://code.claude.com/docs/en/setup) with a Claude subscription login on the machine that runs the server.

### On your Mac

Install the Clots app (Apple Silicon):

```shell
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/segersniels/clots/main/scripts/install.sh | sh -s -- --app
```

Open Clots and choose **On this Mac**. The app checks Claude Code and installs the server as a background service. The [desktop app docs](./docs/desktop.md) explain each step.

### On a machine that stays on

On that machine (Linux x64 or arm64, or an Apple Silicon Mac), install the `clots` command:

```shell
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/segersniels/clots/main/scripts/install.sh | sh
```

Then start the server as a background service and put it on your tailnet:

```shell
clots up
```

`clots up` checks your Claude login, installs the service, and prints a Tailscale login link with a QR code. After the login, it prints the address of your server, `https://clots.<your-tailnet>.ts.net`. Open that address in a browser or on your phone, or install the app on your Mac and choose **On another machine**. [Installing & building](./docs/install.md) has the details, and how to build from source.

clots tells you about new versions in its sidebar. One click updates the server.

### What a bot is

A bot has a name, a character, instructions, a model and its own working directory. Its character is a small clot with a face that shows what the bot does: it breathes when idle, rolls a droplet while it works, and hops when it needs you. It has one ongoing thread that never ends: clots resumes the same Claude Code session after each restart. A bot keeps its durable memory in files in its working directory.

- **Routines** send a prompt on a schedule, such as "Morning briefing, every day at 9:00".
- **Approvals** ask you before a bot runs a risky tool.
- **The bot's screen** shows its browser live. You can take over for a login or a captcha.
- **Teamwork**: a bot can message other bots, and clone a bot to split a task.

## Docs

- [**Installing & building**](./docs/install.md)
- [**Getting started**](./docs/getting-started.md)
- [**Remote access with Tailscale**](./docs/remote-access.md)
- [**Desktop app**](./docs/desktop.md)
- [**Configuration**](./docs/config.md)
- [**Architecture**](./docs/architecture.md)
- [**Contributing**](./docs/contributing.md)

## Status

clots is new. These parts work and are tested on Linux: bots, chat, session resume, approvals, routines, the bot browser with take-over, and models per bot.

On macOS, these parts are verified: the `clots` command, the background service with `clots up --local`, and the Clots app, both with **On this Mac** and with a server on another machine.

These parts are written but not yet verified end to end: the Tailscale sidecar after the login, and the service install of `clots up` on Linux.

Not built yet: a notarized Clots app that updates itself, a `brew` formula, and the iOS and Android apps.
