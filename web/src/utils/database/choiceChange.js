import { getMultiSelectValuesFromRaw } from './cellValues';

/**
 * What a select's cell becomes when the column's choices change: a renamed choice follows its new
 * name; one no longer a choice is kept aside (shown greyed until replaced, as after a type change)
 * rather than lost; and a kept one that's a choice again comes back. Null if nothing changes.
 *
 * raw: the cell's value, kept: what's kept for it, allowed: the choices now (a Set), renames: a
 * Map of old name to new. Returns { value, kept }, either undefined for none.
 */
export const settleChoiceCell = (type, raw, kept, allowed, renames) => {
  const rename = (choice) => renames.get(choice) ?? choice;
  const keptList = (Array.isArray(kept) ? kept : typeof kept === 'string' && kept ? [kept] : []).map(String);
  if (type === 'SELECT') {
    const current = typeof raw === 'string' ? raw.trim() : '';
    const keptNow = keptList.length === 1 ? rename(keptList[0]) : null;
    if (!current) {
      // Kept, and a choice again: back as the value
      return keptNow && allowed.has(keptNow) ? { value: keptNow, kept: undefined } : null;
    }
    const next = rename(current);
    if (allowed.has(next)) return next === current ? null : { value: next, kept: keptNow ?? (kept || undefined) };
    return { value: undefined, kept: current };
  }
  const values = getMultiSelectValuesFromRaw(raw);
  const all = [...new Set([...values, ...keptList].map(rename))];
  const value = all.filter((choice) => allowed.has(choice));
  const stillKept = all.filter((choice) => !allowed.has(choice));
  const same = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
  if (same(value, values) && same(stillKept, keptList)) return null;
  return { value: value.length ? value : undefined, kept: stillKept.length ? stillKept : undefined };
};
