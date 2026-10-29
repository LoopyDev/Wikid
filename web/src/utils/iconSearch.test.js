import { describe, expect, it } from 'vitest';
import { iconCategories, loadIconMeta, searchIcons } from './iconSearch';

const entries = ['house', 'house-door', 'envelope', 'alarm', 'arrow-left'].map((name) => ({ id: `icon:${name}`, name }));
const meta = {
  categories: ['Arrows', 'Communications', 'Real world'],
  icons: {
    house: [[2], ['home']],
    'house-door': [[2], ['home']],
    envelope: [[1], ['email', 'message', 'mail']],
    alarm: [[2], ['clock', 'time']],
    'arrow-left': [[0], ['previous']],
  },
};
const names = (list) => list.map((entry) => entry.name);

describe('searchIcons', () => {
  it('finds icons by name, and by tag once the tags are loaded', () => {
    expect(names(searchIcons(entries, 'house'))).toEqual(['house', 'house-door']);
    expect(names(searchIcons(entries, 'home'))).toEqual([]);
    expect(names(searchIcons(entries, 'home', { meta }))).toEqual(['house', 'house-door']);
    expect(names(searchIcons(entries, 'mail', { meta }))).toEqual(['envelope']);
  });

  it('needs every word, and lists everything for an empty search', () => {
    expect(names(searchIcons(entries, 'house door', { meta }))).toEqual(['house-door']);
    expect(searchIcons(entries, '  ', { meta })).toHaveLength(entries.length);
  });

  it('keeps to a category, searched within', () => {
    expect(names(searchIcons(entries, '', { meta, category: 'Real world' }))).toEqual(['house', 'house-door', 'alarm']);
    expect(names(searchIcons(entries, 'time', { meta, category: 'Real world' }))).toEqual(['alarm']);
    expect(searchIcons(entries, '', { meta, category: 'Nonsense' })).toEqual([]);
  });
});

describe('the icon data', () => {
  it('has the categories and tags of the installed icons', async () => {
    const data = await loadIconMeta();
    expect(iconCategories(data)).toContain('Real world');
    const [categories, tags] = data.icons.house;
    expect(categories.map((index) => data.categories[index])).toContain('Real world');
    expect(tags).toContain('home');
  });
});
