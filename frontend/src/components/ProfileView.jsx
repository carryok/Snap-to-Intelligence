import { CompletenessMeter } from './CompletenessMeter'
import { FieldList } from './FieldList'
import { prettifyFieldName, QUALITY_LABEL } from '../lib/fields'

function IdentityHeader({ identity, image }) {
  const { brand, model_number: model, serial_number: serial, category } = identity || {}
  const quality = QUALITY_LABEL[image?.quality_flag]

  return (
    <header className="ident">
      {image?.url && (
        <img className="ident__thumb" src={image.url} alt={image.filename || 'Scanned label'} />
      )}
      <div className="ident__text">
        <p className="ident__brand">{brand || 'Unknown manufacturer'}</p>
        {/* tabular-nums here on purpose: model numbers are alphanumeric codes
            and Person A's FINDINGS.md documents O-vs-0 confusion, so even
            digit widths help a human spot it. */}
        <h1 className="ident__model">{model || 'Model not identified'}</h1>
        <div className="ident__meta">
          {serial && <span className="ident__chip">Serial {serial}</span>}
          {category && <span className="ident__chip">{prettifyFieldName(category)}</span>}
          {quality && <span className="ident__chip ident__chip--warn">{quality}</span>}
        </div>
      </div>
    </header>
  )
}

function StatusBanner({ warnings }) {
  if (!warnings || warnings.length === 0) return null
  return (
    <div className="banner" role="status">
      <span className="banner__glyph" aria-hidden="true">▲</span>
      <ul className="banner__list">
        {warnings.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
    </div>
  )
}

function MissingFields({ missing }) {
  if (!missing || missing.length === 0) return null
  return (
    <section className="missing" aria-labelledby="missing-title">
      <h2 id="missing-title" className="missing__title">
        Not found <span className="missing__count">{missing.length}</span>
      </h2>
      <p className="missing__note">
        Expected for this product category, but not on the label and not found
        in any source we checked.
      </p>
      <ul className="missing__chips">
        {missing.map((name) => (
          <li key={name} className="missing__chip">{prettifyFieldName(name)}</li>
        ))}
      </ul>
    </section>
  )
}

function ConfidenceStrip({ summary, total }) {
  if (!summary || !total) return null
  const seg = (key) => ((summary[key] || 0) / total) * 100
  return (
    <div className="cstrip" title="Confidence distribution across all fields">
      <div className="cstrip__bar">
        {['high', 'medium', 'low'].map((k) =>
          summary[k] > 0 ? (
            <span key={k} className={`cstrip__seg cstrip__seg--${k}`} style={{ width: `${seg(k)}%` }} />
          ) : null
        )}
      </div>
      <div className="cstrip__keys">
        {['high', 'medium', 'low'].map((k) => (
          <span key={k} className="cstrip__key">
            <i className={`cstrip__dot cstrip__dot--${k}`} aria-hidden="true" />
            {summary[k] || 0} {k}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ProfileView({ envelope, onReset }) {
  const profile = envelope?.profile
  if (!profile) return null

  const fields = profile.fields || []
  const hasFields = fields.length > 0

  return (
    <div className="profile">
      <StatusBanner warnings={profile.warnings} />

      <IdentityHeader identity={profile.identity} image={profile.image} />

      {hasFields ? (
        <>
          <div className="profile__scores">
            <CompletenessMeter completeness={profile.completeness} />
            <ConfidenceStrip summary={profile.confidence_summary} total={fields.length} />
          </div>

          <FieldList fields={fields} />
          <MissingFields missing={profile.completeness?.missing_fields} />
        </>
      ) : (
        <section className="unreadable">
          <h2>We couldn't read any details from this image</h2>
          <ul className="unreadable__tips">
            <li>Get closer, so the label fills most of the frame</li>
            <li>Avoid glare — angle away from direct light</li>
            <li>Hold steady until the photo is sharp</li>
          </ul>
        </section>
      )}

      <div className="profile__foot">
        <button type="button" className="btn btn--primary" onClick={onReset}>
          Scan another
        </button>
      </div>
    </div>
  )
}
