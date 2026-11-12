import { describe, it, expect, vi } from 'vitest';
import { useTextHistory } from './useTextHistory';

// Typing as the browser does it: beforeinput, the change, then input
const setup = () => {
  const el = document.createElement('textarea');
  document.body.append(el);
  const apply = vi.fn();
  const history = useTextHistory({ apply });
  const type = (text, inputType = 'insertText') => {
    for (const ch of text) {
      history.onBeforeInput({ target: el, inputType, preventDefault() {} });
      const at = el.selectionStart;
      el.value = el.value.slice(0, at) + ch + el.value.slice(el.selectionEnd);
      el.setSelectionRange(at + 1, at + 1);
      history.onInput({ target: el });
    }
  };
  const key = (k, shift = false) => {
    const event = { target: el, key: k, ctrlKey: true, shiftKey: shift, preventDefault: vi.fn() };
    history.onKeyDown(event);
    return event;
  };
  return { el, apply, history, type, key };
};

describe('text box undo history', () => {
  it('undoes a run of typing in one go, and redoes it', () => {
    const { el, apply, type, key } = setup();
    type('Plan for the week');
    expect(key('z').preventDefault).toHaveBeenCalled();
    expect(el.value).toBe('');
    expect(apply).toHaveBeenCalledWith(el);
    key('z', true);
    expect(el.value).toBe('Plan for the week');
    expect(el.selectionStart).toBe(17);
  });

  it('starts a new step after a pause or a move of the cursor', () => {
    vi.useFakeTimers();
    const { el, type, key } = setup();
    type('One');
    vi.advanceTimersByTime(1500);
    type(' two');
    el.setSelectionRange(0, 0);
    type('>');
    key('z');
    expect(el.value).toBe('One two');
    key('z');
    expect(el.value).toBe('One');
    key('y');
    expect(el.value).toBe('One two');
    vi.useRealTimers();
  });

  it("does nothing in a read-only box, and forgets everything on reset", () => {
    const { el, type, key, history } = setup();
    type('abc');
    el.readOnly = true;
    key('z');
    expect(el.value).toBe('abc');
    el.readOnly = false;
    history.reset();
    key('z');
    expect(el.value).toBe('abc');
  });

  it("starts again once the text is changed from elsewhere, so an undo doesn't overwrite it", () => {
    const { el, type, key } = setup();
    type('Plan');
    el.value = 'Plan v2'; // someone else renamed the page
    const event = key('z');
    expect(el.value).toBe('Plan v2');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps the redo after a key that changes nothing, and takes input-method typing as typing', () => {
    const { el, history, type, key } = setup();
    type('ab', 'insertCompositionText');
    type('c');
    key('z');
    expect(el.value).toBe('');
    el.setSelectionRange(0, 0);
    history.onBeforeInput({ target: el, inputType: 'deleteContentBackward', preventDefault() {} });
    history.onInput({ target: el }); // nothing to delete at the start
    key('z', true);
    expect(el.value).toBe('abc');
  });
});

