// Search text shared by the server and the browser. D1's lower() folds only
// ASCII, so messages store a lower-cased copy made here.
export const SEARCH_QUERY_LIMIT = 100;
export function normalizeSearch(text: string) {
  return text
    .replace(/:noct_[a-z0-9_]+:|:ce_[0-9a-f-]{36}:/g, ' ')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}
// A LIKE pattern for a normalized query, with wildcards escaped by '\'.
export function searchPattern(query: string) {
  return '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
}
// Where the query occurs in a message, for a snippet around the match.
export function searchSnippet(text: string, query: string, radius = 60) {
  const folded = text.toLocaleLowerCase('ru').replace(/ё/g, 'е');
  const needle = normalizeSearch(query);
  const at = needle ? folded.indexOf(needle) : -1;
  if (at < 0 || folded.length !== text.length)
    return { text: text.slice(0, radius * 2), start: -1, length: 0 };
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + needle.length + radius);
  return {
    text:
      (from ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : ''),
    start: at - from + (from ? 1 : 0),
    length: needle.length,
  };
}
