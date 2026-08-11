import { useState } from 'react'
import { ConfidenceBadge } from './ConfidenceBadge'
import { displayName, isUrl, sortFields, sourceLabel } from '../lib/fields'
import { band } from '../lib/confidence'

function SourceTag({ sourceType }) {
  // Neutral chip, never a status colour — where a value came from is not a
  // judgement about whether it's good.
  return <span className={`stag stag--${sourceType}`}>{sourceLabel(sourceType)}</span>
}

function SourceLine({ reference }) {
  if (!reference) return <span className="detail__value detail__value--muted">Not recorded</span>
  if (isUrl(reference)) {
    return (
      <a className="detail__link" href={reference} target="_blank" rel="noreferrer noopener">
        {reference.replace(/^https?:\/\//, '').slice(0, 60)}
        <span aria-hidden="true"> ↗</span>
      </a>
    )
  }
  // Person A's references are the literal string "photo label", so this
  // branch fires on day one.
  return <span className="detail__value">{reference}</span>
}

function FieldDetail({ field, review, onApprove, onEdit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.value ?? '')
  const conflicts = field.conflicting_values ?? []

  return (
    <div className="detail">
      <dl className="detail__grid">
        <dt>As extracted</dt>
        <dd>
          {/* Always shown, even when identical to the value. The whole
              traceability pitch is "you can see exactly what was on the
              label" — hiding it when it happens to match undercuts that. */}
          <code className="detail__raw">{field.raw_value ?? '—'}</code>
        </dd>

        <dt>Source</dt>
        <dd><SourceLine reference={field.source_reference} /></dd>

        {field.unit && (
          <>
            <dt>Unit</dt>
            <dd className="detail__value">{field.unit}</dd>
          </>
        )}
      </dl>

      {conflicts.length > 0 && (
        <div className="conflicts">
          <p className="conflicts__title">
            {conflicts.length === 1 ? 'One source disagreed' : `${conflicts.length} sources disagreed`}
          </p>
          <ul className="conflicts__list">
            {conflicts.map((c, i) => (
              <li key={i} className="conflicts__row">
                <span className="conflicts__value">{String(c.value)}</span>
                <SourceTag sourceType={c.source_type} />
                <ConfidenceBadge confidence={c.confidence} size="sm" />
                {isUrl(c.source_reference) && (
                  <a className="conflicts__link" href={c.source_reference} target="_blank" rel="noreferrer noopener">
                    view
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="conflicts__note">
            Kept the most authoritative value. Nothing was discarded.
          </p>
        </div>
      )}

      <div className="detail__actions">
        {editing ? (
          <>
            <input
              className="detail__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`New value for ${displayName(field)}`}
              autoFocus
            />
            <button type="button" className="btn btn--sm btn--primary" onClick={() => { onEdit(draft); setEditing(false) }}>
              Save
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setDraft(field.value ?? ''); setEditing(false) }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={onApprove}
              disabled={review === 'approved'}
            >
              {review === 'approved' ? 'Approved' : 'Approve'}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(true)}>
              Edit value
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function FieldRow({ field, expanded, onToggle, review, onApprove, onEdit }) {
  const conflicts = field.conflicting_values?.length ?? 0
  const rowId = `field-${field.field_name}`

  return (
    <li className={`frow${expanded ? ' frow--open' : ''}`}>
      <button
        type="button"
        className="frow__button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`${rowId}-detail`}
      >
        <span className="frow__name">
          {displayName(field)}
          {review === 'approved' && <span className="frow__approved" title="Approved by reviewer" aria-label="approved"> ✓</span>}
          {review === 'edited' && <span className="frow__edited">edited</span>}
        </span>

        <span className="frow__value">
          {field.value === null || field.value === undefined || field.value === ''
            ? <em className="frow__empty">not found</em>
            : String(field.value)}
          {conflicts > 0 && (
            <span className="frow__conflict" title={`${conflicts} conflicting value${conflicts > 1 ? 's' : ''}`}>
              ⚠ {conflicts}
            </span>
          )}
        </span>

        <span className="frow__badge"><ConfidenceBadge confidence={field.confidence} size="sm" /></span>
        <span className="frow__source"><SourceTag sourceType={field.source_type} /></span>
        <span className="frow__chev" aria-hidden="true">›</span>
      </button>

      {expanded && (
        <div id={`${rowId}-detail`} className="frow__detail">
          <FieldDetail field={field} review={review} onApprove={onApprove} onEdit={onEdit} />
        </div>
      )}
    </li>
  )
}

export function FieldList({ fields }) {
  const [openField, setOpenField] = useState(null)
  const [reviews, setReviews] = useState({})
  const [edits, setEdits] = useState({})
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false)

  const sorted = sortFields(fields)
  const needsReview = (f) =>
    band(f.confidence) !== 'high' || (f.conflicting_values?.length ?? 0) > 0
  const visible = onlyNeedsReview ? sorted.filter(needsReview) : sorted
  const reviewCount = sorted.filter(needsReview).length

  return (
    <section className="flist" aria-labelledby="flist-title">
      <div className="flist__head">
        <h2 id="flist-title">
          Extracted fields{' '}
          {/* While the filter is on the badge has to describe the rows you can
              actually see — a bare "10" over six rows reads as a bug. */}
          <span className="flist__count">
            {onlyNeedsReview ? `${visible.length} of ${sorted.length}` : sorted.length}
          </span>
        </h2>
        {reviewCount > 0 && (
          <label className="flist__filter">
            <input
              type="checkbox"
              checked={onlyNeedsReview}
              onChange={(e) => setOnlyNeedsReview(e.target.checked)}
            />
            Needs review only ({reviewCount})
          </label>
        )}
      </div>

      <ul className="flist__rows">
        {visible.map((field) => {
          const key = field.field_name
          const shown = edits[key] !== undefined ? { ...field, value: edits[key] } : field
          return (
            <FieldRow
              key={key}
              field={shown}
              expanded={openField === key}
              onToggle={() => setOpenField(openField === key ? null : key)}
              review={edits[key] !== undefined ? 'edited' : reviews[key]}
              onApprove={() => setReviews({ ...reviews, [key]: 'approved' })}
              onEdit={(value) => setEdits({ ...edits, [key]: value })}
            />
          )
        })}
      </ul>

      {visible.length === 0 && (
        <p className="flist__none">Every field is high confidence with no conflicts.</p>
      )}
    </section>
  )
}
