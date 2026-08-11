const STAGES = [
  { key: 'uploading', label: 'Uploading image' },
  { key: 'extracting', label: 'Reading the label' },
  { key: 'enriching', label: 'Enriching from sources' },
]

/**
 * Deliberately NOT a spinner.
 *
 * Real latency is 5-20s for extraction (a Gemini file upload plus a generate
 * call) and potentially 10-30s more for enrichment. A bare spinner for 40
 * seconds reads as "it's broken". Stages advance on a timer rather than from
 * the server — a real progress channel would need SSE, which isn't worth the
 * complexity here.
 */
export function ProcessingView({ stage, slow, previewUrl }) {
  const activeIndex = STAGES.findIndex((s) => s.key === stage)

  return (
    <section className="processing" aria-live="polite" aria-busy="true">
      {previewUrl && (
        <div className="processing__imgwrap">
          <img className="processing__img" src={previewUrl} alt="The label being scanned" />
          <div className="processing__scanline" aria-hidden="true" />
        </div>
      )}

      <ol className="stages">
        {STAGES.map((s, i) => {
          const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo'
          return (
            <li key={s.key} className={`stages__item stages__item--${state}`}>
              <span className="stages__marker" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'active' ? '' : ''}
              </span>
              <span className="stages__label">{s.label}</span>
            </li>
          )
        })}
      </ol>

      <p className="processing__note">
        {slow ? 'Still working — the model is being slow right now.' : 'Usually takes 10–30 seconds.'}
      </p>
    </section>
  )
}
