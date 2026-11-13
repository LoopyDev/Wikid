// v-dialog, on a dialog's card: what a dialog does with the keyboard. Focus goes into it when it
// opens and back where it was when it closes; Tab and Shift+Tab go round inside it (they went on into
// the editor behind, each Tab indenting the page); Escape closes it, if given what closes it
// (v-dialog="close"; without one, Escape is left to the dialog, or does nothing where it would lose
// a lot, as in compliance setup). Only the dialog on top does
// these, so Escape in a confirmation over a dialog closes just the confirmation. It's also marked as
// a dialog for screen readers, named by its heading.

// What Tab goes to (not what's been taken out of the order with tabindex="-1")
const FOCUSABLE = ['a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]', '[contenteditable="true"]']
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join(', ');
// Where focus starts: a field to type in, never a button (Enter on a focused "Delete" deleted the page)
const FIELDS = 'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea:not([disabled]), select:not([disabled])';

const stack = []; // open dialogs, the last on top: { el, close, returnTo }
let headingCount = 0;

// The last few things that had focus, newest last: a dialog opened from a menu item goes back to
// what opened the menu (the item itself is gone with the menu)
const recentFocus = [];
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const at = recentFocus.indexOf(target);
    if (at !== -1) recentFocus.splice(at, 1);
    recentFocus.push(target);
    if (recentFocus.length > 5) recentFocus.shift();
  });
}

const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
const focusables = (el) => [...el.querySelectorAll(FOCUSABLE)].filter(visible);

// The dialog drawn on top: the one under the middle of the screen (the last opened isn't always it,
// as dialogs are drawn in the order they're in the page)
const topDialog = () => {
  if (stack.length < 2) return stack[0];
  const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (hit && stack[i].el.contains(hit)) return stack[i];
  }
  return stack[stack.length - 1];
};

const onKeydown = (event) => {
  const top = topDialog();
  // Escape that's for something else: handled already, or ending an input method's composition
  if (!top || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    if (!top.close) return;
    // Something inside that uses Escape itself (a menu, a picker) has had it
    event.preventDefault();
    event.stopPropagation();
    top.close();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusables(top.el);
  event.preventDefault();
  if (!items.length) {
    top.el.focus();
    return;
  }
  const at = items.indexOf(document.activeElement);
  const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === -1 || at === items.length - 1 ? 0 : at + 1;
  items[next].focus();
};

export const dialog = {
  mounted(el, binding) {
    if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
    if (!el.hasAttribute('aria-modal')) el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
      const heading = el.querySelector('h1, h2, h3');
      if (heading) {
        if (!heading.id) heading.id = `dialog-heading-${(headingCount += 1)}`;
        el.setAttribute('aria-labelledby', heading.id);
      }
    }
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    const entry = { el, close: typeof binding.value === 'function' ? binding.value : null, returnTo: [...recentFocus] };
    if (!stack.length) document.addEventListener('keydown', onKeydown);
    stack.push(entry);
    // Into it, unless something in it already has focus (an autofocus field, say)
    requestAnimationFrame(() => {
      if (!el.isConnected || el.contains(document.activeElement)) return;
      const first = el.querySelector('[autofocus], [data-initial-focus]') || [...el.querySelectorAll(FIELDS)].find(visible);
      (first || el).focus({ preventScroll: true });
    });
  },
  updated(el, binding) {
    const entry = stack.find((item) => item.el === el);
    if (entry) entry.close = typeof binding.value === 'function' ? binding.value : null;
  },
  unmounted(el) {
    const index = stack.findIndex((item) => item.el === el);
    if (index === -1) return;
    const [entry] = stack.splice(index, 1);
    if (!stack.length) document.removeEventListener('keydown', onKeydown);
    // Back where it was (the newest of what had focus that's still there), unless something else
    // has taken focus meanwhile
    const lost = !document.activeElement || document.activeElement === document.body || el.contains(document.activeElement);
    const back = [...entry.returnTo].reverse().find((item) => item.isConnected && !el.contains(item) && visible(item));
    if (lost && back) back.focus({ preventScroll: true });
  },
};
