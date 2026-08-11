import { band } from './confidence'

/** Acronyms and units that title-casing would mangle. */
const OVERRIDES = {
  ip_rating: 'IP Rating',
  hp: 'HP',
  rpm: 'RPM',
  kw: 'kW',
  kva: 'kVA',
  ac_dc: 'AC/DC',
  emc: 'EMC',
  ce_marking: 'CE Marking',
  ul_listing: 'UL Listing',
  sku: 'SKU',
  mpn: 'MPN',
  upc: 'UPC',
  led: 'LED',
  usb: 'USB',
  model_number: 'Model Number',
  serial_number: 'Serial Number',
  part_number: 'Part Number',
  country_of_origin: 'Country of Origin',
}

export function prettifyFieldName(name) {
  if (!name) return 'Unknown field'
  const key = String(name).toLowerCase()
  if (OVERRIDES[key]) return OVERRIDES[key]
  return key
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function displayName(field) {
  return field?.display_name || prettifyFieldName(field?.field_name)
}

export const SOURCE_LABEL = {
  label: 'On the label',
  manufacturer_site: 'Manufacturer',
  datasheet_pdf: 'Datasheet',
  distributor: 'Distributor',
  generic_web: 'Web',
  inferred: 'Inferred',
}

export function sourceLabel(sourceType) {
  return SOURCE_LABEL[sourceType] || SOURCE_LABEL.generic_web
}

export function isUrl(reference) {
  if (!reference) return false
  return /^https?:\/\//i.test(String(reference).trim())
}

const IDENTITY_ORDER = ['brand', 'model_number', 'serial_number']

/**
 * Sort order: identity first (what a human looks for), then conflicted fields,
 * then LOWEST confidence first.
 *
 * That last one is deliberate. Person A's FINDINGS.md concludes confidence is a
 * triage signal for human review — so the UI surfaces what needs checking
 * instead of burying it under the fields that are already fine.
 */
export function sortFields(fields = []) {
  return [...fields].sort((a, b) => {
    const ai = IDENTITY_ORDER.indexOf(a.field_name)
    const bi = IDENTITY_ORDER.indexOf(b.field_name)
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    }

    const ac = (a.conflicting_values?.length ?? 0) > 0
    const bc = (b.conflicting_values?.length ?? 0) > 0
    if (ac !== bc) return ac ? -1 : 1

    const diff = (a.confidence ?? 0) - (b.confidence ?? 0)
    if (Math.abs(diff) > 0.001) return diff

    return displayName(a).localeCompare(displayName(b))
  })
}

export function countByBand(fields = []) {
  return fields.reduce(
    (acc, f) => {
      acc[band(f.confidence)] += 1
      return acc
    },
    { high: 0, medium: 0, low: 0 }
  )
}

export function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const QUALITY_LABEL = {
  clear: null, // nothing to warn about
  blurry: 'Blurry image',
  partially_obscured: 'Partially obscured',
  glare: 'Glare on label',
  unknown: null,
}
