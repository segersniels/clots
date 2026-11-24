# Desktop app

The desktop app (`apps/desktop`) is an Electron window around the web client. It holds no copy of the client: it shows the client that your clots server serves. A server update therefore also updates the app.

> [!NOTE]
> The app is tested on Linux only. The macOS build packages, but it has not run on a Mac yet.

## Run from source

```shell
bun run --cwd apps/desktop start
```

On the first start, the app asks for the address of your server. Enter the address that `clots up` printed, for example `clots.your-tailnet.ts.net`. For a server on the same machine, enter `http://127.0.0.1:4587`.

To change the server later, use the menu **Server → Change Server…**.

## Build for macOS

On a Mac:

```shell
bun run --cwd apps/desktop package:mac
```

The `.dmg` files for Apple Silicon and Intel are in `apps/desktop/release`.

The build is not signed. macOS refuses an unsigned app from another machine. To run such a build, remove the quarantine flag and sign it for your own Mac:

```shell
xattr -cr clots.app
codesign --force --deep -s - clots.app
```

## What the app does

- It stores the server address in the app's user data directory (`config.json`).
- It shows only the clots server. Other links open in your default browser.
- It adds `clots-desktop/<platform>` to the user agent, so the web client can make room for the window buttons on macOS.
- It can open a sign-in window for a bot's browser. After you sign in and close the window, the app gives only that site's cookies to the bot's browser.
