// Typing in database cells: number input that only accepts numbers, and confirming with Enter.

export const readSelectionOffset = (target) => {
  const offset = target?.selectionStart;
  if (Number.isFinite(offset)) return offset;
  const value = target?.value;
  if (typeof value === 'string') return value.length;
  return null;
};

export const sanitizeNumberInput = (value) => {
  if (value === null || value === undefined) return '';
  let raw = String(value);
  raw = raw.replace(/[^0-9.-]/g, '');
  const hasLeadingMinus = raw.startsWith('-');
  raw = raw.replace(/-/g, '');
  if (hasLeadingMinus) {
    raw = `-${raw}`;
  }
  const dotIndex = raw.indexOf('.');
  if (dotIndex !== -1) {
    raw = `${raw.slice(0, dotIndex + 1)}${raw.slice(dotIndex + 1).replace(/\./g, '')}`;
  }
  return raw;
};

export const isNumberInputCandidateValid = (value) => /^-?\d*\.?\d*$/.test(value);

export const handleNumberKeydown = (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Home', 'End', 'Escape'];
  if (allowedKeys.includes(event.key)) return;
  if (event.key.length !== 1) return;
  const target = event.target;
  const current = String(target?.value ?? '');
  const start = target?.selectionStart ?? current.length;
  const end = target?.selectionEnd ?? start;
  const next = `${current.slice(0, start)}${event.key}${current.slice(end)}`;
  if (!isNumberInputCandidateValid(next)) {
    event.preventDefault();
  }
};

export const handleCellConfirmKeydown = (event) => {
  if (event?.key !== 'Enter') return;
  if (event.isComposing || event.key === 'Process') return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.target;
  if (typeof target?.blur === 'function') {
    target.blur();
  }
};

export const handleNumberPaste = (event) => {
  const text = event.clipboardData?.getData('text') ?? '';
  if (!text) return;
  const cleaned = sanitizeNumberInput(text);
  if (cleaned === text) return;
  event.preventDefault();
  const target = event.target;
  const current = String(target?.value ?? '');
  const start = target?.selectionStart ?? current.length;
  const end = target?.selectionEnd ?? start;
  const next = `${current.slice(0, start)}${cleaned}${current.slice(end)}`;
  target.value = next;
  if (typeof target?.setSelectionRange === 'function') {
    const pos = start + cleaned.length;
    target.setSelectionRange(pos, pos);
  }
};
