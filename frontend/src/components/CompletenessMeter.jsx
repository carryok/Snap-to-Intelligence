import { scoreBand } from '../lib/confidence'

/**
 * Completeness meter.
 *
 * Form decision: a METER, not a gauge and not a donut. The data is a single
 * ratio against a limit (fields filled / fields expected). A radial gauge
 * spends a lot of pixels encoding one number less precisely, and a 2-slice
 * donut is the classic anti-pattern.
 *
 * The hero figure uses proportional figures, not tabular-nums — tabular gives
 * every digit the width of a "0", which looks loose at display sizes.
 */
export function CompletenessMeter({ completeness }) {
  const score = completeness?.score ?? 0
  const filled = completeness?.fields_filled ?? 0
  const expected = completeness?.expected_fields ?? 0
  const missing = completeness?.missing_fields?.length ?? 0
  const b = scoreBand(score)

  return (
    <section className={`meter meter--${b}`} aria-labelledby="meter-title">
      <div className="meter__top">
        <h2 className="meter__title" id="meter-title">Profile completeness</h2>
        <span className="meter__hero">{score}<span className="meter__pctsign">%</span></span>
      </div>

      <div
        className="meter__track"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Profile completeness: ${score} percent, ${filled} of ${expected} expected fields`}
      >
        <div className="meter__fill" style={{ width: `${Math.max(score, 1.5)}%` }} />
      </div>

      <p className="meter__sub">
        <strong>{filled}</strong> of {expected} expected fields
        {missing > 0 && <> · <strong>{missing}</strong> missing</>}
      </p>
    </section>
  )
}
