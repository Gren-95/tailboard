#!/bin/sh
# Fix /data ownership if the volume was created as root (handles pre-existing volumes)
chown -R node:node /data
exec su-exec node node /app/src/server.js
