# Installing & building

clots runs on the machine where your bots work: a home server, a Mac that stays on, or a VPS. It runs on Linux and macOS.

> [!TIP]
> To run clots on your own Mac, build the [Clots app](./desktop.md) instead. It installs the `clots` command and the background service for you. This page is for a server, or for the command by itself.

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/setup) | current | Each bot is a Claude Code session |
| Chromium or Chrome | current | The browser that the bots use |
| [Bun](https://bun.sh) | 1.4 or later | Only to build from source |
| [Go](https://go.dev/dl/) | 1.27 or later | Only to build from source: the Tailscale sidecar |

To run clots from a checkout instead of the `clots` command, you also need Node.js for the bots' browser tool.

You also need a Claude subscription (Pro, Max, Team or Enterprise). clots supports the subscription login only.

## Log in to Claude

Run this once on the host:

```shell
claude auth login
```

clots never reads, stores or passes your Claude tokens. It starts the `claude` binary that you installed, and that binary uses its own login.

## Install the `clots` command

```shell
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/segersniels/clots/main/scripts/install.sh | sh
```

The script picks the archive of the [latest release](https://github.com/segersniels/clots/releases/latest) for your machine: `clots-linux-x64`, `clots-linux-arm64` or `clots-darwin-arm64`. It checks the download against the release's `checksums.txt` and runs `clots install`. To install a specific version, end the command with `| CLOTS_VERSION=0.2.0 sh`.

`clots install` copies the folder to `~/.local/share/clots` and links `~/.local/bin/clots` to it. It needs no root. If `~/.local/bin` is not on your PATH, the install tells you to add it.

To install by hand, download the archive for your machine and run `clots install` from it:

```shell
curl -fsSL https://github.com/segersniels/clots/releases/latest/download/clots-linux-x64.tar.gz | tar -xz
clots-linux-x64/clots install
```

## Build from source

```shell
git clone https://github.com/segersniels/clots.git
cd clots
bun install
bun run build:cli
dist/clots-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')/clots install
```

`bun run build:cli` builds the web client, the sidecar and one `clots` binary for this machine, in `dist/clots-<platform>/`. `clots install` installs it as above.

## Run in the foreground

```shell
clots serve
```

The server listens on `http://127.0.0.1:4587`. It listens on loopback only. Other machines reach it through the sidecar, see [Remote access with Tailscale](./remote-access.md).

## Run as a background service

```shell
clots up
```

`clots up` does these steps:

1. It checks the Claude login and starts `claude auth login` when you are not logged in.
2. It installs and starts the service: a systemd user service on Linux (`~/.config/systemd/user/clots.service`), a launchd agent on macOS (`~/Library/LaunchAgents/foo.clots.server.plist`).
3. It prints a Tailscale login link with a QR code, and waits for your login.
4. It prints the tailnet address of the server with a QR code for your phone.

On Linux it also runs `loginctl enable-linger`, so that the service keeps running after you log out.

For a server that only this machine uses, run `clots up --local`. It skips steps 3 and 4: the server stays off the tailnet and needs no Tailscale login.

Check the state at any time:

```shell
clots status
```

Stop the service, for example to run the server in the foreground:

```shell
clots stop
```

The service stays installed. `clots up` starts it again, and so does the next boot or login.

## Update

When a new release is out, the sidebar of the web client shows **Update available**. Click it, then **Update**: the server downloads the release, installs it and restarts. Bots that were working pick up again after the restart. The server checks GitHub for a new release once an hour.

On a server without a browser at hand, run:

```shell
clots update
```

Both work only for the installed `clots` command with its background service. For a build from source:

```shell
git pull
bun install
bun run build:cli
dist/clots-<platform>/clots install
clots up    # restarts the service with the new version
```

## Remove the service

```shell
clots stop --force
```

This stops the service and deletes its systemd unit or launchd agent, so that it does not start again at the next boot or login.

Your bots and their files stay in `~/.clots`. Delete that directory to remove all data. Delete `~/.local/share/clots` and `~/.local/bin/clots` to remove the command.
