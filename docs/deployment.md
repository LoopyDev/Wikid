# Deploying Wikid to a server

Runs the whole stack on one Linux server with Docker, behind [Caddy](https://caddyserver.com/), which gets and renews a Let's Encrypt HTTPS certificate automatically.

```
internet ──80/443──▶ Caddy (HTTPS) ──▶ nginx (web) ──▶ API, collab server
                                                       └─▶ Postgres ×2, MinIO ×2 (internal only)
```

Only ports 80 and 443 are published. The databases and storage are reachable only inside Docker.

## Requirements

- A Linux server with Docker and Docker Compose v2, and at least 4 GB of RAM (2 GB works for light use)
- A domain or subdomain with a DNS **A record** pointing at the server
- Ports **80 and 443** open to the internet (Let's Encrypt checks port 80 when issuing the certificate)

## 1. Get the code

On the server:

```bash
git clone https://github.com/LoopyDev/Wikid.git
cd Wikid
```

## 2. Configure

```bash
cp .env.production.example .env
nano .env
```

Fill in every value:

| Setting | What to put |
| --- | --- |
| `WIKID_DOMAIN` | Your domain, e.g. `wiki.example.com` (no `https://`) |
| `WIKID_ADMIN_EMAIL`, `WIKID_ADMIN_PASSWORD` | Your login. Used once, when the database is first created |
| `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `COMPLIANCE_MINIO_ROOT_PASSWORD` | Generate each with `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | Optional; enables the AI features |

Notes:

- Use **hex** for the generated passwords (as `openssl rand -hex` produces); they go inside connection URLs, where some symbols break.
- Postgres and the admin login read their values **only when the database is first created**. Changing them in `.env` later has no effect. Change the admin password in the app instead.
- The session and collab secrets are generated on first start and kept in a Docker volume, unless you set them.
- `COMPOSE_FILE` in `.env` loads `docker-compose.prod.yml`, so plain `docker compose` commands use the production setup.

Keep `.env` private: `chmod 600 .env`.

## 3. Start

Check the DNS record first. This should print the server's IP:

```bash
dig +short wiki.example.com
```

Then:

```bash
docker compose up -d --build
```

The first build takes a few minutes. On first start, the API applies the database migrations and creates your admin account, and Caddy requests the certificate.

Open `https://wiki.example.com` and log in with `WIKID_ADMIN_EMAIL` / `WIKID_ADMIN_PASSWORD`.

Check everything is running:

```bash
docker compose ps
docker compose logs -f caddy     # certificate issuance; Ctrl+C to stop
```

## Updating

```bash
git pull
docker compose build --pull      # rebuild, fetching newer base images (security fixes)
docker compose up -d
docker image prune -f            # remove old images
```

`--pull` matters: without it, rebuilds reuse the base images (nginx, Node) downloaded the first time and never get their security updates. Run this every few weeks even when Wikid itself hasn't changed. `docker compose pull` does the same for the images that aren't built (Postgres, Silo, Caddy).

New database migrations are applied automatically when the API starts.

If the update changed `docker/caddy/Caddyfile`, restart Caddy too. The file is mounted into the container, so `up -d` doesn't pick up changes to it:

```bash
docker compose restart caddy
```

## Backups

`docker/backup.sh` dumps both databases and archives both MinIO stores into `./backups`, keeping 14 days:

```bash
./docker/backup.sh
```

Run it nightly with cron (`crontab -e`), adjusting the path:

```
0 3 * * * cd /home/deploy/Wikid && ./docker/backup.sh >> backups/backup.log 2>&1
```

Backups on the server don't survive losing the server. Copy them somewhere else, for example from your own machine:

```bash
rsync -av deploy@SERVER_IP:Wikid/backups/ ~/wikid-backups/
```

Or enable your provider's server backups (Hetzner and DigitalOcean offer them).

### Restoring

With the stack running (replace the timestamps):

```bash
# Databases
docker compose exec -T db pg_restore -U postgres -d wikid-tiptap --clean --if-exists < backups/wikid-STAMP.dump
docker compose exec -T compliance-db pg_restore -U postgres -d wikid-compliance --clean --if-exists < backups/wikid-compliance-STAMP.dump

# Files
docker run --rm --volumes-from "$(docker compose ps -q minio)" -v "$PWD/backups:/backup" alpine:3.20 \
  sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/minio-STAMP.tar.gz -C /data'
docker run --rm --volumes-from "$(docker compose ps -q compliance-minio)" -v "$PWD/backups:/backup" alpine:3.20 \
  sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/compliance-minio-STAMP.tar.gz -C /data'

docker compose restart api collab minio compliance-minio
```

## Useful commands

```bash
docker compose ps                    # status
docker compose logs -f api           # follow a service's logs
docker compose restart api           # restart one service
docker compose down                  # stop everything (keeps data)
```

`docker compose down -v` **deletes all data** (databases, uploads, certificates). Don't use `-v` unless you mean it.

## Troubleshooting

- **No certificate / browser warning:** check `docker compose logs caddy`. Usually the DNS record isn't pointing at the server yet, or port 80 is blocked by a firewall. Caddy retries on its own once fixed.
- **`required variable ... is missing a value`:** a setting in `.env` is empty.
- **Can't log in after changing `WIKID_ADMIN_PASSWORD`:** expected; it's only used when the database is first created. Use the password you started with, then change it in the app.
- **Firewalls:** Docker's published ports bypass `ufw`. A provider-level firewall (e.g. Hetzner Cloud Firewall) allowing only 22, 80 and 443 is the reliable way to restrict access.
