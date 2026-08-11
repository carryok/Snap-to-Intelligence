/**
 * Error state.
 *
 * Every failure offers a route forward — on stage, a dead end is the demo
 * ending. So: retry, and a one-click sample fallback.
 */
export function ErrorView({ error, detail, samples, onRetry, onLoadMock, onReset }) {
  const hasSamples = samples && samples.length > 0

  return (
    <section className="errview">
      <div className="errview__glyph" aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5M12 16.2v.3" />
        </svg>
      </div>

      <h2 className="errview__title">That scan didn't go through</h2>
      <p className="errview__msg">{error || 'Something went wrong on the way to the server.'}</p>

      {detail && (
        /* The SDK's own words, one click away. Useful to whoever is running the
           server, invisible to whoever is watching the demo. */
        <details className="errview__detail">
          <summary>Technical details</summary>
          <pre className="errview__trace">{detail}</pre>
        </details>
      )}

      <div className="errview__actions">
        <button type="button" className="btn btn--primary" onClick={onRetry}>
          Try again
        </button>
        {hasSamples && (
          <button type="button" className="btn btn--ghost" onClick={() => onLoadMock(samples[0].id)}>
            Use a sample profile
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onReset}>
          Start over
        </button>
      </div>
    </section>
  )
}
