import { describe, it, expect } from 'vitest';
import { cleanDisplayName } from './display-name';

describe('cleanDisplayName', () => {
  it('cleans names according to plan test matrix', () => {
    expect(cleanDisplayName('Sidhu ⚜️')).toBe('Sidhu');
    expect(cleanDisplayName('vishnu reddy30')).toBe('Vishnu Reddy');
    expect(cleanDisplayName('~Shaik Abrar Ahmed')).toBe('Shaik Abrar Ahmed');
    expect(cleanDisplayName('9573157786')).toBe('Sir/Madam');
    expect(cleanDisplayName('🔱', '')).toBe('');
    expect(cleanDisplayName('రాజు')).toBe('రాజు');
    expect(cleanDisplayName(null)).toBe('Sir/Madam');
  });

  it('handles custom fallbacks and edge cases', () => {
    expect(cleanDisplayName('', 'Customer')).toBe('Customer');
    expect(cleanDisplayName(undefined, 'Friend')).toBe('Friend');
    expect(cleanDisplayName('A', 'Sir/Madam')).toBe('Sir/Madam'); // only 1 letter
    expect(cleanDisplayName('Dr. A. P. J. Abdul Kalam')).toBe('Dr. A. P. J. Abdul Kalam');
  });
});
