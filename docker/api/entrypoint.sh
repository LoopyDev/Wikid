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
npx prisma migrate deploy --schema prisma/compliance/schema.prisma

# Seed the demo accounts only on a fresh database, so restarts don't reset passwords
if ! node -e "new (require('@prisma/client').PrismaClient)().user.count().then((n) => process.exit(n > 0 ? 0 : 1), () => process.exit(1))"; then
  echo "Seeding demo data..."
  # The compiled seed: the image has no TypeScript runner
  node dist/prisma/seed.js
fi

exec "$@"
