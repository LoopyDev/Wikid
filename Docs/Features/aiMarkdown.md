# AI Markdown Utilities

Inline markdown serialization and deserialization for the AI edit flow. Lives in `web/src/utils/aiMarkdown.js`.

## Why

When sending block content to the AI for editing, using `node.textContent` (plain text) loses all inline formatting — bold, italic, links, code etc. The AI then returns plain text back, so accepted suggestions strip all marks from the edited blocks.

The markdown round-trip preserves formatting in both directions:
- **Out**: ProseMirror node → inline markdown (sent to AI)
- **In**: AI response markdown → ProseMirror Fragment (applied to editor)
- **Revert**: original ProseMirror node stored and restored exactly (no information loss)

This also applies to `editorDocToMarkdown` (used for `.md` exports and AI chat context), which now preserves inline marks when serializing from Tiptap JSON.

## Functions

### `nodeToInlineMarkdown(pmNode)`

Serializes a live ProseMirror block node's inline content to markdown.

```js
import { nodeToInlineMarkdown } from '../utils/aiMarkdown';
const markdown = nodeToInlineMarkdown(editor.state.doc.child(0));
// "Hello **world** and *italic* text"
```

**Supported marks:**

| Mark | Output |
|---|---|
| `bold` | `**text**` |
| `italic` | `*text*` |
| `bold` + `italic` | `***text***` |
| `code` | `` `text` `` |
| `strike` | `~~text~~` |
| `link` | `[text](url)` |
| `highlight`, `textStyle` | plain text passthrough (no markdown equivalent) |
| `hardBreak` node | `\n` |

Mark application order: strike wraps outermost, then bold/italic. So `bold + strike` → `` **~~text~~** ``.

---

### `inlineMarkdownToHtml(text)`

Pure function. Converts inline markdown to HTML. Used internally by `markdownToInlineFragment` and can also replace `formatInlineMarkdown` in the paste handler.

```js
import { inlineMarkdownToHtml } from '../utils/aiMarkdown';
inlineMarkdownToHtml('Hello **world**');
// "Hello <strong>world</strong>"
```

Code spans are split out first to prevent formatting marks being applied inside them. Processing order: links → bold+italic → bold → italic → strikethrough → hard breaks. HTML entities (`&`, `<`, `>`) in input are escaped before any substitutions.

---

### `markdownToInlineFragment(markdown, schema)`

Parses inline markdown into a ProseMirror `Fragment` using `DOMParser.fromSchema(schema)` — the editor's own schema rules, so custom marks (`highlight`, `textStyle`, `link` etc.) are handled correctly without any manual configuration.

```js
import { markdownToInlineFragment } from '../utils/aiMarkdown';
const fragment = markdownToInlineFragment('**bold** text', editor.state.schema);
// Fragment with a bold text node followed by a plain text node
```

Falls back to a plain text node if parsing fails.

Used in `applyAiSuggestions` via:
```js
const fragment = markdownToInlineFragment(change.newText, state.schema);
tr = tr.replace(textFrom, textTo, new Slice(fragment, 0, 0));
```

---

## Revert

When suggestions are applied, the original ProseMirror node is stored (not just text):

```js
suggestions.push({ nodeIndex, from, to, originalNode: node, newText });
```

On revert, the entire block is restored from `originalNode`:

```js
tr.replaceWith(suggestion.from, suggestion.to, suggestion.originalNode);
```

This is lossless — all marks, custom attributes, and node structure are preserved exactly.

---

## editorDocToMarkdown

`web/src/utils/editorDoc.js` exports `editorDocToMarkdown`, used for `.md` file exports and the AI chat context. It works on serialized Tiptap JSON (not live ProseMirror nodes) so it can handle pages not currently open in the editor.

`extractText` within `editorDoc.js` now preserves inline marks from the JSON `marks` array using the same logic as `nodeToInlineMarkdown`, so exported markdown and AI chat context now include `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, and `[links](url)`.

---

## Tests

`web/src/utils/aiMarkdown.test.js` — 46 tests covering all mark types, round-trips, HTML entity escaping, code span protection, and `markdownToInlineFragment` with a real ProseMirror schema in jsdom.

Run with:
```
npm test
```
