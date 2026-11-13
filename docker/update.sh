#!/bin/sh
# Update this Wikid to the newest commit of its branch: moves the checkout forward, rebuilds with
# fresh base images, backs up (when there's something new: the API applies database migrations as
# it starts), and restarts, waiting until it's healthy. Run from anywhere:
#   ./docker/update.sh               update
#   ./docker/update.sh --check       show what an update would bring, and change nothing
#   ./docker/update.sh --no-backup   update without backing up first (one was just taken)
# With nothing new it still rebuilds: the base images (nginx, Node, Postgres...) get security fixes.
# Backups go where docker/backup.sh puts them (./backups, or $BACKUP_DIR).
set -eu
cd "$(dirname "$0")/.."

CHECK=0
BACKUP=1
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --no-backup) BACKUP=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Database migrations among the changes between two commits
has_migrations() {
  ! git diff --quiet "$1" "$2" -- api/prisma/migrations api/prisma/compliance/migrations
}

# First pass: look, and move the checkout forward. Then this script runs again from the new
# commit (WIKID_UPDATE_FROM says where it was), so a newer update.sh does the rest: carrying on in
# this one, the shell could read on into the new file's text from where it was in the old.
if [ -z "${WIKID_UPDATE_FROM:-}" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "This checkout has changes of its own (git status lists them). Commit, stash or remove them first." >&2
    exit 1
  fi
  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    echo "This checkout isn't on a branch that follows one on GitHub (git status says which)." >&2
    exit 1
  fi
  git fetch --quiet
  FROM="$(git rev-parse HEAD)"
  TO="$(git rev-parse '@{upstream}')"
  # Only ever moved forward to the branch's newest commit: never a merge made on the server
  if ! git merge-base --is-ancestor "$FROM" "$TO"; then
    echo "This checkout has commits the branch doesn't (git log @{upstream}..HEAD lists them), so it can't simply move forward. Nothing was changed." >&2
    exit 1
  fi

  if [ "$FROM" = "$TO" ]; then
    echo "Already at the newest commit ($(git log -1 --format='%h %s'))."
  else
    echo "New commits:"
    git log --format='  %h %s' "$FROM..$TO"
    if has_migrations "$FROM" "$TO"; then
      echo "These include database migrations: they're applied as the API starts, and can't be undone except by restoring a backup."
    fi
  fi
  if [ "$CHECK" = 1 ]; then
    echo "(--check: nothing was changed)"
    exit 0
  fi
  if [ "$FROM" != "$TO" ]; then
    git merge --quiet --ff-only "$TO"
    WIKID_UPDATE_FROM="$FROM" exec sh ./docker/update.sh "$@"
  fi
fi

# Second pass (or the first, with nothing new): rebuild, back up, restart
FROM="${WIKID_UPDATE_FROM:-$(git rev-parse HEAD)}"
FROM_SHORT="$(git rev-parse --short "$FROM")"
STAMP=""

# Stopped part-way (a build or a migration failing, say): how to get back to where it was
explain_going_back() {
  echo "To go back to $FROM_SHORT:"
  echo "  git reset --hard $FROM_SHORT"
  echo "  docker compose build"
  if [ -n "$STAMP" ] && has_migrations "$FROM" HEAD; then
    echo "  ./docker/restore.sh $STAMP     (the data from before the update; it starts everything again)"
  elif has_migrations "$FROM" HEAD; then
    echo "  ./docker/restore.sh STAMP      (a backup from before the update: a migration came in, and the"
    echo "                                  old code may not run on the migrated data; ./docker/restore.sh lists them)"
  else
    [ -n "$STAMP" ] && echo "  (if the data needs to go back too: ./docker/restore.sh $STAMP)"
    echo "  docker compose up -d --wait"
  fi
  if ! git diff --quiet "$FROM" HEAD -- docker/caddy/Caddyfile; then
    echo "  docker compose restart caddy"
  fi
}
on_exit() {
  status=$?
  [ "$status" = 0 ] && return
  echo "The update stopped part-way (see above)." >&2
  if [ "$FROM" != "$(git rev-parse HEAD)" ]; then
    explain_going_back >&2
  fi
}
trap on_exit EXIT

echo "Rebuilding (with fresh base images)..."
docker compose pull --quiet --ignore-buildable
docker compose build --pull

# Backed up only now, once the build has worked: the closer to the migrations, the less that's
# written meanwhile and missing from it
if [ "$FROM" != "$(git rev-parse HEAD)" ] && [ "$BACKUP" = 1 ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_STAMP="$STAMP" ./docker/backup.sh
fi

docker compose up -d --wait

# The Caddyfile is mounted into its container, so a changed one needs a restart to count. Checked
# first: Caddy failing to start on a broken one would take the whole site down
if ! git diff --quiet "$FROM" HEAD -- docker/caddy/Caddyfile && docker compose config --services | grep -qx caddy; then
  echo "Checking the new Caddyfile"
  if ! docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    # The rest went in: nothing to go back on, only the Caddyfile to fix
    trap - EXIT
    echo "Updated, but the new Caddyfile doesn't work, so Caddy keeps running the old one. Fix it, then: docker compose restart caddy" >&2
    exit 1
  fi
  docker compose restart caddy
  docker compose up -d --wait caddy
fi
docker image prune -f >/dev/null

echo "Updated: now at $(git log -1 --format='%h %s')."
if [ "$FROM" != "$(git rev-parse HEAD)" ]; then
  if [ -n "$STAMP" ]; then
    echo "Backed up first, as $STAMP."
  else
    echo "No backup was taken (--no-backup)."
  fi
  explain_going_back
fi
