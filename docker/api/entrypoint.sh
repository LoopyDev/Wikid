#!/bin/sh
set -e

# Generate any secrets that weren't provided, once, into a volume shared with the collab server
SECRETS_FILE=/state/secrets.env
if [ ! -f "$SECRETS_FILE" ]; then
  umask 077
  {
    echo "GENERATED_SESSION_SECRET=$(openssl rand -hex 32)"
    echo "GENERATED_COLLAB_JWT_SECRET=$(openssl rand -hex 32)"
    echo "GENERATED_COLLAB_API_SECRET=$(openssl rand -hex 32)"
  } > "$SECRETS_FILE"
fi
. "$SECRETS_FILE"
use_secret() {
  eval "current=\${$1:-}"
  if [ -z "$current" ] || [ "$current" = "change-me" ]; then
    eval "export $1=\$GENERATED_$1"
  fi
}
use_secret SESSION_SECRET
use_secret COLLAB_JWT_SECRET
use_secret COLLAB_API_SECRET

echo "Applying database migrations..."
npx prisma migrate deploy
npx prisma migrate deploy --config prisma.compliance.config.ts

# Seed the demo accounts only on a fresh database, so restarts don't reset passwords (the seed sets
# the admin's). Only an exit of 10 means "no users": any failure, which exits 1, stops startup
# instead, since seeding a database that has users would reset that password.
set +e
node -e "
const { PrismaClient } = require('@prisma/client');
const { pgAdapter } = require('./dist/src/prisma/pg-adapter.util');
new PrismaClient({ adapter: pgAdapter(process.env.DATABASE_URL) }).user.count()
  .then((n) => process.exit(n > 0 ? 0 : 10), (err) => { console.error(err); process.exit(1); });
"
users=$?
set -e
if [ "$users" -eq 10 ]; then
  echo "Seeding demo data..."
  # The compiled seed: the image has no TypeScript runner
  node dist/prisma/seed.js
elif [ "$users" -ne 0 ]; then
  echo "Couldn't check the database for users; not starting" >&2
  exit 1
fi

# Everything above needs root (the secrets volume, migrations). The API itself, and the Chromium it
# starts for PDF export, run as the unprivileged node user: Chromium can't use its own sandbox under
# Docker's default restrictions, so this limits what a compromised browser could reach.
exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all env HOME=/home/node "$@"
