import { BAND_GLYPH, BAND_LABEL, band, pct } from '../lib/confidence'

/**
 * Confidence badge.
 *
 * Colour NEVER carries the meaning alone: every badge shows a distinct shape
 * AND a word AND the number. Red/amber/green alone is the most common
 * colourblind failure in dashboards, and a judge may well be red-green
 * colourblind.
 *
 * The text is an ink token, never the status colour — status yellow (#fab219)
 * is 1.79:1 on the light surface and illegible as text. So: tinted pill,
 * solid-coloured glyph, primary-ink label.
 */
export function ConfidenceBadge({ confidence, size = 'md' }) {
  const b = band(confidence)
  return (
    <span
      className={`badge badge--${b} badge--${size}`}
      title={`${BAND_LABEL[b]} confidence — ${pct(confidence)}`}
    >
      <span className="badge__glyph" aria-hidden="true">{BAND_GLYPH[b]}</span>
      <span className="badge__label">{BAND_LABEL[b]}</span>
      <span className="badge__pct">{pct(confidence)}</span>
    </span>
  )
}
