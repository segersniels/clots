<p align="center"><strong>clots</strong> runs always-on Claude bots on your own machine. You talk to them from the web, your phone or a desktop app, over your Tailscale network.</p>
<p align="center">
  <img src="./docs/assets/clots.png" alt="The clots web client: the bots, a chat, and the bot's screen, model and routines" width="80%" />
</p>
</br>
Each bot is <a href="https://code.claude.com/docs/en/overview">Claude Code</a>, run through the Claude Agent SDK with your Claude subscription login. clots has no hosted service, no accounts and no API key support.

---

## Quickstart

### Installing and running clots

clots has no packaged release yet. You install it from source on the machine that runs your bots (Linux or macOS). You need [Bun](https://bun.sh), [Go](https://go.dev/dl/), and [Claude Code](https://code.claude.com/docs/en/setup) with a Claude subscription login.

```shell
git clone https://github.com/segersniels/clots.git
cd clots
bun install
bun run build
```

Run the server in the foreground and open <http://127.0.0.1:4587>:

```shell
bun run start
```

Or install clots as a background service and put it on your tailnet:

```shell
bun apps/server/src/cli.ts up
```

`clots up` checks your Claude login, installs the service, and prints a Tailscale login link with a QR code. After the login, it prints the address of your server, `https://clots.<your-tailnet>.ts.net`, for your phone and the desktop app.

### What a bot is

A bot has a name, a picture, instructions, a model and its own working directory. It has one ongoing thread that never ends: clots resumes the same Claude Code session after each restart. A bot keeps its durable memory in files in its working directory.

- **Routines** send a prompt on a schedule, such as "Morning briefing, every day at 8:00".
- **Approvals** ask you before a bot runs a risky tool.
- **The bot's screen** shows its browser live. You can take over for a login or a captcha.

## Docs

- [**Installing & building**](./docs/install.md)
- [**Getting started**](./docs/getting-started.md)
- [**Remote access with Tailscale**](./docs/remote-access.md)
- [**Desktop app**](./docs/desktop.md)
- [**Configuration**](./docs/config.md)
- [**Architecture**](./docs/architecture.md)
- [**Contributing**](./docs/contributing.md)

## Status

clots is new. These parts work and are tested on Linux: bots, chat with streaming, session resume, approvals, routines, the bot browser with take-over, and models per bot.

These parts are written but not yet verified end to end:

- The Tailscale sidecar after the login, and the service install of `clots up`.
- The macOS service (launchd) and the packaged macOS desktop app.

Not built yet: a packaged installer (`brew`, `curl | sh`) and the iOS and Android apps.

clots includes small portions of other projects. See [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES).
