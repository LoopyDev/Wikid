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
| Images: upload and resize | Beta | |
| Page links and link previews | Beta | |
| Synced blocks: one block shown on several pages, kept in step | Beta | |
| Database views and forms inside a page | Beta | |
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
| Each row opens as its own page | Stable | |
| Relations between databases, with backlinks | Beta | A "Linked from" column shows a relation's other side (read-only; edit the link from the other database). |
| Saved views with filters and sorts | Stable | |
| Board and gallery views | Beta | |
| Forms: builder, submissions straight into the database, QR codes | Beta | The builder and submissions are tested; QR codes aren't. |
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
| Markdown export | Beta | |
| PDF export | Beta | |

## Accounts and administration

| Feature | Status | Notes |
|---|---|---|
| Log in with email or username, and password | Stable | Usernames are optional and set by the admin. |
| Admin: create, edit, reset the password of, and delete users | Stable | |
| People the admin set a password for choose their own when they first log in | Stable | |
| Change your own password | Stable | |
| Admin settings (turn AI features on or off for everyone) | Stable | |
| Dark and light themes | Beta | |

## AI (optional)

| Feature | Status | Notes |
|---|---|---|
| Writing tools: AI Writer, improve/summarise/shorten/expand a selection, AI side panel | Beta | Needs `ANTHROPIC_API_KEY` on the server. The AI responses themselves aren't covered by automated tests. |
| Turning AI off: hidden when not set up, an admin switch, and a personal setting | Stable | |
| MCP server (`mcp/`) so AI tools can read and create pages | Experimental | |

## Planned

First, making what's here solid: more automated tests (especially for Beta features), checks that every API
route only lets the right people in, rate limiting on login, and two-factor authentication. Then, roughly in this order:

1. A documented, tested restore from backups
2. Page history: versions, who changed what, restoring a version
3. Import from Markdown
4. Page templates
5. Groups and teams for permissions
6. Admin audit log (logins, permission changes, deletions, exports)
7. Comments and @mentions, with notifications
8. Read-only share links
9. Single sign-on (OIDC: Google, Microsoft Entra, Okta, Keycloak, Authentik)
10. Page owners and "last reviewed" dates
11. Later: invite links, optional email (invites, password reset), and open sign-up behind an admin switch
