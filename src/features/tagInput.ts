/** Splits free text on commas/newlines into clean tag names: trimmed, single-spaced, no leading '#', no blanks. */
export function parseTagNames(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((part) => part.replace(/^#+/, '').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
}

/**
 * Appends the tags in `raw` to `current`. Duplicates (case-insensitive) are skipped, and a name
 * matching an existing tag in `known` takes that tag's spelling, so typing "elk" reuses "Elk"
 * instead of creating a near-duplicate.
 */
export function addTagNames(current: string[], raw: string, known: string[] = []): string[] {
  const result = [...current];
  const seen = new Set(result.map((name) => name.toLowerCase()));
  for (const name of parseTagNames(raw)) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(known.find((k) => k.toLowerCase() === key) ?? name);
  }
  return result;
}
