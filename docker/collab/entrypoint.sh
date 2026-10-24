#!/bin/sh
set -e

# Use the secrets the API generated unless they were provided
SECRETS_FILE=/state/secrets.env
if [ -f "$SECRETS_FILE" ]; then
  . "$SECRETS_FILE"
  for name in COLLAB_JWT_SECRET COLLAB_API_SECRET; do
    eval "current=\${$name:-}"
    if [ -z "$current" ] || [ "$current" = "change-me" ]; then
      eval "export $name=\$GENERATED_$name"
    fi
  done
fi

exec "$@"
