const MAX_TEXT = 32000;
const INVISIBLE = /[\p{Cf}\p{M}]/gu;
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  х: 'x',
  у: 'y',
  і: 'i',
  ј: 'j',
  к: 'k',
  м: 'm',
  т: 't',
  в: 'b',
  н: 'h',
  ѕ: 's',
  ӏ: 'l',
  υ: 'u',
  ν: 'v',
  ι: 'i',
  χ: 'x',
  ο: 'o',
  α: 'a',
  ɡ: 'g',
};
export function normalizeSpamText(text: string) {
  return normalized(text.slice(0, MAX_TEXT));
}
function normalized(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(INVISIBLE, '')
    .replace(/[аеорсхуіјкмтвнѕӏυνιχοαɡ]/g, (letter) => CONFUSABLES[letter])
    .normalize('NFC');
}
function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function* variants(text: string): Generator<string> {
  const seen = new Set<string>();
  let budget = 96000;
  function* visit(raw: string, depth: number): Generator<string> {
    // Preserve case for Base64, while removing visual obfuscation before decoding.
    const value = raw
      .normalize('NFKC')
      .normalize('NFD')
      .replace(INVISIBLE, '')
      .normalize('NFC');
    // Scan the entire normalized source even when NFKC expands characters. Only
    // derived decoding variants spend the budget; the original bounded input
    // must never disappear or be truncated a second time after normalization.
    if (!value || seen.has(value) || (depth > 0 && value.length > budget))
      return;
    seen.add(value);
    if (depth > 0) budget -= value.length;
    yield value;
    if (depth >= 2) return;
    const unescaped = value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
    if (unescaped !== value) yield* visit(unescaped, depth + 1);
    for (const match of value.matchAll(
      /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{8,4096}={0,2}(?![A-Za-z0-9+/_=-])/g,
    )) {
      const token = match[0]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .replace(/=+$/, '');
      if (token.length % 4 === 1) continue;
      try {
        const binary = atob(token.padEnd(Math.ceil(token.length / 4) * 4, '='));
        if (btoa(binary).replace(/=+$/, '') !== token) continue;
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(binary, (c) => c.charCodeAt(0)),
        );
        // Reject binary/control bytes before treating decoded data as public text.
        // eslint-disable-next-line no-control-regex
        if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded))
          yield* visit(decoded, depth + 1);
      } catch {
        /* Not printable, canonical UTF-8 Base64. */
      }
    }
  }
  yield* visit(text.slice(0, MAX_TEXT), 0);
}
export function detectSpamDomain(
  text: string,
  domains: string[],
  identity = false,
) {
  const patterns = domains.map((domain) => {
    const parts = domain.split('.');
    // Domain hyphens are separators, never literal characters next to the same
    // repeated separator class (which would create exponential backtracking).
    const letters = (word: string) =>
      Array.from(word.replace(/-/g, ''), escape).join('[\\s_\\-·]*');
    const pattern = parts
      .map(letters)
      .join(
        '(?:\\s*(?:\\.|\\[\\.\\]|\\(\\.\\)|dot|' +
          escape(normalizeSpamText('точка')) +
          '|_)\\s*)',
      );
    const literal = new RegExp(
      '(?<![\\p{L}\\p{N}])' + pattern + '(?![\\p{L}\\p{N}])',
      'u',
    );
    // Handles cannot contain dots; screen standalone promotional brand aliases too.
    const alias =
      identity && parts[0].length >= 5
        ? new RegExp(
            '(?<![\\p{L}\\p{N}])' +
              letters(parts[0]) +
              '(?:[\\s_\\-]*' +
              letters(parts.at(-1)!) +
              ')?(?![\\p{L}\\p{N}])',
            'u',
          )
        : null;
    return { domain, literal, alias };
  });
  for (const value of variants(text)) {
    const canonical = normalized(value);
    for (const { domain, literal, alias } of patterns) {
      if (literal.test(canonical) || alias?.test(canonical)) return domain;
    }
  }
  return null;
}
export function spamFingerprint(text: string) {
  return normalizeSpamText(text)
    .replace(/https?:\/\//g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
