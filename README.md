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
- An MCP server (`mcp/`) so AI tools can read and create workspace pages

**Administration**
- Email + password login, self-service password change
- Admin panels for users, workspaces, and collaboration state

## Stack

| Part | Tech |
| --- | --- |
| API (`src/`) | NestJS, Prisma, PostgreSQL |
| Frontend (`web/`) | Vue 3, Pinia, Vite, Tiptap v3 |
| Collab server (`collab/`) | Hocuspocus, Yjs |
| Storage | S3-compatible (MinIO for local dev) |

See [`Docs/Architecture/architecture.md`](Docs/Architecture/architecture.md) for how the pieces fit together.

## Getting started

Requirements: Node.js 20+, Docker.

```bash
# 1. Configure environment
cp .env.example .env
cp collab/.env.example collab/.env
cp web/.env.example web/.env
# Set COLLAB_JWT_SECRET and COLLAB_API_SECRET to the same random values in .env and collab/.env:
#   openssl rand -hex 32

# 2. Start Postgres (x2) and MinIO (x2)
docker compose up -d db compliance-db minio compliance-minio minio-init compliance-minio-init

# 3. Install dependencies
npm install
(cd web && npm install)
(cd collab && npm install)

# 4. Set up the databases
npm run prisma:generate
npm run prisma:generate:compliance
npm run prisma:migrate
npm run prisma:migrate:compliance
npm run prisma:seed

# 5. Run everything (three terminals)
npm run start:dev            # API on http://localhost:3000
(cd collab && npm run dev)   # collab server on ws://localhost:1234
(cd web && npm run dev)      # app on http://localhost:5173
```

Log in with one of the seeded demo accounts: `admin@wikid.local`, `alice@wikid.local`, or `bob@wikid.local`. They all use the password `wikid`.

To enable the AI features, set `ANTHROPIC_API_KEY` in `.env`. Without it, the AI endpoints return 503 and the rest of the app works normally.

For the compliance database's optional immutability guards, see [`Docs/Compliance/setup.md`](Docs/Compliance/setup.md).

### Tests

```bash
cd web && npm test
```

## Security

Wikid is not hardened yet. Before running it anywhere other than your own machine, be aware that:

- **The API does not enforce authentication.** Login checks a password, but later requests identify the user by an ID the client sends, so anyone who can reach the API can act as any user, including the admin.
- **The defaults are for local dev only:** `postgres`/`postgres` for the databases, `minioadmin`/`minioadmin` for MinIO, and `wikid` for the seeded accounts.
- CORS is hard-coded to `localhost` in `src/main.ts`.

Adding a proper session or token guard to the API is the top priority on the roadmap. If you find a security issue, please open a private security advisory on GitHub instead of a public issue.

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first so we can talk through the approach. Design notes and feature plans live in [`Docs/`](Docs/).

## License

Wikid is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must make your source changes available to its users.

Icons are from [Bootstrap Icons](https://icons.getbootstrap.com/) (MIT). See [`web/src/icons/LICENSE`](web/src/icons/LICENSE).

### Name

The license covers the code, not the name. "Wikid" refers to this project. If you publish or host a fork, please give it a different name, and don't present it as the official Wikid.
