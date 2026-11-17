import { describe, expect, it } from 'vitest';
import { isValidIsbn13, normalizeIsbn } from '../../src/domain/isbn.js';

describe('normalizeIsbn', () => {
  it('removes hyphens and spaces', () => {
    expect(normalizeIsbn('978-0-306 40615-7')).toBe('9780306406157');
  });
});

describe('isValidIsbn13', () => {
  // Valid partitions: both prefixes, with and without separators
  it.each(['9780306406157', '978-0-306-40615-7', '978 1 61729 413 6', '9791032305690'])('accepts %s', (isbn) => {
    expect(isValidIsbn13(isbn)).toBe(true);
  });

  // Invalid partitions: each case breaks exactly one rule, so a failure points at the broken rule
  it.each([
    { isbn: '9780306406158', rule: 'wrong check digit' },
    { isbn: '978030640615', rule: 'too short (12 digits)' },
    { isbn: '97803064061570', rule: 'too long (14 digits)' },
    { isbn: '9770306406158', rule: 'prefix is not 978/979 (checksum is valid)' },
    { isbn: '97803064O6157', rule: 'contains a letter' },
    { isbn: '', rule: 'empty' },
  ])('rejects $isbn: $rule', ({ isbn }) => {
    expect(isValidIsbn13(isbn)).toBe(false);
  });
});
