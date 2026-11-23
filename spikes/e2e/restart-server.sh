#!/usr/bin/env bash
# Restarts the clots server on its port. Usage: CLOTS_HOME=<dir> restart-server.sh
port="${CLOTS_PORT:-4587}"
pid="$(ss -ltnpH "sport = :$port" | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -1)"
[ -n "$pid" ] && kill "$pid" && sleep 1
cd "$(dirname "$0")/../../apps/server" && nohup bun src/cli.ts serve >> "$CLOTS_HOME.log" 2>&1 &
sleep 2
