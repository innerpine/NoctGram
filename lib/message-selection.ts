export const QUOTE_LIMIT = 1024;

// A quote must be an exact fragment of the stored text: the server checks it
// with a plain substring match. Returns '' when the fragment cannot be quoted.
export function matchQuote(text: string, fragment: string) {
  const trimmed = fragment.replace(/ /g, ' ').trim();
  if (!trimmed) return '';
  // The limit counts UTF-16 units like the server; never split a character.
  let quote = '';
  for (const char of trimmed) {
    if (quote.length + char.length > QUOTE_LIMIT) break;
    quote += char;
  }
  quote = quote.trimEnd();
  return text.includes(quote) ? quote : '';
}
// Maps the current text selection inside one message back to its raw text.
// Custom emoji render as images and carry their token in data-raw.
export function selectionQuote(
  container: Element | null | undefined,
  text: string,
  selection: Selection | null = typeof window === 'undefined'
    ? null
    : window.getSelection(),
) {
  if (
    !container ||
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount
  )
    return '';
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return '';
  const fragment = range.cloneContents();
  for (const node of Array.from(fragment.querySelectorAll('[data-raw]')))
    node.replaceWith(node.getAttribute('data-raw') || '');
  return matchQuote(text, fragment.textContent || '');
}
