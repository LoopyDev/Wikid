import { describe, expect, it } from 'vitest';
import { groupPagesByAudience } from '../src/pages/page-audience.util';

// Who is told that pages changed: everyone for a page anyone can see, only the author for a private one

describe('groupPagesByAudience', () => {
  it("groups public pages for everyone and private ones by author; a page not found, or private with no author, for no one", () => {
    const pages = [
      { id: 'p1', visibility: 'PUBLIC', authorId: 'alice' },
      { id: 'a1', visibility: 'PRIVATE', authorId: 'alice' },
      { id: 'b1', visibility: 'PRIVATE', authorId: 'bob' },
      { id: 'p2', visibility: 'PUBLIC', authorId: null },
      { id: 'a2', visibility: 'PRIVATE', authorId: 'alice' },
      { id: 'x', visibility: 'PRIVATE', authorId: null },
    ];
    const groups = groupPagesByAudience(['p1', 'a1', 'b1', 'p2', 'a2', 'x', 'gone'], pages);
    expect(Object.fromEntries(groups)).toEqual({ null: ['p1', 'p2'], alice: ['a1', 'a2'], bob: ['b1'] });
  });
});
