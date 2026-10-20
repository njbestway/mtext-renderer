/**
 * Normalized font-family aliases.
 *
 * Drawings reference Windows font family names that the font repository
 * publishes under a different name, so an exact (case-insensitive) catalog
 * lookup misses a face that is actually available. Keys and values are
 * normalized font names: lower case and without font file extension.
 *
 * Only names the repository does not publish may appear as keys: lookups try
 * the requested name first, so a repository that later publishes the original
 * family automatically wins. Every value must exist in the repository,
 * otherwise the alias is a no-op that costs one extra catalog miss.
 *
 * `MS PGothic` / `MS UI Gothic` ship inside the same `msgothic.ttc` collection
 * as `MS Gothic`, so the repository's `msgothic.woff` covers them glyph for
 * glyph. Without the alias a `\fMS PGothic|b0|i0|c128|p34;` run counts as a
 * missing font, falls back to the default chain (`simsun`), and glyphs that
 * only the Gothic collection carries — `✚` (U+271A) for example — render as
 * '?'.
 */
export const FONT_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  // Windows Japanese Gothic collection (msgothic.ttc)
  ['ms pgothic', 'msgothic'],
  ['ms p gothic', 'msgothic'],
  ['ms-pgothic', 'msgothic'],
  ['mspgothic', 'msgothic'],
  ['ｍｓ ｐゴシック', 'msgothic'],
  ['ｍｓｐゴシック', 'msgothic'],
  ['ms uigothic', 'msgothic'],
  ['ms ui gothic', 'msgothic'],
  ['ms-uigothic', 'msgothic'],
  ['msuigothic', 'msgothic'],
  ['ｍｓ ｕｉゴシック', 'msgothic'],
  // Windows Chinese families published under their short file stem
  ['microsoft yahei', 'msyh'],
  ['microsoftyahei', 'msyh'],
  ['yahei', 'msyh'],
  ['nsimsun', 'simsun'],
  ['kaiti', 'simkai'],
  ['楷体_gb2312', 'simkai']
])

/**
 * Resolves the repository face name that stands in for a normalized font name.
 *
 * @param normalizedName - Font name already lower cased and stripped of its
 *   font file extension.
 * @returns The alias target, or `undefined` when the name has no alias.
 */
export function resolveFontNameAlias(
  normalizedName: string
): string | undefined {
  if (!normalizedName) {
    return undefined
  }
  const alias = FONT_NAME_ALIASES.get(normalizedName)
  return alias && alias !== normalizedName ? alias : undefined
}
