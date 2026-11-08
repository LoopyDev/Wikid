import { describe, it, expect } from 'vitest';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

// Round trips through @tiptap/markdown, which reads pasted Markdown into pages: Markdown read into
// a document and written back should come out the same, however many times. Random documents
// (from a fixed seed, so a failure can be run again) find what it gets wrong. Only Tiptap's own
// extensions are used, so a failure here is about @tiptap/markdown and can be reported upstream
// as it is. Known upstream bugs are listed at the end, as expected failures with their issue: when
// one starts passing, it's been fixed, and the test says so.

const manager = new MarkdownManager({ extensions: [StarterKit, TableKit, TaskList, TaskItem.configure({ nested: true })] });

/** A small seeded random number generator (mulberry32), so a failing case can be run again. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['wiki', 'notes', 'plan', 'review', 'team', 'draft', 'budget', 'launch', 'today', 'kettle', 'Monday', 'list'];

function generator(seed) {
  const next = random(seed);
  const pick = (items) => items[Math.floor(next() * items.length)];
  const words = (min, max) => Array.from({ length: min + Math.floor(next() * (max - min + 1)) }, () => pick(WORDS)).join(' ');
  const inline = () => {
    const parts = [words(1, 3)];
    if (next() < 0.3) parts.push(`**${words(1, 2)}**`);
    if (next() < 0.3) parts.push(`*${words(1, 2)}*`);
    if (next() < 0.2) parts.push(`\`${pick(WORDS)}\``);
    if (next() < 0.2) parts.push(`[${words(1, 2)}](https://example.com/${pick(WORDS)})`);
    if (next() < 0.15) parts.push(`~~${words(1, 1)}~~`);
    parts.push(words(0, 2));
    return parts.filter(Boolean).join(' ');
  };
  const list = (depth = 0, parent = null) => {
    // To-dos under a numbered item: known upstream, tested on their own below
    const kind = pick(parent === '1.' ? ['-', '1.'] : ['-', '1.', '- [ ]']);
    return Array.from({ length: 1 + Math.floor(next() * 3) }, (_, i) => {
      const marker = kind === '1.' ? `${i + 1}.` : kind === '- [ ]' ? (next() < 0.5 ? '- [ ]' : '- [x]') : '-';
      const item = `${'  '.repeat(depth)}${marker} ${inline()}`;
      return depth < 1 && next() < 0.25 ? `${item}\n${list(depth + 1, kind)}` : item;
    }).join('\n');
  };
  const block = {
    heading: () => `${'#'.repeat(1 + Math.floor(next() * 3))} ${words(1, 3)}`,
    paragraph: inline,
    list,
    code: () => `\`\`\`${pick(['', 'js', 'ts'])}\n${words(1, 4)}\n\`\`\``,
    quote: () => `> ${inline()}`,
    rule: () => '---',
    table: () => {
      const cols = 1 + Math.floor(next() * 3);
      const row = () => `| ${Array.from({ length: cols }, () => words(1, 2)).join(' | ')} |`;
      return [row(), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, row()].join('\n');
    },
  };
  return () => {
    const kinds = Object.keys(block);
    const blocks = [];
    let previous = null;
    for (let i = 0, n = 1 + Math.floor(next() * 6); i < n; i += 1) {
      let kind = pick(kinds);
      // Two tables in a row: known upstream (tiptap#8719), tested on its own below
      if (kind === 'table' && previous === 'table') kind = 'paragraph';
      blocks.push(block[kind]());
      previous = kind;
    }
    return blocks.join('\n\n');
  };
}

/** Read and write back: the document, and the Markdown it gives. */
const roundTrip = (markdown) => {
  const doc = manager.parse(markdown);
  return { doc, markdown: manager.serialize(doc) };
};

describe('@tiptap/markdown round trips', () => {
  it('reads back what it writes, for random documents', () => {
    const failures = [];
    for (let seed = 1; seed <= Number(process.env.ROUNDTRIP_SEEDS || 300); seed += 1) {
      const original = generator(seed)();
      const first = roundTrip(original);
      const second = roundTrip(first.markdown);
      // Once written, reading and writing again changes nothing
      if (JSON.stringify(second.doc) !== JSON.stringify(first.doc) || second.markdown !== first.markdown) {
        failures.push({ seed, original, first: first.markdown, second: second.markdown });
      }
    }
    // A failure shows its seed and Markdown: reduce it to a few lines, check it, then report it
    // upstream (and list it below) or fix it
    expect(failures.slice(0, 3)).toEqual([]);
  });
});

describe('@tiptap/markdown: known upstream bugs', () => {
  it.fails('keeps two tables in a row as they are (tiptap#8719)', () => {
    const markdown = '| a |\n| --- |\n| b |\n\n| c |\n| --- |\n| d |';
    const once = roundTrip(markdown);
    const twice = roundTrip(once.markdown);
    expect(twice.doc.content.map((n) => n.type)).toEqual(['table', 'table']);
  });

  it.fails('keeps to-dos under a numbered item side by side (to report upstream)', () => {
    // In 3.32 the second to-do is read as text in the first ("[ ] c"); in 3.33, nested inside it
    const doc = manager.parse('1. a\n   - [ ] b\n   - [ ] c');
    const todos = doc.content[0].content[0].content[1];
    expect(todos.content.map((item) => item.content[0].content[0].text)).toEqual(['b', 'c']);
  });
});
