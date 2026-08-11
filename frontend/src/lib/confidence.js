/**
 * Confidence banding — the ONE source of truth on the frontend.
 * These thresholds must match backend/assemble.py (BAND_HIGH / BAND_MEDIUM).
 */

export const BANDS = { HIGH: 0.85, MEDIUM: 0.6 }

export function band(confidence) {
  const c = Number(confidence)
  if (!Number.isFinite(c)) return 'low'
  if (c >= BANDS.HIGH) return 'high'
  if (c >= BANDS.MEDIUM) return 'medium'
  return 'low'
}

/**
 * Never the word "verified" — Person A's FINDINGS.md documents the model
 * returning 1.0 confidence on an illegible serial number. Confidence is a
 * triage signal, not a promise of correctness.
 */
export const BAND_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }

/** Distinct shapes, so colour is never the only channel. */
export const BAND_GLYPH = { high: '●', medium: '▲', low: '◆' }

export function pct(confidence) {
  const c = Number(confidence)
  return Number.isFinite(c) ? `${Math.round(c * 100)}%` : '—'
}

/** Completeness meter fill colour: the fill carries severity. */
export function scoreBand(score) {
  if (score >= 80) return 'high'
  if (score >= 50) return 'medium'
  return 'low'
}
