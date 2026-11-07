#!/bin/sh
# Restore a backup made by docker/backup.sh: both databases and both MinIO stores. Everything in
# this stack is replaced by the backup's. Run from anywhere:
#   ./docker/restore.sh                    lists the backups there are
#   ./docker/restore.sh 20261107-030002    restores that one, after asking
# Reads from ./backups, or $BACKUP_DIR. --yes skips the question (for scripts and tests).
set -eu
cd "$(dirname "$0")/.."

SRC="${BACKUP_DIR:-./backups}"
STAMP=""
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) STAMP="$arg" ;;
  esac
done

if [ -z "$STAMP" ]; then
  echo "Backups in $SRC (newest last):"
  found=0
  for dump in "$SRC"/wikid-[0-9]*.dump; do
    [ -e "$dump" ] || continue
    found=1
    name="$(basename "$dump" .dump)"
    echo "  ${name#wikid-}"
  done
  [ "$found" = 1 ] || echo "  (none)"
  echo "Restore one with: $0 STAMP"
  exit 0
fi

# A night's backup is four files; with one missing or empty, it isn't a whole backup
missing=0
for file in "wikid-$STAMP.dump" "wikid-compliance-$STAMP.dump" "minio-$STAMP.tar.gz" "compliance-minio-$STAMP.tar.gz"; do
  if [ ! -s "$SRC/$file" ]; then
    echo "Missing or empty: $SRC/$file" >&2
    missing=1
  fi
done
[ "$missing" = 0 ] || { echo "Not restoring an incomplete backup." >&2; exit 1; }
SRC="$(cd "$SRC" && pwd)"

if [ -z "$(docker compose ps -aq db)" ]; then
  echo "This stack hasn't been started here yet. Start it first: docker compose up -d --wait" >&2
  exit 1
fi

if [ "$ASSUME_YES" != 1 ]; then
  project="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"
  echo "This replaces ALL of this Wikid's pages, users, databases and uploaded files"
  echo "(Docker project \"$project\") with the backup from $STAMP."
  printf 'Type "restore" to go ahead: '
  read -r answer
  [ "$answer" = "restore" ] || { echo "Nothing changed."; exit 1; }
fi

# Anything stopping it part-way leaves the services stopped; say how to start them again
trap 'echo "Restore stopped part-way. Start the services again with: docker compose up -d --wait" >&2' EXIT

# Nothing may write while the data is swapped. The live-editing server holds open pages in memory
# and would save them back over the restored ones, so it goes before the databases are touched.
echo "Stopping the API and live editing"
docker compose stop api collab
docker compose up -d --wait db compliance-db

# Each database is restored into a new one first, and swapped in only once that's worked: a failed
# restore leaves the current data as it was. Starting from an empty database (not restoring over the
# current one) leaves nothing behind that the backup doesn't have.
restore_db() {
  service="$1" name="$2" dump="$3"
  echo "Restoring database $name"
  docker compose exec -T "$service" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "SET client_min_messages = warning" \
    -c "DROP DATABASE IF EXISTS \"$name-restoring\"" -c "CREATE DATABASE \"$name-restoring\""
  docker compose exec -T "$service" pg_restore -U postgres -d "$name-restoring" --no-owner --single-transaction < "$dump"
  docker compose exec -T "$service" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qc \
    "DROP DATABASE \"$name\" WITH (FORCE)" -c "ALTER DATABASE \"$name-restoring\" RENAME TO \"$name\""
}
restore_db db wikid-tiptap "$SRC/wikid-$STAMP.dump"
restore_db compliance-db wikid-compliance "$SRC/wikid-compliance-$STAMP.dump"

echo "Restoring uploaded files"
docker compose stop minio compliance-minio
for service in minio compliance-minio; do
  docker run --rm --volumes-from "$(docker compose ps -aq "$service")" -v "$SRC:/backup:ro" alpine:3.20 \
    sh -c "find /data -mindepth 1 -delete && tar xzf /backup/$service-$STAMP.tar.gz -C /data"
done

echo "Starting everything again"
docker compose up -d --wait
trap - EXIT
echo "Restored the backup from $STAMP"
