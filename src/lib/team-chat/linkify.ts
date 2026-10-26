export type LinkToken = {
  type: 'text' | 'url';
  value: string;
};

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
const TRAILING_PUNCTUATION_RE = /[.,!?;:)]+$/;

export function splitLinks(text: string): LinkToken[] {
  if (!text) return [];

  const tokens: LinkToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_RE)) {
    const fullMatch = match[0];
    const matchIndex = match.index;

    // Push text before URL
    if (matchIndex > lastIndex) {
      tokens.push({
        type: 'text',
        value: text.slice(lastIndex, matchIndex),
      });
    }

    // Strip trailing punctuation
    const punctMatch = fullMatch.match(TRAILING_PUNCTUATION_RE);
    let url = fullMatch;
    let trailingPunct = '';

    if (punctMatch) {
      trailingPunct = punctMatch[0];
      url = fullMatch.slice(0, fullMatch.length - trailingPunct.length);
    }

    // Safety: ensure it starts with http:// or https:// and not javascript:
    if (/^https?:\/\//i.test(url)) {
      tokens.push({
        type: 'url',
        value: url,
      });
    } else {
      tokens.push({
        type: 'text',
        value: url,
      });
    }

    if (trailingPunct) {
      tokens.push({
        type: 'text',
        value: trailingPunct,
      });
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      value: text.slice(lastIndex),
    });
  }

  // Consolidate consecutive text tokens if any
  const consolidated: LinkToken[] = [];
  for (const tok of tokens) {
    const prev = consolidated[consolidated.length - 1];
    if (prev && prev.type === 'text' && tok.type === 'text') {
      prev.value += tok.value;
    } else {
      consolidated.push(tok);
    }
  }

  return consolidated;
}
