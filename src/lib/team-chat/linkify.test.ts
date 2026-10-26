import { describe, it, expect } from 'vitest';
import { splitLinks } from './linkify';

describe('splitLinks', () => {
  it('handles empty strings', () => {
    expect(splitLinks('')).toEqual([]);
  });

  it('detects a plain URL', () => {
    expect(splitLinks('https://example.com')).toEqual([
      { type: 'url', value: 'https://example.com' },
    ]);
  });

  it('strips trailing punctuation from a URL followed by a full stop', () => {
    expect(splitLinks('Please visit https://example.com.')).toEqual([
      { type: 'text', value: 'Please visit ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: '.' },
    ]);
  });

  it('detects two URLs and maintains intermediate text', () => {
    expect(splitLinks('Check https://foo.com and https://bar.com!')).toEqual([
      { type: 'text', value: 'Check ' },
      { type: 'url', value: 'https://foo.com' },
      { type: 'text', value: ' and ' },
      { type: 'url', value: 'https://bar.com' },
      { type: 'text', value: '!' },
    ]);
  });

  it('never links javascript: URIs', () => {
    expect(splitLinks('javascript:alert(1)')).toEqual([
      { type: 'text', value: 'javascript:alert(1)' },
    ]);
  });

  it('keeps multi-line text and newline characters', () => {
    const input = 'First line\nhttps://example.com\nThird line';
    expect(splitLinks(input)).toEqual([
      { type: 'text', value: 'First line\n' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: '\nThird line' },
    ]);
  });

  it('handles closing parentheses correctly', () => {
    expect(splitLinks('(see https://example.com)')).toEqual([
      { type: 'text', value: '(see ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: ')' },
    ]);
  });
});
