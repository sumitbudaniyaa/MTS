/**
 * Escape regex metacharacters in user-supplied search text before using it in a Mongo
 * `$regex`. Prevents regex injection and ReDoS (catastrophic backtracking on the DB) from
 * inputs like `(a+)+`. The escaped string matches the literal characters the user typed.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
