#!/bin/bash
set -euo pipefail

playground &
GO_PID=$!

node /app/scripts/static-server.js &
STATIC_PID=$!

node /app/app/dist/index.js &
NODE_PID=$!

trap 'kill -TERM $GO_PID $STATIC_PID $NODE_PID 2>/dev/null; wait' INT TERM

wait -n $GO_PID $STATIC_PID $NODE_PID
exit $?
