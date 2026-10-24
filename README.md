# Wikid

A self-hosted wiki and workspace with a block-based editor, structured databases, real-time collaboration, and built-in compliance workflows for records that need an audit trail.

> **Status: early development, not production-ready.** See [Security](#security) before deploying anywhere reachable from the internet.

## Features

**Pages and editor**
- Nested pages in multiple workspaces, with emoji/icon picker and public/private visibility
- Tiptap-based block editor with `/` slash commands
- Callouts, toggle headings, multi-column layouts, tables, code blocks, table of contents
- Page links, link previews, resizable images, draw.io diagrams, Gaussian splat embeds
- HTML and PDF export

**Databases**
- Inline databases with Text, Number, Date, Checkbox, Select, Multi-select, URL, and Relation fields
- Table view with inline editing, filtering, and sorting
- Forms that submit rows straight into a database, each with its own QR code
- Starter templates for inventory, maintenance, and assignments

**Compliance**
- A separate, append-only compliance database for regulated records
- Versioned schemas and configurable workflows (Draft → Submitted → In Review → Closed/Sealed by default) with role and approval guards
- Isolated attachment storage with hash verification on export

**Collaboration and AI**
- Real-time co-editing over Yjs and Hocuspocus, periodically written back to Postgres
- Optional Claude-powered writing tools: generate with `/AI`, improve/summarise/shorten/expand a selection, change tone, or chat about the current page in a side panel
- An MCP server (`mcp/`) so AI tools can read and create workspace pages (set `WIKID_API_URL`, `WIKID_EMAIL`, and `WIKID_PASSWORD`)

**Administration**
- Email + password login, self-service password change
- Admin panels for users, workspaces, and collaboration state

## Stack

| Part | Tech |
| --- | --- |
| API (`api/`) | NestJS, Prisma, PostgreSQL |
| Frontend (`web/`) | Vue 3, Pinia, Vite, Tiptap v3 |
| Collab server (`collab/`) | Hocuspocus, Yjs |
| MCP server (`mcp/`) | Model Context Protocol SDK |
| Storage | S3-compatible (MinIO for local dev) |

The repo is an npm workspace: one `npm install` at the root installs every package.

See [`docs/architecture/overview.md`](docs/architecture/overview.md) for how the pieces fit together.

## Quick start (Docker)

Requirements: Docker with Compose v2.

```bash
docker compose up -d --build
```

Open http://localhost:8088 and log in as `admin@wikid.local` with password `wikid`. The first build takes a few minutes.

On first start, the stack runs the database migrations, seeds the demo accounts, and generates the session and collab secrets into the `app-state` volume. nginx serves the app, the API (`/api`), and the collab server (`/collab`) from one origin.

Optional settings go in a `.env` file next to `docker-compose.yml`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WIKID_PORT` | `8088` | Host port for the app |
| `WIKID_PUBLIC_URL` | `http://localhost:8088` | URL people use to reach the app (used for CORS and upload links) |
| `SESSION_COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `ANTHROPIC_API_KEY` | | Enables the AI features |
| `SESSION_SECRET`, `COLLAB_JWT_SECRET`, `COLLAB_API_SECRET` | generated | Set to use your own secrets |

Only port 8088 is published. The databases and MinIO stay on Docker's internal network.

`docker compose down` stops the stack and keeps your data. `docker compose down -v` also deletes the data.

To run it on a server with HTTPS, your own admin login and backups, see [`docs/deployment.md`](docs/deployment.md).

## Development setup

Requirements: Node.js 20+, Docker.

```bash
# 1. Configure environment
cp .env.example .env               # Docker Compose settings
cp api/.env.example api/.env
cp collab/.env.example collab/.env
cp web/.env.example web/.env
# Set SESSION_SECRET in api/.env, and set COLLAB_JWT_SECRET and COLLAB_API_SECRET
# to the same values in api/.env and collab/.env. Generate each with:
#   openssl rand -hex 32

# 2. Start Postgres (x2) and MinIO (x2). COMPOSE_FILE in .env adds docker-compose.dev.yml,
#    which publishes them on localhost (5435, 5436, 9000-9003)
docker compose up -d db compliance-db minio compliance-minio minio-init compliance-minio-init

# 3. Install dependencies (all packages)
npm install

# 4. Set up the databases
npm run prisma:generate -w api
npm run prisma:generate:compliance -w api
npm run prisma:migrate -w api
npm run prisma:migrate:compliance -w api
npm run prisma:seed -w api

# 5. Run everything (three terminals)
npm run dev:api      # API on http://localhost:3000
npm run dev:collab   # collab server on ws://localhost:1234
npm run dev:web      # app on http://localhost:5173
```

Log in with one of the seeded demo accounts: `admin@wikid.local`, `alice@wikid.local`, or `bob@wikid.local`. They all use the password `wikid`.

To enable the AI features, set `ANTHROPIC_API_KEY` in `api/.env`. Without it, the AI endpoints return 503 and the rest of the app works normally.

For the compliance database's optional immutability guards, see [`docs/compliance/setup.md`](docs/compliance/setup.md).

### Checks

```bash
npm test             # web unit tests
npm run typecheck    # API and collab server
npm run build        # web production build
```

CI runs these, plus a Docker image build, on every push to `main` and every pull request.

## Security

Wikid hasn't had a security review yet. How it works today:

- **Sessions:** logging in sets a signed, `HttpOnly`, `SameSite=Lax` session cookie (14 days). A global guard rejects any API request without a valid session, and every request acts as the logged-in user, whatever user ID the client sends.
- **Frontend and API location:** the frontend and API must be on the same site (for example `wiki.example.com` and `api.wiki.example.com`) so the browser sends the cookie. Set `CORS_ORIGINS` to your frontend's URL and serve both over HTTPS in production.
- **Defaults:** the dev setup uses well-known defaults (`postgres`/`postgres`, `minioadmin`/`minioadmin`, demo accounts with the password `wikid`). The production setup in [`docs/deployment.md`](docs/deployment.md) requires your own passwords and admin login, and creates no demo accounts.

If you find a security issue, please open a private security advisory on GitHub instead of a public issue.

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first so we can talk through the approach. Architecture and feature docs live in [`docs/`](docs/).

## License

Wikid is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must make your source changes available to its users.

Icons are from [Bootstrap Icons](https://icons.getbootstrap.com/) (MIT). They're loaded from the `bootstrap-icons` npm package, which includes its license.

### Name

The license covers the code, not the name. "Wikid" refers to this project. If you publish or host a fork, please give it a different name, and don't present it as the official Wikid.
