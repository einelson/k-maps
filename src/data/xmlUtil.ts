export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Text content of a parsed XML node. With attributes enabled, an element that has both attributes and
 * text parses to `{ '#text': ..., '@_attr': ... }` instead of a bare string.
 */
export function textOf(node: unknown): string | null {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') {
    const text = (node as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text;
  }
  return null;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * KML descriptions (Google My Maps, Earth, Gaia) are often HTML — `<br>`, tables, `<img>`. Notes here are
 * plain text, so this turns block boundaries into newlines and drops the rest. Text with no tag-shaped
 * content (e.g. "x < 5") is returned untouched.
 */
export function htmlToText(value: string): string {
  if (!/<\/?[a-zA-Z][^>]*>/.test(value)) return value;
  return value
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
