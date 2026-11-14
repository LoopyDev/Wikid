# Wikid MCP server

Lets an AI tool that speaks [MCP](https://modelcontextprotocol.io), such as Claude Code or Claude Desktop, work in your Wikid: search, read and write pages, and read and change databases: their rows and columns. It acts as the user it logs in as, so it sees and changes only what that user can.

It logs in with a password for now. Next on the plan is connecting Claude by signing in (a remote MCP server with OAuth), with no password stored anywhere.

## Connecting Claude Code

From a checkout of this repository (run `npm install` at its root once):

```bash
claude mcp add wikid \
  -e WIKID_API_URL=https://wiki.example.com/api \
  -e WIKID_EMAIL=you@example.com \
  -e WIKID_PASSWORD='your password' \
  -- node /path/to/Wikid/mcp/index.js
```

- `WIKID_API_URL`: your Wikid's address with `/api` on the end (`http://localhost:8088/api` for the Docker quick start).
- `WIKID_EMAIL`: the email or username to log in as. Consider a separate Wikid user for it, with access to only the workspaces it should work in.
- `WIKID_PASSWORD`: that user's password.

**The password is stored unencrypted** in Claude Code's settings (`~/.claude.json`), as other MCP servers' keys are. So:

- Don't add it with `--scope project`: that writes the settings to `.mcp.json` in the project folder, where they can end up in git.
- Consider a separate Wikid user for it (below), so a leaked password reaches only what that user can.

### A separate user (optional)

The server acts as whoever it logs in as. To limit what it can reach, and see its edits apart from yours in page history:

1. As the admin, create a user (Admin → Users), named "Claude", say, with a username or email to log in with.
2. Log in as it once, in a private window, and choose its password: until then, Wikid won't let it use the API.
3. Add it to the workspaces it should work in (each workspace's Settings → Members): Editor to write, Viewer to only read. It never sees anyone's private pages.
4. Use its login in `claude mcp add`. To cut it off later, change its password or delete the user.

Then ask Claude about your wiki ("what's on the onboarding page?", "add a page of meeting notes under Team"). `claude mcp list` shows whether it's connected.

## Tools

| Tool | What it does |
|---|---|
| `list_workspaces` | The workspaces you can see, with their ids |
| `list_pages` | A workspace's pages as a tree |
| `search` | Page titles, page text and database rows, across workspaces |
| `get_page` | A page as Markdown, each block marked with its id |
| `create_page` | A new page, with content as Markdown |
| `insert_blocks` | Adds blocks (Markdown) after or before a block, or at the end |
| `update_block` | Rewrites one block from Markdown |
| `delete_block` | Deletes one block |
| `replace_page` | Rewrites a whole page from Markdown, only when Markdown would lose nothing |
| `add_image` | Puts an image on a page, from a file on your computer or a public web address: after or before a block, in place of one (an image placeholder), or at the end |
| `rename_page` | Renames a page |
| `get_database` | A database's columns and rows |
| `add_database_row`, `update_database_row` | Rows, with cells by column name |
| `create_database` | A database, with its columns |
| `add_database_column`, `update_database_column` | A column added (a relation, too: to another database's rows); renamed, or given more choices |
| `delete_database_column` | A column and its cells, with `confirm: true` (not the title column) |

### Images

`add_image` uploads the image to Wikid, so it's stored and served there like one pasted into the editor, and only people who can see the page can see it. A file is read from the computer the MCP server runs on (yours, for Claude Code); a web address is fetched by Wikid's server, which only fetches public addresses. To fill an image placeholder (`get_page` shows one as `[Image to add: …]`), pass its block id as `replaceId`: what the placeholder said becomes the image's description, unless you give one.

### Columns and toggles

Markdown has neither, so Wikid writes and reads them as sections (and `get_page` shows them this way):

```markdown
::: columns
Left side, any Markdown.

::: column
Right side.
:::

::: toggle
## A heading that opens

What it opens to.
:::
```

A quote starting with an emoji (`> 💡 …`) is a callout. Columns can't go inside a column, and a columns section can't yet be removed in one go: delete the blocks inside it, or rewrite the page with `replace_page`. A Markdown export to files keeps to standard Markdown: columns one after another.

Pages are changed **block by block**: Markdown has no database views, colours or image sizes, so a page rewritten whole from Markdown would lose them. Blocks the tool doesn't touch stay exactly as they are, and a page that someone has open shows each change straight away. Changes go into the page's history under the user the server logs in as.

Columns are added, renamed and given more choices, but a column's type isn't changed and a choice isn't renamed or removed here: Wikid moves the cells over when that's done in the app, and these tools would leave them behind.
