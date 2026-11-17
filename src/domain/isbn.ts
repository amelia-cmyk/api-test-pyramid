/**
 * ISBN-13 helpers. An ISBN-13 has 13 digits, starts with 978 or 979, and ends with a check digit:
 * multiply the digits by 1 and 3 alternately, and the total must be divisible by 10.
 */

/** Removes the hyphens and spaces people usually type, e.g. "978-0-306-40615-7" -> "9780306406157". */
export function normalizeIsbn(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function isValidIsbn13(input: string): boolean {
  const isbn = normalizeIsbn(input);
  if (!/^97[89]\d{10}$/.test(isbn)) return false;

  const total = [...isbn].reduce((sum, char, index) => sum + Number(char) * (index % 2 === 0 ? 1 : 3), 0);
  return total % 10 === 0;
}
