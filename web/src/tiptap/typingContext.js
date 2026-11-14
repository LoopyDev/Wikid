// What's being typed at the cursor, for the typing rules: the line up to it, whether it's inline
// code not yet closed, and whether it's a Markdown link's address ("[words](https://ex…").

// The text of the cursor's line up to it, its last `max` characters (a page mention or other inline
// node counts as one character, as it takes one position)
export const textBefore = ($pos, max = 500) =>
  $pos.parent.textBetween(Math.max(0, $pos.parentOffset - max), $pos.parentOffset, undefined, '￼');

// After a "`" on the line that hasn't been closed yet (the closing one makes it code)
export const inUnclosedCode = (text) => (text.match(/`/g) || []).length % 2 === 1;

// A Markdown link's address: no spaces, and brackets only in pairs (Wikipedia's "Mercury_(planet)")
export const LINK_ADDRESS = String.raw`(?:[^()\s]|\([^()\s]*\))+`;
// "[words](address" up to the cursor, the address so far (its last bracket maybe still open). Not
// after "!" (an image) or "\" (a bracket meant as a bracket), or a second "[" ("[[" is a mention).
export const OPEN_LINK = new RegExp(String.raw`(?<![[!\\])\[([^[\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\)?)*)$`);

// In the address of a Markdown link being typed: typing rules ("--" to "—") would change it
export const inLinkAddress = (text) => OPEN_LINK.test(text);
