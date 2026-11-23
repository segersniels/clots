# Contributing

Thank you for your interest in clots. This page explains how to run the project on your machine and what a change must pass.

## Set up

Install the tools from [Installing & building](./install.md#requirements) and log in to Claude (`claude auth login`). Then:

```shell
git clone https://github.com/segersniels/clots.git
cd clots
bun install
```

## Run it locally

```shell
bun run dev
```

This starts two processes:

- The server with reload on `http://127.0.0.1:4587`.
- Vite with hot reload on `http://127.0.0.1:5173`. Open this one. It forwards `/rpc`, `/browser` and `/attachments` to the server.

In this mode the sidecar forwards to Vite, not to the server. Your tailnet address (`https://clots.<your-tailnet>.ts.net`) and a desktop app that points at it therefore also get hot reload. The address `http://127.0.0.1:4587` keeps serving the last build from `apps/web/dist`, so do not use it while you develop.

Run `bun run dev` in the repository root. The `dev` script of `apps/server` alone starts no Vite, and then serves the last build.

A change in the server code restarts the server and the sidecar. The bots' sessions stop and resume with the next message.

Use a separate data directory while you develop, so that your test bots stay away from your real ones:

```shell
CLOTS_HOME=/tmp/clots-dev bun run dev
```

The bots you create are real Claude Code sessions. They use your Claude subscription.

To run the built client the way a user does:

```shell
bun run build
bun run start
```

To work on the desktop app, start the server, then:

```shell
bun run --cwd apps/desktop start
```

The sidecar starts with the server when its binary is built. It prints a Tailscale login link and waits. You can ignore it for work that does not touch remote access.

## Checks

Run these before you open a pull request. All of them must pass.

```shell
bun run lint
bun run typecheck
bun run test
bun run build
```

| Task | Tool |
| --- | --- |
| `lint` | `oxlint` for TypeScript, `go vet` for the sidecar |
| `typecheck` | `tsc --noEmit` in each package |
| `test` | `bun test` |
| `build` | Vite for the web client, `go build` for the sidecar |

## End-to-end scripts

`spikes/e2e` has scripts that drive a running server through the client runtime. They use real Claude sessions.

```shell
cd spikes/e2e
bun chat.ts create "Scout" "Say hello."    # create a bot and chat
bun chat.ts send <botId> "And again."      # continue the thread
bun routine.ts <botId>                     # add a routine and wait for its run
bun browser.ts <botId>                     # browser, stream and handoff
bun model.ts <botId> haiku                 # switch the model
bun seed.ts                                # fill a new server with sample bots
```

## Where to make a change

| Change | Place |
| --- | --- |
| A new field or RPC | `packages/contracts`, then the server handler and `packages/client-runtime` |
| Server behavior | `apps/server/src` |
| A database change | A new migration in `apps/server/src/persistence/Migrations.ts`. Do not edit a migration that is already released. |
| Client state and connection | `packages/client-runtime` |
| The interface | `apps/web/src` |

See [Architecture](./architecture.md) for how the parts fit.

## Conventions

- **Runtime:** Bun is the runtime and the package manager. Do not add another one.
- **Effect:** use Effect 4 for services, errors, SQL and RPC. Define a service with `Context.Service` and a static `layer`.
- **Interface:** use shadcn components for each control. Add one with `bunx shadcn@latest add <name>` in `apps/web`. Prefer the composition of compound parts over one large component with many props.
- **Motion:** animate only `transform` and `opacity`, use the `ease-out` token, stay under 300 ms, and respect `prefers-reduced-motion`.
- **Comments:** write why, not what. Use JSDoc above functions, types and module constants.
- **Tests:** add a test with each behavior change that a test can prove. Keep it in the same commit.
- **Claude login only:** do not add API key support. clots never reads or stores Claude tokens.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): description`, in lowercase imperative mood. The scopes are the package names: `server`, `web`, `desktop`, `sidecar`, `contracts`, `client-runtime`, `character`.
- Keep one change per commit, so that a reviewer can read and revert it alone.
- In the pull request, say what changed and why. Keep the change small and complete.

## Copied code

If you copy code or a file from another project nearly unchanged, credit the project in a comment. When its license requires the notice to travel with the copy, put the license file next to the copy, as `apps/web/src/assets/fonts/OFL.txt` does for the Allo font.
