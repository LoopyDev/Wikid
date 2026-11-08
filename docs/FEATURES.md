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
| Page templates: a workspace's own, your own (in every workspace) and four built-in ones; start a new page from one, or save a page (with its subpages) as one | Beta | New. Images become image placeholders saying what goes there; database views and forms, page links and Gaussian splats are left out, since they belong to one workspace. Database pages can't be templates. |
| Live sidebar: pages others create, rename, move or delete appear without reloading | Stable | |
| Search (⌘K / Ctrl+K) across page titles, page text and database rows | Beta | New. Only shows what you can see. Text edited live becomes searchable within a few minutes. Word matching assumes English. |
| Wikis: a page as a wiki home with a database of its pages | Beta | |
| Split view: two pages side by side | Beta | |

## Editor

| Feature | Status | Notes |
|---|---|---|
| Paragraphs, headings, bulleted, numbered and to-do lists, indenting | Stable | |
| Markdown shortcuts while typing, and pasting Markdown | Stable | Pasted Markdown is read by Tiptap's Markdown extension (`@tiptap/markdown`, an early release): to-dos and tables included. To-dos nested under a numbered item come out wrong, an upstream bug. |
| Slash menu, block menu (turn into, colour, delete), dragging blocks, selected-text toolbar | Stable | |
| Code blocks with syntax highlighting | Beta | |
| Tables, callouts, columns, toggle headings, dividers, table of contents | Beta | |
| Images: upload, paste or drop (with upload progress), resize, and a full-screen viewer | Beta | |
| Image placeholders: say which image goes here, and Upload puts it in | Beta | New. Used by templates in place of images. |
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
| Page content as Markdown through the API, read and changed block by block | Beta | New. For tools such as the MCP server: columns and toggle headings as `::: columns` / `::: toggle` sections, and blocks Markdown can't hold (database views, colours) left as they are. Changes reach a page open in the editor straight away. |
| MCP server (`mcp/`) so AI tools such as Claude Code can work in a workspace | Beta | Search; read pages as Markdown and change them block by block, columns and toggle headings included (as `::: columns` and `::: toggle` sections); create and rename pages; read and change database rows. Tested by running it against a live stack. Runs locally and logs in with a password for now (stored in the AI tool's settings). See [mcp/README.md](../mcp/README.md). |

## Planned

First, making what's here solid: more automated tests (especially for Beta features), checks that every API
route only lets the right people in, and two-factor authentication. Then, roughly in this order:

1. Connecting Claude by signing in: a remote MCP server with OAuth, so nothing runs locally and no password is stored
2. Import from Markdown: files, or a zip of folders with images, previewed before importing
3. Groups and teams for permissions
4. Admin audit log (logins, permission changes, deletions, exports)
5. Comments and @mentions, with notifications
6. Read-only share links
7. Single sign-on (OIDC: Google, Microsoft Entra, Okta, Keycloak, Authentik)
8. Page owners and "last reviewed" dates
9. Later: invite links, optional email (invites, password reset), and open sign-up behind an admin switch
