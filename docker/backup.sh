#!/bin/sh
# Back up both databases and both MinIO stores into ./backups (or $BACKUP_DIR).
# Keeps 14 days. Run from anywhere: ./docker/backup.sh
set -eu
cd "$(dirname "$0")/.."

DEST="${BACKUP_DIR:-./backups}"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "Backing up to $DEST ($STAMP)"
docker compose exec -T db pg_dump -U postgres -Fc wikid-tiptap > "$DEST/wikid-$STAMP.dump"
docker compose exec -T compliance-db pg_dump -U postgres -Fc wikid-compliance > "$DEST/wikid-compliance-$STAMP.dump"

for service in minio compliance-minio; do
  docker run --rm --volumes-from "$(docker compose ps -q "$service")" -v "$DEST:/backup" alpine:3.20 \
    tar czf "/backup/$service-$STAMP.tar.gz" -C /data .
done

find "$DEST" -type f \( -name '*.dump' -o -name '*.tar.gz' \) -mtime +14 -delete
echo "Done"
