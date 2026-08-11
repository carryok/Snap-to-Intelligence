import { useRef, useState } from 'react'
import { formatBytes, sourceLabel } from '../lib/fields'

export function UploadPanel({
  file,
  previewUrl,
  error,
  samples,
  onSelect,
  onClear,
  onScan,
  onLoadMock,
}) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [pickedSample, setPickedSample] = useState(null)

  const pick = (files) => {
    if (files && files.length > 0) onSelect(files[0])
  }

  return (
    <section className="upload">
      <div className="upload__head">
        <h1>Snap a label, get the whole profile</h1>
        <p className="upload__sub">
          Photograph any industrial nameplate — the app reads what's printed,
          fills in what's missing, and shows you where every value came from.
        </p>
      </div>

      {error && <div className="upload__error" role="alert">{error}</div>}

      <div className="upload__zone-wrap">
        <div
          className={`dropzone${dragOver ? ' dropzone--over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            pick(e.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          onPaste={(e) => pick(e.clipboardData?.files)}
          role="button"
          tabIndex={0}
          aria-label="Choose an image of a product label"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="dropzone__input"
            onChange={(e) => pick(e.target.files)}
            tabIndex={-1}
          />
          <div className="dropzone__icon" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
              <circle cx="12" cy="13.5" r="3.5" />
            </svg>
          </div>
          <p className="dropzone__title">Drop an image, paste, or <em>browse</em></p>
          <p className="dropzone__hint">JPG, PNG, or WebP · up to 10 MB · camera opens on phone</p>
        </div>
      </div>

      {file && (
        <div className="preview-card">
          <img className="preview-card__img" src={previewUrl} alt={file.name} />
          <div className="preview-card__meta">
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </div>
          <div className="preview-card__actions">
            <button type="button" className="btn btn--ghost" onClick={onClear}>
              Clear
            </button>
            <button type="button" className="btn btn--primary" onClick={() => onScan('auto')}>
              Scan label
            </button>
          </div>
        </div>
      )}

      {!file && samples.length > 0 && (
        <div className="samples">
          <span className="samples__label">Or try a sample profile</span>
          <div className="samples__list">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sample-chip${pickedSample === s.id ? ' sample-chip--active' : ''}`}
                onClick={() => {
                  setPickedSample(s.id)
                  onLoadMock(s.id)
                }}
              >
                <span className="sample-chip__initials">
                  {(s.brand || 'P').slice(0, 2).toUpperCase()}
                </span>
                <span className="sample-chip__name">
                  {s.brand || 'Sample'}
                  {s.model_number ? ` · ${s.model_number}` : ''}
                </span>
                <span className="sample-chip__score">{s.score ?? '—'}%</span>
              </button>
            ))}
          </div>
          <p className="samples__note">Sample profiles come from Person B's mock files in <code>/shared/mocks</code>.</p>
        </div>
      )}

      <details className="source-legend">
        <summary>What do the source tags mean?</summary>
        <ul className="source-legend__list">
          {Object.entries({
            label: 'On the label — read straight off the photo',
            manufacturer_site: 'Manufacturer — from the maker\'s own site',
            datasheet_pdf: 'Datasheet — from an official specification document',
            distributor: 'Distributor — from a reseller listing',
            generic_web: 'Web — from a general web result',
          }).map(([key, text]) => (
            <li key={key}>
              <span className="source-legend__chip">{sourceLabel(key)}</span>
              {text}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
