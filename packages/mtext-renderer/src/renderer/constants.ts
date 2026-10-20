/**
 * AutoCAD single-line spacing as a multiple of text height ("3-on-5").
 *
 * DXF group 44 (`lineSpaceFactor`) is a ratio relative to this single spacing,
 * so baseline-to-baseline distance =
 * `lineSpaceFactor × LINE_SPACING_SCALE_FACTOR × textHeight`.
 */
export const LINE_SPACING_SCALE_FACTOR = 5 / 3

/**
 * Default DXF group-44 line spacing factor (AutoCAD single spacing).
 */
export const DEFAULT_LINE_SPACE_FACTOR = 1.0

/**
 * Default DXF group-73 line spacing style (AutoCAD "At Least").
 *
 * DXF may omit group 73 or write `0`; both mean At Least.
 */
export const DEFAULT_LINE_SPACE_STYLE = 1

/**
 * Vertical compensation needed after switching normal glyph placement from
 * top-anchored to baseline-anchored coordinates.
 */
export const STACK_VERTICAL_SHIFT_FACTOR = 0.3

/**
 * Clear space between a fraction stack divider and the rows above/below it,
 * as a fraction of the current glyph height.
 *
 * The bar must stay outside both the numerator descenders and the denominator
 * cap line; otherwise it is drawn through the lower row.
 */
export const STACK_DIVIDER_GAP_FACTOR = 0.05
