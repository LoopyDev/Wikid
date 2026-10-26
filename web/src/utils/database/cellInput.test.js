import { describe, it, expect } from 'vitest';
import { handleNumberKeydown, isNumberInputCandidateValid, sanitizeNumberInput } from './cellInput';
import { colorFromId, presencePalette } from '../presenceColor';

const keydown = (key, value, selectionStart = value.length, selectionEnd = selectionStart) => {
  const event = { key, target: { value, selectionStart, selectionEnd }, prevented: false };
  event.preventDefault = () => {
    event.prevented = true;
  };
  handleNumberKeydown(event);
  return event.prevented;
};

describe('number cells', () => {
  it('keeps only one leading minus and one decimal point', () => {
    expect(sanitizeNumberInput('-12.5.3')).toBe('-12.53');
    expect(sanitizeNumberInput('1-2')).toBe('12');
    expect(sanitizeNumberInput('£1,234.50')).toBe('1234.50');
    expect(sanitizeNumberInput(null)).toBe('');
  });

  it('recognises partly typed numbers', () => {
    for (const ok of ['', '-', '1.', '-0.5', '.5']) expect(isNumberInputCandidateValid(ok), ok).toBe(true);
    for (const bad of ['1-', '1.2.3', 'a', '--1']) expect(isNumberInputCandidateValid(bad), bad).toBe(false);
  });

  it('blocks keys that would make the number invalid', () => {
    expect(keydown('5', '12')).toBe(false);
    expect(keydown('a', '12')).toBe(true);
    expect(keydown('.', '1.5')).toBe(true);
    expect(keydown('-', '12', 0)).toBe(false);
    expect(keydown('-', '12')).toBe(true);
    expect(keydown('Backspace', '12')).toBe(false);
  });
});

describe('presence colours', () => {
  it('gives each user a stable colour from the palette', () => {
    expect(colorFromId('user-1')).toBe(colorFromId('user-1'));
    expect(presencePalette).toContain(colorFromId('user-2'));
    expect(presencePalette).toContain(colorFromId());
  });
});
