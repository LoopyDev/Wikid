# Features and status

What Wikid does today, and how much to rely on each part. Wikid is in early development; see the
[README](../README.md#security) before deploying it anywhere reachable from the internet.

| Status | Meaning |
|---|---|
| **Stable** | Works, and automated tests cover it. |
| **Beta** | Works, but with little or no automated testing, or very new. Expect rough edges. |
| **Experimental** | Early. May change, break or be removed. |
| **Planned** | Not built yet. |

## Pages and organisation

| Feature | Status | Notes |
|---|---|---|
| Nested pages, reordering, moving pages between workspaces | Stable | |
| Workspaces with Owner, Editor and Viewer roles | Stable | |
| Private and public pages | Stable | Private pages are visible to their author only. |
| Bin: restore, or delete for good | Stable | |
| Page history: versions with who edited them, what each changed, restoring a version | Beta | New. A version is an editing session (saves less than 5 minutes apart, up to 30 minutes). Changes are marked block by block (added, changed, removed), not word by word. Kept from the first edit after updating. Database pages have no history yet. |
| Live sidebar: pages others create, rename, move or delete appear without reloading | Stable | |
| Search (⌘K / Ctrl+K) across page titles, page text and database rows | Beta | New. Only shows what you can see. Text edited live becomes searchable within a few minutes. Word matching assumes English. |
| Wikis: a page as a wiki home with a database of its pages | Beta | |
| Split view: two pages side by side | Beta | |

## Editor

| Feature | Status | Notes |
|---|---|---|
| Paragraphs, headings, bulleted, numbered and to-do lists, indenting | Stable | |
| Markdown shortcuts while typing, and pasting Markdown | Stable | |
| Slash menu, block menu (turn into, colour, delete), dragging blocks, selected-text toolbar | Stable | |
| Code blocks with syntax highlighting | Beta | |
| Tables, callouts, columns, toggle headings, dividers, table of contents | Beta | |
| Images: upload, paste or drop (with upload progress), resize, and a full-screen viewer | Beta | |
| Page links and link previews | Beta | |
| Synced blocks: one block shown on several pages, kept in step | Beta | |
| Database views and forms inside a page | Beta | A view's title, controls, and add row and column buttons can each be hidden from its block menu. |
| draw.io diagrams | Experimental | |
| Gaussian splat (3D scan) embeds | Experimental | |

## Live collaboration

| Feature | Status | Notes |
|---|---|---|
| Editing a page together in real time | Beta | Tested with two people, including both typing in the same line. Includes an unreleased upstream fix for a cursor bug ([tiptap#8594](https://github.com/ueberdosis/tiptap/issues/8594)), applied in `web/vite.config.js` until y-tiptap releases it. |
| Who's here: avatars, cursors, and which database cell someone is editing | Beta | |
| A notice when someone else moves the page you have open to the Bin, with Restore | Stable | |

## Databases

| Feature | Status | Notes |
|---|---|---|
| Table view with inline editing | Stable | |
| Field types: text, number, date, checkbox, select, multi-select, URL, relation | Stable | Also asset tags and "last edited" fields. |
| Person columns: workspace members, one or several | Beta | Filter by "is me"; a form can fill one in with whoever submits it. |
| "Created by" columns: who added each row | Beta | Read-only. Rows added before it existed show no one. |
| Each row opens as its own page | Stable | |
| Relations between databases, with backlinks | Beta | A "Linked from" column shows a relation's other side (read-only; edit the link from the other database). |
| Saved views with filters and sorts | Stable | |
| Board, gallery and list views | Beta | |
| Forms: builder, submissions straight into the database | Beta | |
| Asset tag columns, with a QR code of each row's tag | Beta | The QR code holds the tag's text, not a link to the row. Not tested yet. |
| Starter templates: inventory, maintenance, assignments | Beta | |
| Live editing of tables with others | Beta | |

## Compliance

| Feature | Status | Notes |
|---|---|---|
| Compliance databases: append-only records in a separate database, versioned schemas, workflows (Draft → Submitted → In Review → Closed/Sealed) with role and approval guards, audit trail, hash-checked attachments | Experimental | Only switching a database to compliance mode has automated tests so far. |

## Export

| Feature | Status | Notes |
|---|---|---|
| HTML export of a page tree or a whole workspace | Stable | |
| Markdown export of a page or a whole workspace, with uploaded images in a zip | Beta | Callouts and quotes become Markdown quotes; columns come one after another. |
| PDF export | Beta | |

## Accounts and administration

| Feature | Status | Notes |
|---|---|---|
| Log in with email or username, and password | Stable | Usernames are optional and set by the admin. |
| Admin: create, edit, reset the password of, and delete users | Stable | |
| People the admin set a password for choose their own when they first log in | Stable | |
| Change your own password | Stable | |
| Failed logins limited, so passwords can't be guessed at speed | Stable | 5 per account from one address, 20 per account and 100 per address, over 15 minutes. |
| Admin settings (turn AI features on or off for everyone) | Stable | |
| Nightly backups, and restoring one with a single command (`docker/backup.sh`, `docker/restore.sh`) | Stable | Tested in CI on every change. See [deployment](deployment.md#restoring). |
| Dark and light themes | Beta | |

## AI (optional)

| Feature | Status | Notes |
|---|---|---|
| Writing tools: AI Writer, improve/summarise/shorten/expand a selection, AI side panel | Beta | Needs `ANTHROPIC_API_KEY` on the server. The AI responses themselves aren't covered by automated tests. |
| Turning AI off: hidden when not set up, an admin switch, and a personal setting | Stable | |
| Page content as Markdown through the API, read and changed block by block | Beta | New. For tools such as the MCP server: blocks Markdown can't hold (columns, database views) are left as they are. Changes reach a page open in the editor straight away. |
| MCP server (`mcp/`) so AI tools such as Claude Code can work in a workspace | Experimental | Lists workspaces, pages and database rows, and creates and renames pages. Page text comes back empty (it reads a table the editor no longer uses), and new pages can't be given content yet: being reworked, see Planned. Logs in with an email and password. |

## Planned

First, making what's here solid: more automated tests (especially for Beta features), checks that every API
route only lets the right people in, and two-factor authentication. Then, roughly in this order:

1. A reworked MCP server: read pages as Markdown, search, and create and edit pages and database rows (Markdown turned into page content on the server)
2. Personal API tokens, so tools like the MCP server don't need your password
3. Import from Markdown: files, or a zip of folders with images, previewed before importing
4. Page templates
5. Groups and teams for permissions
6. Admin audit log (logins, permission changes, deletions, exports)
7. Comments and @mentions, with notifications
8. Read-only share links
9. Single sign-on (OIDC: Google, Microsoft Entra, Okta, Keycloak, Authentik)
10. Page owners and "last reviewed" dates
11. Later: invite links, optional email (invites, password reset), and open sign-up behind an admin switch
