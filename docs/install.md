# Installing & building

clots runs on the machine where your bots work: a home server, a Mac that stays on, or a VPS. Linux is the tested platform. macOS is supported in the code but not yet verified.

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| [Bun](https://bun.sh) | 1.4 or later | The runtime and the package manager |
| [Go](https://go.dev/dl/) | 1.27 or later | Builds the Tailscale sidecar |
| [Claude Code](https://code.claude.com/docs/en/setup) | current | Each bot is a Claude Code session |
| Node.js | current | The bots' browser tool (`agent-browser`) runs on Node.js |
| Chromium or Chrome | current | The browser that the bots use |

You also need a Claude subscription (Pro, Max, Team or Enterprise). clots supports the subscription login only.

## Log in to Claude

Run this once on the host:

```shell
claude auth login
```

clots never reads, stores or passes your Claude tokens. It starts the `claude` binary that you installed, and that binary uses its own login.

## Build from source

```shell
git clone https://github.com/segersniels/clots.git
cd clots
bun install
bun run build
```

`bun run build` builds the web client (`apps/web/dist`) and the sidecar (`apps/sidecar/clots-sidecar`).

## Run in the foreground

```shell
bun run start
```

The server listens on `http://127.0.0.1:4587`. It listens on loopback only. Other machines reach it through the sidecar, see [Remote access with Tailscale](./remote-access.md).

## Run as a background service

```shell
bun apps/server/src/cli.ts up
```

`clots up` does these steps:

1. It checks the Claude login and starts `claude auth login` when you are not logged in.
2. It installs and starts the service: a systemd user service on Linux (`~/.config/systemd/user/clots.service`), a launchd agent on macOS (`~/Library/LaunchAgents/foo.clots.server.plist`).
3. It prints a Tailscale login link with a QR code, and waits for your login.
4. It prints the tailnet address of the server with a QR code for your phone.

On Linux it also runs `loginctl enable-linger`, so that the service keeps running after you log out.

Check the state at any time:

```shell
bun apps/server/src/cli.ts status
```

> [!NOTE]
> The service install and the tailnet steps are not yet verified end to end. If `clots up` fails, run `bun run start` and open an issue with the output.

Stop the service, for example to run the server in the foreground:

```shell
bun apps/server/src/cli.ts stop
```

The service stays installed. `clots up` starts it again, and so does the next boot or login.

## Update

```shell
git pull
bun install
bun run build
bun apps/server/src/cli.ts up    # restarts the service
```

## Remove the service

```shell
bun apps/server/src/cli.ts stop --force
```

This stops the service and deletes its systemd unit or launchd agent, so that it does not start again at the next boot or login.

Your bots and their files stay in `~/.clots`. Delete that directory to remove all data.
