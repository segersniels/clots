# Configuration

clots needs no configuration file. A few environment variables change where it keeps data and which port it uses.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLOTS_HOME` | `~/.clots` | The data directory |
| `CLOTS_PORT` | `4587` | The loopback port of the server |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | The Claude Code account that the bots use |
| `AGENT_BROWSER_EXECUTABLE_PATH` | the system Chromium or Chrome | The browser that the bots start |

`clots up` copies `PATH` and these variables from your shell into the background service. Run `clots up` again after you change one.

To use a second Claude account, log in with another config directory and start clots with it:

```shell
CLAUDE_CONFIG_DIR=~/.claude-work claude auth login
CLAUDE_CONFIG_DIR=~/.claude-work CLOTS_HOME=~/.clots-work CLOTS_PORT=4588 clots serve
```

## The data directory

```
~/.clots/
  clots.db            SQLite: bots, threads, messages, schedules, projects
  bots/<bot id>/      The working directory of one bot
    CLAUDE.md         The bot's own notes (the bot writes them)
    attachments/      The files that you sent to the bot
    .browser-profile/ The bot's browser profile, with its logins
  tailscale/          The state of the sidecar, and status.json
```

Back up the whole directory to keep your bots. The Claude Code session files are in the Claude config directory (`~/.claude/projects`), not in `~/.clots`.

## What the bots load

clots starts Claude Code with the setting sources `user`, `project` and `local`. Your bots therefore get your Claude Code skills, plugins, MCP servers and claude.ai connectors, and your permission rules from `~/.claude/settings.json`.

## Permissions

Bots run in the permission mode `auto`. A classifier in Claude Code allows or denies each tool call. Only when it cannot decide, the call goes to you as an approval in the thread. The `AskUserQuestion` tool is off, so a bot asks its questions in plain chat.
