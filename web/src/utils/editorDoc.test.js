import { describe, it, expect } from 'vitest';
import { renderDatabaseAsMarkdownTable } from './editorDoc';

const db = (title) => ({
  title,
  fields: [{ id: 'f1', name: 'Name' }],
  rows: [{ id: 'r1', data: { f1: 'Alpha' } }],
});

describe('renderDatabaseAsMarkdownTable', () => {
  it("uses the database page's current title over the title stored in the view block", () => {
    const md = renderDatabaseAsMarkdownTable(db('Inventory'), 'Untitled database');
    expect(md).toContain('Inventory');
    expect(md).not.toContain('Untitled database');
  });

  it('falls back to the stored title when the database has none', () => {
    expect(renderDatabaseAsMarkdownTable(db(''), 'Stored name')).toContain('Stored name');
  });
});
