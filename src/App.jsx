import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

function LoadingDots() {
  const [dots, setDots] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setDots(d => d >= 3 ? 1 : d + 1), 420)
    return () => clearInterval(id)
  }, [])
  return <span style={{ letterSpacing: 1 }}>{'•'.repeat(dots)}<span style={{ opacity: 0 }}>{'•'.repeat(3 - dots)}</span></span>
}

const webserverEndPoint = import.meta.env.DEV
  ? 'http://localhost:80'
  : 'https://lab-document-query-g6djhxfnajdjgmbr.swedencentral-01.azurewebsites.net';

const FILTER_FIELDS = [
  { key: 'tittel',            label: 'Rapport' },
  { key: 'publisert_av',      label: 'Publisert av' },
  { key: 'segment',           label: 'Segment' },
  { key: 'type_kilde',        label: 'Type kilde' },
  { key: 'malgruppe',         label: 'Målgruppe' },
  { key: 'publisert_arstall', label: 'Årstall' },
]

// Each query type can declare which indexes it applies to. An empty/missing
// `indexes` list means the type is available for every index.
const QUERY_TYPES = [
  { key: 'problems', label: 'Problemer',         description: 'Hvilke problemer sliter unge med?',          indexes: ['DigiUng_lab'] },
  { key: 'moments',  label: 'Kritiske øyeblikk', description: 'Vendepunkter i unges liv',                   indexes: ['DigiUng_lab'] },
  { key: 'personas', label: 'Personas',          description: 'Syntetiser personas basert på funn',         indexes: ['DigiUng_lab'] },
  { key: 'free',     label: 'Fri analyse',       description: 'Åpent spørsmål på tvers av alle dokumenter' },
  { key: 'strategisk_risiko', label: 'Strategisk risiko', description: 'Analysekjede per dokument: driver → sårbarhet → konsekvens → risiko', indexes: ['Strategisk_risiko'] },
]

function queryTypesForIndex(indexName) {
  return QUERY_TYPES.filter(qt => !qt.indexes?.length || qt.indexes.includes(indexName))
}

// query_type values that produce the structured analysekjede output.
const STRUCTURED_OUTPUT_KEYS = {
  problems: 'problems', moments: 'moments', personas: 'personas',
  free: 'findings', strategisk_risiko: 'risikoomrader',
}

// Example questions are keyed by index name, then by mode. `_default` is used
// for any index without a tailored set (and as a per-mode fallback).
const EXAMPLE_QUESTIONS = {
  _default: {
    query: [
      'Hva sier dokumentene om dette temaet?',
      'Hvilke sammenhenger beskrives i materialet?',
      'Hva er hovedfunnene knyttet til problemstillingen?',
    ],
    aggregate: [
      'Hvilke temaer er gjennomgående i materialet?',
      'Hva er de viktigste funnene på tvers av dokumentene?',
      'Hvilke mønstre beskrives i flere av dokumentene?',
    ],
  },
  DigiUng_lab: {
    query: [
      'Hva sier rapportene om skolefravær?',
      'Hvilke risikofaktorer henger sammen med ungdomskriminalitet?',
      'Hvordan påvirker sosiale medier mental helse hos unge?',
    ],
    aggregate: [
      'Hvilke utfordringer er gjennomgående blant unge i materialet?',
      'Hva er de viktigste vendepunktene i unges liv?',
      'Hvilke behov beskrives på tvers av dokumentene?',
    ],
  },
  Strategisk_risiko: {
    query: [
      'Hva sier dokumentene om Helsedirektoratets samfunnsoppdrag?',
      'Hvilke styringskrav fremgår av tildelingsbrevene?',
      'Hva sier Riksrevisjonen om direktoratets måloppnåelse?',
    ],
    aggregate: [
      'Hvilke strategiske risikoer fremgår på tvers av dokumentene?',
      'Hvilke drivere og sårbarheter er gjennomgående?',
      'Hvilke kunnskapshull bør ledergruppen være oppmerksom på?',
    ],
  },
}

function examplesFor(indexName, mode) {
  const byIndex = EXAMPLE_QUESTIONS[indexName] || EXAMPLE_QUESTIONS._default
  return byIndex[mode] || EXAMPLE_QUESTIONS._default[mode] || []
}

// ── Themes ────────────────────────────────────────────────────────────────────
// Each theme provides the same keys as C. Inspired by chatbot-client-HEI20-v2.
const THEMES = {
  slate: {
    label: 'Lys', swatch: '#FFFFFF',
    bg: '#F8FAFC', surface: '#FFFFFF', border: '#E2E8F0', borderHi: '#CBD5E1',
    text: '#0F172A', textMute: '#475569', textFaint: '#94A3B8',
    accent: '#2563EB', accentBg: '#EFF6FF', accentSoft: '#DBEAFE',
    success: '#059669', successBg: '#ECFDF5',
    warn: '#B45309', warnBg: '#FEF3C7',
    danger: '#DC2626', dangerBg: '#FEF2F2',
    tintMoments: '#F5F3FF',
  },
  dark: {
    label: 'Mørk', swatch: '#02404A',
    bg: '#062330', surface: '#02404A', border: 'rgba(255,255,255,0.12)', borderHi: 'rgba(255,255,255,0.24)',
    text: '#FFFFFF', textMute: '#E1EFE3', textFaint: '#9FB5A6',
    accent: '#8EC9FF', accentBg: '#02636C', accentSoft: '#02404A',
    success: '#34D399', successBg: '#064E3B',
    warn: '#FBBF24', warnBg: '#78350F',
    danger: '#F87171', dangerBg: '#7F1D1D',
    tintMoments: '#3B2A55',
  },
  sea: {
    label: 'Sjø', swatch: '#02636C',
    bg: '#E1EFE3', surface: '#FFFFFF', border: 'rgba(2,64,74,0.16)', borderHi: 'rgba(2,64,74,0.30)',
    text: '#062330', textMute: '#02404A', textFaint: '#5E7A6A',
    accent: '#02636C', accentBg: '#CFE3D3', accentSoft: '#E1EFE3',
    success: '#059669', successBg: '#ECFDF5',
    warn: '#B45309', warnBg: '#FEF3C7',
    danger: '#DC2626', dangerBg: '#FEF2F2',
    tintMoments: '#EDE5F3',
  },
  lavender: {
    label: 'Lavendel', swatch: '#EDE5F3',
    bg: '#EDE5F3', surface: '#FFFFFF', border: 'rgba(93,64,122,0.16)', borderHi: 'rgba(93,64,122,0.30)',
    text: '#2E1E3D', textMute: '#5D407A', textFaint: '#7A6E8A',
    accent: '#6B46B5', accentBg: '#E0D3EE', accentSoft: '#EDE5F3',
    success: '#059669', successBg: '#ECFDF5',
    warn: '#B45309', warnBg: '#FEF3C7',
    danger: '#DC2626', dangerBg: '#FEF2F2',
    tintMoments: '#F0E6FA',
  },
  peach: {
    label: 'Fersken', swatch: '#FEEEDB',
    bg: '#FEEEDB', surface: '#FFFFFF', border: 'rgba(122,74,32,0.16)', borderHi: 'rgba(122,74,32,0.30)',
    text: '#3D2610', textMute: '#7A4A20', textFaint: '#8A7060',
    accent: '#B8764A', accentBg: '#F7E0C4', accentSoft: '#FEEEDB',
    success: '#059669', successBg: '#ECFDF5',
    warn: '#B45309', warnBg: '#FEF3C7',
    danger: '#DC2626', dangerBg: '#FEF2F2',
    tintMoments: '#F5F3FF',
  },
}
const THEME_LIST = Object.entries(THEMES).map(([key, t]) => ({ key, ...t }))
const DEFAULT_THEME = 'slate'
const THEME_STORAGE_KEY = 'digiung_lab.theme'

// Mutable palette objects — components reference these by name and read fresh
// values on every render, so mutating in place updates the whole UI on theme switch.
const C = { ...THEMES[DEFAULT_THEME] }
const card = {
  background: C.surface,
  borderRadius: 12,
  border: `1px solid ${C.border}`,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
}
const metaLabel = {
  fontSize: 11, fontWeight: 600, color: C.textFaint,
  textTransform: 'uppercase', letterSpacing: '.08em',
}
const QUERY_TYPE_TINT = {
  problems: C.dangerBg,
  moments:  C.tintMoments,
  personas: C.successBg,
  free:     C.warnBg,
  strategisk_risiko: C.accentSoft,
}

function applyTheme(name) {
  const t = THEMES[name] || THEMES[DEFAULT_THEME]
  Object.assign(C, t)
  Object.assign(card, {
    background: C.surface,
    border: `1px solid ${C.border}`,
  })
  Object.assign(metaLabel, { color: C.textFaint })
  Object.assign(QUERY_TYPE_TINT, {
    problems: C.dangerBg,
    moments:  C.tintMoments,
    personas: C.successBg,
    free:     C.warnBg,
    strategisk_risiko: C.accentSoft,
  })
  if (typeof document !== 'undefined') {
    document.body.style.background = C.bg
    document.body.style.color = C.text
  }
}

function Tag({ tone = 'neutral', children }) {
  const palette = {
    neutral: { bg: '#F1F5F9', color: C.textMute },
    accent:  { bg: C.accentBg,  color: C.accent },
    success: { bg: C.successBg, color: C.success },
    warn:    { bg: C.warnBg,    color: C.warn },
  }[tone] || { bg: '#F1F5F9', color: C.textMute }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
      borderRadius: 6, fontSize: 12, fontWeight: 500,
      background: palette.bg, color: palette.color,
    }}>{children}</span>
  )
}

function Chevron({ open }) {
  return (
    <span style={{
      fontSize: 10, color: C.textFaint, display: 'inline-block',
      transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s',
    }}>▶</span>
  )
}

function SectionToggle({ open, onToggle, label, badge }) {
  return (
    <div
      onClick={onToggle}
      onMouseDown={e => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', width: 'fit-content' }}
    >
      <Chevron open={open} />
      <span style={{ fontSize: 13, color: C.textMute, fontWeight: 500 }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          background: C.accent, color: '#fff', borderRadius: 99,
          padding: '1px 7px', fontSize: 11, fontWeight: 600,
        }}>{badge}</span>
      )}
    </div>
  )
}

function MultiSelect({ label, options = [], selected, onChange, meta, wide }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const count = selected.length
  const toggle = val => onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val])

  useEffect(() => {
    if (!open) return
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={{ fontSize: 11, color: C.textMute, display: 'block', marginBottom: 4, fontWeight: 500 }}>{label}</label>
      <button onClick={() => setOpen(p => !p)} style={{
        width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8,
        background: C.surface, textAlign: 'left', cursor: 'pointer', fontSize: 13,
        color: count ? C.text : C.textFaint, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{count ? `${count} valgt` : '— alle —'}</span>
        <span style={{ fontSize: 10, color: C.textFaint }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          ...(wide ? { minWidth: 560, maxWidth: 'min(720px, 90vw)' } : { right: 0 }),
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: '0 8px 24px rgba(15,23,42,0.10)', maxHeight: 320, overflowY: 'auto', marginTop: 4,
        }}>
          {count > 0 && (
            <div onClick={() => { onChange([]); setOpen(false) }}
              style={{ padding: '8px 12px', fontSize: 12, color: C.textMute, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
              Fjern alle valg
            </div>
          )}
          {options.map(opt => {
            const sub = meta ? meta(opt) : null
            return (
              <label key={opt} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px',
                cursor: 'pointer', fontSize: 13,
                background: selected.includes(opt) ? C.accentBg : 'transparent',
              }}>
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)}
                  style={{ accentColor: C.accent, marginTop: 3 }} />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ color: C.text }}>{opt}</span>
                  {sub && <span style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>{sub}</span>}
                </div>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterPanel({ draft, onChangeDraft, onApply, onClear, options, entries }) {
  const panelRef = useRef(null)

  useEffect(() => {
    const handleMouseDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onApply()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onApply])

  const titleMeta = useMemo(() => {
    const m = new Map()
    for (const e of (entries || [])) {
      if (!e?.tittel || m.has(e.tittel)) continue
      const parts = []
      if (e.publisert_av) parts.push(String(e.publisert_av))
      if (e.publisert_arstall) parts.push(String(e.publisert_arstall))
      if (parts.length) m.set(e.tittel, parts.join(' · '))
    }
    return m
  }, [entries])

  return (
    <div ref={panelRef} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', marginTop: 10, background: C.bg }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px 16px', marginBottom: 14 }}>
        {Object.entries(options).filter(([, vals]) => vals?.length > 0).map(([key, vals]) => {
          const label = FILTER_FIELDS.find(f => f.key === key)?.label ?? key
          const isTitle = key === 'tittel'
          return (
            <div key={key} style={isTitle ? { gridColumn: '1 / -1' } : undefined}>
              <MultiSelect label={label}
                options={vals}
                selected={draft[key] || []}
                onChange={v => onChangeDraft(key, v)}
                meta={isTitle ? (v => titleMeta.get(v)) : undefined}
                wide={isTitle} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
        <button onClick={onApply} style={{
          fontSize: 13, padding: '7px 16px', borderRadius: 8,
          border: 'none', background: C.accent, color: '#fff', cursor: 'pointer', fontWeight: 500,
        }}>Bruk filtre</button>
        <button onClick={onClear} style={{
          fontSize: 13, padding: '7px 14px', borderRadius: 8,
          border: `1px solid ${C.border}`, background: 'none', color: C.textMute, cursor: 'pointer',
        }}>Nullstill</button>
      </div>
    </div>
  )
}

function ActiveFilterTags({ filters, onRemoveValue }) {
  const entries = Object.entries(filters).filter(([, v]) => v && v.length > 0)
  if (!entries.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {entries.flatMap(([key, values]) =>
        values.map(val => (
          <span key={`${key}:${val}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 4px 3px 10px', borderRadius: 6,
            fontSize: 12, fontWeight: 500, background: C.accentBg, color: C.accent,
            border: `1px solid ${C.accentSoft}`,
          }}>
            <span style={{ color: C.textMute, fontWeight: 400, marginRight: 2 }}>
              {FILTER_FIELDS.find(f => f.key === key)?.label ?? key}:
            </span>
            <strong>{val}</strong>
            <button onClick={() => onRemoveValue(key, val)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.accent, fontSize: 16, lineHeight: 1, padding: '0 4px' }}>×</button>
          </span>
        ))
      )}
    </div>
  )
}

function ParamSlider({ label, min, max, step, value, onChange, format }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: C.textMute }}>
      <label style={{ minWidth: 110 }}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{ width: 120, accentColor: C.accent }} />
      <span style={{ fontWeight: 600, minWidth: 36, color: C.text, fontSize: 13 }}>{format(value)}</span>
    </div>
  )
}

function SourceItem({ src }) {
  const [open, setOpen] = useState(false)
  // Web sources get a passage deep link; fall back to the plain source URL.
  const url = (src.deep_link || src.kilde_url || '').trim()
  const reportName = src.tittel || src.filename || 'unknown'
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {url
          ? <a href={url} target="_blank" rel="noopener noreferrer"
               style={{ color: C.accent, textDecoration: 'underline', fontWeight: 600, fontSize: 13, wordBreak: 'break-word' }}>
              {reportName} ↗
            </a>
          : <span style={{ color: C.text, fontWeight: 600, fontSize: 13, wordBreak: 'break-word' }}>{reportName}</span>}
        {src.page_number != null && <Tag tone="neutral">s. {src.page_number}</Tag>}
        <Tag tone="success">score {src.score.toFixed(2)}</Tag>
        {src.segment && <Tag tone="neutral">{src.segment}</Tag>}
        {src.publisert_av && <Tag tone="neutral">{src.publisert_av}</Tag>}
      </div>
      {src.tittel && src.filename && src.filename !== src.tittel && (
        <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 4, wordBreak: 'break-all' }}>{src.filename}</div>
      )}
      {src.excerpt && <>
        <span onClick={() => setOpen(p => !p)} style={{ fontSize: 12, color: C.accent, cursor: 'pointer', fontWeight: 500 }}>
          {open ? 'Skjul utdrag' : 'Vis utdrag'}
        </span>
        {open && <div style={{ fontSize: 13, color: C.text, lineHeight: 1.65, marginTop: 6, padding: '10px 14px', background: C.bg, borderRadius: 8, whiteSpace: 'pre-wrap', border: `1px solid ${C.border}` }}>{src.excerpt}</div>}
      </>}
    </div>
  )
}

function QueryResultCard({ data }) {
  const appliedFilters = data.filters || {}
  const sources = data.sources || []
  const isLoading = data._loading
  return (
    <div style={{ ...card, padding: '1.25rem 1.5rem', marginBottom: '0.875rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ ...metaLabel }}>Dokumentsøk</span>
        {data.index_name && <Tag tone="accent">{data.index_name}</Tag>}
        {isLoading && <span style={{ fontSize: 12, color: C.accent, fontWeight: 500 }}>søker…</span>}
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, color: C.text, marginBottom: 10, lineHeight: 1.4 }}>{data.question}</div>
      {Object.keys(appliedFilters).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
          {Object.entries(appliedFilters).map(([k, v]) => (
            <Tag key={k} tone="neutral">{FILTER_FIELDS.find(f => f.key === k)?.label ?? k}: {Array.isArray(v) ? v.join(', ') : v}</Tag>
          ))}
        </div>
      )}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0', color: C.textMute, fontSize: 14 }}>
          <LoadingDots /> Søker gjennom dokumentene…
        </div>
      ) : (
        <div style={{ fontSize: 15, lineHeight: 1.75, whiteSpace: 'pre-wrap', marginBottom: sources.length ? '1.25rem' : 0, color: C.text }}>{data.answer}</div>
      )}
      {!isLoading && sources.length > 0 && <>
        <div style={{ ...metaLabel, marginBottom: 8 }}>Kilder ({sources.length})</div>
        {sources.map((src, i) => <SourceItem key={i} src={src} />)}
      </>}
    </div>
  )
}

function AggregateItem({ item, queryType }) {
  const isPersona = queryType === 'personas'
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: C.text }}>{item.label}</div>
      <div style={{ fontSize: 14, color: C.textMute, lineHeight: 1.65, marginBottom: 8 }}>{item.description}</div>
      {isPersona && item.challenges?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ ...metaLabel, marginBottom: 6 }}>Utfordringer</div>
          {item.challenges.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: C.textMute, paddingLeft: 12, borderLeft: `2px solid ${C.accentSoft}`, marginBottom: 4 }}>{c}</div>
          ))}
        </div>
      )}
      {isPersona && item.needs?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ ...metaLabel, marginBottom: 6 }}>Behov</div>
          {item.needs.map((n, i) => (
            <div key={i} style={{ fontSize: 13, color: C.textMute, paddingLeft: 12, borderLeft: '2px solid #A7F3D0', marginBottom: 4 }}>{n}</div>
          ))}
        </div>
      )}
      <SourceTags sources={item.sources} />
    </div>
  )
}

function SourceTags({ sources }) {
  if (!sources?.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
      {sources.map((s, i) => {
        const isObj = s && typeof s === 'object'
        const tittel = isObj ? (s.tittel || '') : String(s)
        const pages  = isObj ? (s.pages || []) : []
        const url    = isObj ? (s.kilde_url || '').trim() : ''
        const label  = tittel + (pages.length ? ` (s. ${pages.join(', ')})` : '')
        const tag    = <Tag tone="neutral">{label}{url ? ' ↗' : ''}</Tag>
        return url
          ? <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>{tag}</a>
          : <span key={i}>{tag}</span>
      })}
    </div>
  )
}

// ── Strategisk risiko rendering ────────────────────────────────────────────────

function LabeledList({ label, values, tint }) {
  const vals = (values || []).filter(v => String(v).trim())
  if (!vals.length) return null
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ ...metaLabel, marginBottom: 6 }}>{label}</div>
      {vals.map((v, i) => (
        <div key={i} style={{ fontSize: 13, color: C.textMute, paddingLeft: 12, borderLeft: `2px solid ${tint || C.accentSoft}`, marginBottom: 4, lineHeight: 1.5 }}>{v}</div>
      ))}
    </div>
  )
}

function RiskItem({ item }) {
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: C.text }}>{item.label}</div>
      {item.beskrivelse && <div style={{ fontSize: 14, color: C.textMute, lineHeight: 1.65, marginBottom: 8 }}>{item.beskrivelse}</div>}
      <LabeledList label="Drivere"      values={item.drivere} />
      <LabeledList label="Sårbarheter"  values={item.sarbarheter} />
      <LabeledList label="Konsekvenser" values={item.konsekvenser} />
      <LabeledList label="Risikoer"     values={item.risikoer} tint={C.danger} />
      <SourceTags sources={item.sources} />
    </div>
  )
}

function RiskDocAnalysis({ entry }) {
  const [showChunks, setShowChunks] = useState(false)
  const s = entry.structured || {}
  const parts = [entry.tittel || entry.filename]
  if (entry.publisert_av) parts.push(entry.publisert_av)
  if (entry.publisert_arstall) parts.push(String(entry.publisert_arstall))
  const heading = parts.filter(Boolean).join(' · ')
  const url = (entry.kilde_url || '').trim()
  const chunks = entry.chunks || []
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: C.text }}>
        {url
          ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: 'none' }}>{heading} ↗</a>
          : heading}
      </div>
      {s.relevans && <div style={{ fontSize: 13, color: C.textMute, marginBottom: 8, fontStyle: 'italic' }}>{s.relevans}</div>}
      <LabeledList label="Kildefunn"            values={s.kildefunn} />
      <LabeledList label="Drivere"              values={s.drivere} />
      <LabeledList label="Mulige sårbarheter"   values={s.sarbarheter} />
      <LabeledList label="Mulige konsekvenser"  values={s.konsekvenser} />
      <LabeledList label="Foreløpige risikoer"  values={s.risikoer} tint={C.danger} />
      <LabeledList label="Avklaringsspørsmål"   values={s.avklaringssporsmal} />
      {s.kildegrunnlag_styrke && (
        <div style={{ fontSize: 12, color: C.textFaint, marginTop: 6 }}>
          <span style={{ fontWeight: 600 }}>Kildegrunnlag:</span> {s.kildegrunnlag_styrke}
        </div>
      )}
      {chunks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <SectionToggle open={showChunks} onToggle={() => setShowChunks(p => !p)} label={`Kildehenvisninger (${chunks.length})`} />
          {showChunks && chunks.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: C.textMute, marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${C.border}`, lineHeight: 1.5 }}>
              {c.page != null && <span style={{ fontWeight: 600 }}>[Side {c.page}] </span>}{c.excerpt}
              {c.deep_link && <> <a href={c.deep_link} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, whiteSpace: 'nowrap' }}>↗ til sitatet</a></>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const PROMPT_FIELDS = [
  { key: 'extract_system',   label: 'Extract — system' },
  { key: 'extract_prompt',   label: 'Extract — user' },
  { key: 'aggregate_system', label: 'Aggregate — system' },
  { key: 'aggregate_prompt', label: 'Aggregate — user' },
]

function PromptsEditor({ queryType, defs, server, onSaved }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgErr, setMsgErr] = useState(false)
  const cfg = defs[queryType]

  // Reset local edits whenever the type or its loaded prompts change.
  useEffect(() => { setDraft({}); setMsg('') }, [queryType, cfg])

  if (!cfg) return null

  const valueOf = (key) => (draft[key] !== undefined ? draft[key] : (cfg[key] || ''))
  const dirty = PROMPT_FIELDS.some(f => draft[f.key] !== undefined && draft[f.key] !== (cfg[f.key] || ''))
  const base = server.replace(/\/$/, '')

  const save = async () => {
    setBusy(true); setMsg(''); setMsgErr(false)
    try {
      const body = {}
      PROMPT_FIELDS.forEach(f => { body[f.key] = valueOf(f.key) })
      const res = await fetch(`${base}/admin/query-types/${queryType}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText) }
      setDraft({}); setMsg('Lagret'); onSaved && await onSaved()
    } catch (e) { setMsgErr(true); setMsg(`Feil: ${e.message}`) } finally { setBusy(false) }
  }

  const reset = async () => {
    setBusy(true); setMsg(''); setMsgErr(false)
    try {
      const res = await fetch(`${base}/admin/query-types/${queryType}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText) }
      setDraft({}); setMsg('Tilbakestilt til standard'); onSaved && await onSaved()
    } catch (e) { setMsgErr(true); setMsg(`Feil: ${e.message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <SectionToggle open={open} onToggle={() => setOpen(p => !p)} label="Rediger prompts" />
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PROMPT_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <div style={{ ...metaLabel, marginBottom: 4 }}>{label}</div>
              <textarea
                value={valueOf(key)}
                onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                spellCheck={false}
                style={{
                  width: '100%', boxSizing: 'border-box', minHeight: 90, resize: 'vertical',
                  padding: '8px 12px', background: C.bg, borderRadius: 8, fontSize: 12,
                  color: C.text, border: `1px solid ${C.border}`, fontFamily: 'monospace',
                  lineHeight: 1.5, outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={save} disabled={busy || !dirty} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: busy || !dirty ? '#93C5FD' : C.accent, color: '#fff',
              cursor: busy || !dirty ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}>Lagre</button>
            <button onClick={reset} disabled={busy} style={{
              padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.surface, color: C.textMute, cursor: busy ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
            }}>Tilbakestill til standard</button>
            {msg && <span style={{ fontSize: 12, color: msgErr ? C.danger : C.success }}>{msg}</span>}
          </div>
          <div style={{ fontSize: 11, color: C.textFaint }}>
            Endringer lagres på serveren og brukes ved neste analyse. Plassholdere som {'{question}'}, {'{tittel}'}, {'{context}'} må beholdes.
          </div>
        </div>
      )}
    </div>
  )
}

function ProgressBar({ index, total, tittel, nodeMessage }) {
  const pct = total > 0 ? Math.round((index / total) * 100) : 0
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: C.textMute, marginBottom: 8 }}>{nodeMessage || 'Kjører…'}</div>
      <div style={{ height: 6, background: C.border, borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${C.accent}, #60A5FA)`, borderRadius: 99, transition: 'width .3s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textFaint }}>
        <span style={{ maxWidth: 560, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tittel || ''}</span>
        <span style={{ fontWeight: 500 }}>{pct}% · {index}/{total}</span>
      </div>
    </div>
  )
}

function AggregateResultCard({ data }) {
  const qt = QUERY_TYPES.find(q => q.key === data.query_type) || QUERY_TYPES[0]
  const items = data[STRUCTURED_OUTPUT_KEYS[data.query_type]] || []
  const isLoading = data._loading
  const isRisk = data.query_type === 'strategisk_risiko'
  const perDoc = data.per_doc_findings || []
  const sectionHeading = { fontSize: 13, fontWeight: 700, color: C.text, margin: '4px 0 2px', textTransform: 'uppercase', letterSpacing: '.04em' }
  return (
    <div style={{ ...card, padding: '1.25rem 1.5rem', marginBottom: '0.875rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ ...metaLabel }}>Aggregert analyse</span>
        {data.index_name && <Tag tone="accent">{data.index_name}</Tag>}
        <Tag tone="neutral">{qt.label}</Tag>
        {isLoading && <span style={{ fontSize: 12, color: C.accent, fontWeight: 500 }}>kjører…</span>}
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, color: C.text, marginBottom: 12, lineHeight: 1.4 }}>{data.question}</div>
      {isLoading && (
        <ProgressBar index={data._docIndex ?? 0} total={data._docTotal ?? 0}
          tittel={data._docTittel} nodeMessage={data._nodeMessage} />
      )}
      {!isLoading && (
        <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 14, display: 'flex', gap: 16 }}>
          <span>{data.documents_visited} dokumenter besøkt</span>
          <span>{data.documents_with_findings} med funn</span>
          {isRisk
            ? (data.aggregated
                ? <span>{items.length} risikoområder</span>
                : <span>analyse per dokument</span>)
            : <span>{items.length} {qt.label.toLowerCase()}</span>}
        </div>
      )}

      {!isLoading && isRisk && (
        <>
          {data.aggregated && (items.length > 0 || (data.monstre || []).length > 0) && (
            <div style={{ marginBottom: 18 }}>
              <div style={sectionHeading}>Syntese på tvers (longlist)</div>
              <LabeledList label="Overordnede mønstre" values={data.monstre} />
              {items.map((item, i) => <RiskItem key={i} item={item} />)}
              <div style={{ marginTop: 12 }}>
                <LabeledList label="Usikkerhet og kunnskapshull" values={data.usikkerhet_kunnskapshull} />
                <LabeledList label="Spørsmål til ledergruppen" values={data.sporsmal_til_ledergruppen} />
              </div>
            </div>
          )}
          <div style={sectionHeading}>Analyse per dokument</div>
          {perDoc.length === 0
            ? <div style={{ fontSize: 14, color: C.textFaint, padding: '0.5rem 0' }}>Ingen dokumenter ga funn.</div>
            : perDoc.map((entry, i) => <RiskDocAnalysis key={i} entry={entry} />)}
        </>
      )}

      {!isLoading && !isRisk && (items.length === 0
        ? <div style={{ fontSize: 14, color: C.textFaint, padding: '0.5rem 0' }}>Ingen funn ble aggregert.</div>
        : items.map((item, i) => <AggregateItem key={i} item={item} queryType={data.query_type} />)
      )}
      {!isLoading && data._job_id && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <a href={`${webserverEndPoint.replace(/\/$/, '')}/aggregate/report/${data._job_id}`}
            download
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, color: C.accent, textDecoration: 'none',
              padding: '7px 14px', border: `1px solid ${C.accentSoft}`, borderRadius: 8,
              background: C.accentBg, fontWeight: 500,
            }}>
            ↓ Last ned rapport (.docx)
          </a>
        </div>
      )}
    </div>
  )
}

// ── Admin view ────────────────────────────────────────────────────────────────

const ADMIN_FIELDS = [
  { key: 'tittel',            label: 'Tittel',        type: 'text' },
  { key: 'segment',           label: 'Segment',       type: 'text' },
  { key: 'publisert_av',      label: 'Publisert av',  type: 'text' },
  { key: 'publisert_arstall', label: 'Årstall',       type: 'number' },
  { key: 'type_kilde',        label: 'Type kilde',    type: 'text' },
  { key: 'malgruppe',         label: 'Målgruppe',     type: 'text' },
  { key: 'antall_deltakere',  label: 'Ant. deltakere', type: 'text' },
  { key: 'oppsummering',      label: 'Oppsummering',  type: 'textarea' },
]

function entryKey(entry) { return entry.url || entry.filnavn || '' }
function entrySource(entry) {
  if (entry.url) return entry.url
  if (entry.filnavn) return entry.filnavn.split(/[\\\/]/).pop()
  return '—'
}

function AdminEntryRow({ entry, server, indexName, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const key = entryKey(entry)

  const startEdit = () => { setDraft(entry); setEditing(true); setErr('') }
  const cancel    = () => { setEditing(false); setErr('') }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const url = `${server.replace(/\/$/, '')}/admin/entries?index_name=${encodeURIComponent(indexName)}&key=${encodeURIComponent(key)}`
      const res = await fetch(url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setEditing(false)
      onSaved(data.entry)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm(`Slette «${entry.tittel || entrySource(entry)}» fra listen?\n(Filen og allerede indekserte chunks blir liggende.)`)) return
    setBusy(true); setErr('')
    try {
      const url = `${server.replace(/\/$/, '')}/admin/entries?index_name=${encodeURIComponent(indexName)}&key=${encodeURIComponent(key)}`
      const res = await fetch(url, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      onDeleted(key)
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <tr style={{ borderTop: `1px solid ${C.border}`, verticalAlign: 'top' }}>
      <td colSpan={5} style={{ padding: 0 }}>
        <div style={{ padding: '10px 14px' }}>
          {!editing && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.2fr 0.6fr auto', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {entry.tittel || <span style={{ color: C.textFaint, fontStyle: 'italic' }}>uten tittel</span>}
              </div>
              <div style={{ fontSize: 12, color: C.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entrySource(entry)}>
                {entry.url ? <Tag tone="accent">URL</Tag> : <Tag tone="neutral">FIL</Tag>}
                <span style={{ marginLeft: 6 }}>{entrySource(entry)}</span>
              </div>
              <div style={{ fontSize: 12, color: C.textMute }}>{entry.segment || '—'}</div>
              <div style={{ fontSize: 12, color: C.textMute }}>{entry.publisert_arstall ?? '—'}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={startEdit} disabled={busy} style={btn.ghost}>Rediger</button>
                <button onClick={remove}    disabled={busy} style={btn.danger}>Slett</button>
              </div>
            </div>
          )}
          {editing && (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 8 }}>{entrySource(entry)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                {ADMIN_FIELDS.map(f => (
                  <div key={f.key} style={{ gridColumn: f.type === 'textarea' ? '1 / -1' : 'auto' }}>
                    <label style={{ display: 'block', fontSize: 11, color: C.textMute, marginBottom: 3, fontWeight: 500 }}>{f.label}</label>
                    {f.type === 'textarea' ? (
                      <textarea value={draft[f.key] ?? ''} rows={3}
                        onChange={e => setDraft({ ...draft, [f.key]: e.target.value })}
                        style={inp.textarea} />
                    ) : (
                      <input type={f.type} value={draft[f.key] ?? ''}
                        onChange={e => setDraft({ ...draft, [f.key]: f.type === 'number' ? (e.target.value === '' ? null : parseInt(e.target.value)) : e.target.value })}
                        style={inp.text} />
                    )}
                  </div>
                ))}
              </div>
              {err && <div style={{ fontSize: 12, color: C.danger, marginTop: 8 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={save}   disabled={busy} style={btn.primary}>{busy ? 'Lagrer…' : 'Lagre'}</button>
                <button onClick={cancel} disabled={busy} style={btn.ghost}>Avbryt</button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function AddEntryForm({ server, indexName, onAdded, onClose }) {
  const [tab, setTab] = useState('file')
  const [file, setFile] = useState(null)
  const [meta, setMeta] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const base = server.replace(/\/$/, '')
      const url = `${base}/admin/entries?index_name=${encodeURIComponent(indexName)}`
      let res
      if (tab === 'file') {
        if (!file) throw new Error('Velg en fil')
        const fd = new FormData()
        fd.append('file', file)
        ADMIN_FIELDS.forEach(f => {
          const v = meta[f.key]
          if (v != null && v !== '') fd.append(f.key, String(v))
        })
        res = await fetch(url, { method: 'POST', body: fd })
      } else {
        if (!meta.url) throw new Error('URL er påkrevd')
        res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...meta, method: meta.method || 'GET' }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      onAdded(data.entry)
      onClose()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ ...card, padding: '1.25rem 1.5rem', marginBottom: 14, background: C.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Legg til rapport</div>
        <button onClick={onClose} style={btn.ghost}>Lukk</button>
      </div>

      <div style={{ display: 'inline-flex', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, marginBottom: 14 }}>
        {[['file', 'Last opp fil'], ['url', 'URL']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '6px 14px', fontSize: 13, border: 'none', cursor: 'pointer', borderRadius: 6,
            background: tab === k ? C.surface : 'transparent',
            color: tab === k ? C.accent : C.textMute,
            fontWeight: tab === k ? 600 : 500, fontFamily: 'inherit',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'file' && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, color: C.textMute, marginBottom: 4, fontWeight: 500 }}>Fil (PDF / PPTX)</label>
          <input type="file" accept=".pdf,.pptx,.ppt" onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ fontSize: 13, fontFamily: 'inherit' }} />
        </div>
      )}
      {tab === 'url' && (
        <div style={{ marginBottom: 14, display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: C.textMute, marginBottom: 4, fontWeight: 500 }}>URL</label>
            <input type="url" value={meta.url || ''} placeholder="https://…"
              onChange={e => setMeta({ ...meta, url: e.target.value })} style={inp.text} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: C.textMute, marginBottom: 4, fontWeight: 500 }}>Method</label>
            <input type="text" value={meta.method || 'GET'}
              onChange={e => setMeta({ ...meta, method: e.target.value })} style={inp.text} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
        {ADMIN_FIELDS.map(f => (
          <div key={f.key} style={{ gridColumn: f.type === 'textarea' ? '1 / -1' : 'auto' }}>
            <label style={{ display: 'block', fontSize: 11, color: C.textMute, marginBottom: 3, fontWeight: 500 }}>{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea value={meta[f.key] || ''} rows={3}
                onChange={e => setMeta({ ...meta, [f.key]: e.target.value })} style={inp.textarea} />
            ) : (
              <input type={f.type} value={meta[f.key] ?? ''}
                onChange={e => setMeta({ ...meta, [f.key]: f.type === 'number' ? (e.target.value === '' ? null : parseInt(e.target.value)) : e.target.value })}
                style={inp.text} />
            )}
          </div>
        ))}
      </div>

      {err && <div style={{ fontSize: 12, color: C.danger, marginTop: 10 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={submit} disabled={busy} style={btn.primary}>{busy ? 'Sender…' : 'Legg til'}</button>
        <button onClick={onClose} disabled={busy} style={btn.ghost}>Avbryt</button>
      </div>
    </div>
  )
}

function ReindexPanel({ server, indexName }) {
  const [job, setJob] = useState(null)  // {status, events[]}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [docFilter, setDocFilter] = useState('all')   // 'all' | 'new' | 'skipped' | 'failed'
  const pollTimer = useRef(null)
  const eventCountRef = useRef(0)  // cumulative events received — used as poll cursor
  const storageKey = `digiung_lab:reindex_job:${indexName}`

  // Resume any in-flight or completed job persisted from a previous mount.
  // Server keeps reindex jobs in memory across panel mounts; we only need
  // to remember the job_id locally per index.
  useEffect(() => {
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null }
    setJob(null); setBusy(false); setErr(''); setDocFilter('all')
    eventCountRef.current = 0

    let cancelled = false
    let savedJobId = null
    try { savedJobId = localStorage.getItem(storageKey) } catch { savedJobId = null }
    if (!savedJobId) return () => { cancelled = true }

    ;(async () => {
      try {
        const base = server.replace(/\/$/, '')
        const res = await fetch(`${base}/admin/reindex/${savedJobId}?last=0`)
        if (cancelled) return
        if (res.status === 404) {
          try { localStorage.removeItem(storageKey) } catch {}
          return
        }
        if (!res.ok) throw new Error(res.statusText)
        const data = await res.json()
        if (cancelled) return
        const initialEvents = data.events || []
        eventCountRef.current = initialEvents.length
        // If server already emitted a terminal 'done' event, treat the job as finished
        // even if data.status hasn't been updated to 'done' yet.
        const hasDone = initialEvents.some(e => e.event === 'done')
        const hasError = initialEvents.some(e => e.event === 'error')
        const effectiveStatus = hasDone ? 'done' : hasError ? 'error' : data.status
        setJob({ status: effectiveStatus, events: initialEvents })
        if (effectiveStatus === 'running') {
          setBusy(true)
          pollTimer.current = setTimeout(() => poll(savedJobId), 700)
        } else {
          try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
        }
      } catch (e) {
        if (!cancelled) setErr(e.message)
      }
    })()

    return () => {
      cancelled = true
      if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexName, server])

  const start = async (mode = 'incremental') => {
    if (mode === 'full' && !window.confirm(
      `Dette sletter eksisterende indeks for «${indexName}» og bygger den om fra bunnen. Fortsette?`
    )) return

    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null }
    eventCountRef.current = 0
    setBusy(true); setErr(''); setJob({ status: 'running', events: [] })
    try {
      const base = server.replace(/\/$/, '')
      const url = `${base}/admin/reindex?index_name=${encodeURIComponent(indexName)}&mode=${mode}`
      const res = await fetch(url, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      try { localStorage.setItem(storageKey, data.job_id) } catch { /* ignore */ }
      poll(data.job_id)
    } catch (e) { setErr(e.message); setBusy(false); setJob(null) }
  }

  const poll = async (jobId) => {
    try {
      const base = server.replace(/\/$/, '')
      const res = await fetch(`${base}/admin/reindex/${jobId}?last=${eventCountRef.current}`)
      if (res.status === 404) {
        // Server forgot the job (e.g. process restart) — drop the stale pointer
        try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
        setBusy(false)
        return
      }
      if (!res.ok) throw new Error(res.statusText)
      const data = await res.json()
      const newEvents = data.events || []
      eventCountRef.current += newEvents.length
      // Detect terminal events locally — server may lag updating `status` after emitting `done`.
      const hasTerminal = newEvents.some(e => e.event === 'done' || e.event === 'error')
      const terminalEvent = newEvents.find(e => e.event === 'done')
        ? 'done'
        : newEvents.find(e => e.event === 'error') ? 'error' : null
      const effectiveStatus = hasTerminal ? terminalEvent : data.status
      setJob(j => ({ status: effectiveStatus, events: [...(j?.events || []), ...newEvents] }))
      if (effectiveStatus === 'running') {
        pollTimer.current = setTimeout(() => poll(jobId), 700)
      } else {
        // Job finished — drop the saved pointer so we don't resume a stale "running" view
        try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
        setBusy(false)
      }
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  // Safety net: keep `busy` in sync with job.status so the button can never
  // get stuck on "Kjører…" if a code path forgets to setBusy(false).
  useEffect(() => {
    if (job && job.status !== 'running' && busy) setBusy(false)
  }, [job, busy])

  const events = useMemo(() => job?.events || [], [job])
  const startEvt = events.find(e => e.event === 'start')
  const latestProgress = [...events].reverse().find(e => typeof e.index === 'number')
  const doneEvt = events.find(e => e.event === 'done')
  const total = startEvt?.total ?? latestProgress?.total ?? 0
  const current = latestProgress ? latestProgress.index + 1 : 0
  const remaining = Math.max(0, total - current)
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  const docEvents = events.filter(e =>
    e.event === 'doc_done' || e.event === 'doc_failed' ||
    e.event === 'doc_skipped' || e.event === 'skip'
  ).slice().reverse()

  // Per-document outcome list, used for the summary table once a run completes.
  const docResults = useMemo(() => {
    const out = []
    for (const ev of events) {
      let status = null
      if (ev.event === 'doc_done')        status = 'new'
      else if (ev.event === 'doc_failed') status = 'failed'
      else if (ev.event === 'doc_skipped' || ev.event === 'skip') status = 'skipped'
      if (!status) continue
      out.push({
        status,
        tittel:  ev.tittel  || '',
        kilde:   ev.url || ev.kilde || ev.filnavn || '',
        message: ev.message || '',
      })
    }
    return out
  }, [events])

  const docCounts = {
    all:     docResults.length,
    new:     docResults.filter(d => d.status === 'new').length,
    skipped: docResults.filter(d => d.status === 'skipped').length,
    failed:  docResults.filter(d => d.status === 'failed').length,
  }
  const filteredDocs = docFilter === 'all' ? docResults : docResults.filter(d => d.status === docFilter)

  // ETA: average duration of *real* work (doc_done / doc_failed), ignoring near-instant skips
  const realWork = events.filter(e => e.event === 'doc_done' || e.event === 'doc_failed')
  let etaMs = null
  if (realWork.length >= 1 && startEvt?.ts && remaining > 0) {
    const startMs = new Date(startEvt.ts).getTime()
    const lastMs  = new Date(realWork[realWork.length - 1].ts).getTime()
    const remainingReal = events.filter(e => e.event === 'doc_start' || e.event === 'doc_done' || e.event === 'doc_failed').length
      ? Math.max(0, remaining)  // upper bound — assumes remaining docs need real work
      : remaining
    const avgMs = (lastMs - startMs) / realWork.length
    etaMs = avgMs * remainingReal
  }

  const fmtDur = (ms) => {
    if (ms == null) return '—'
    const s = Math.max(1, Math.round(ms / 1000))
    if (s < 60) return `~${s} sek`
    const m = Math.floor(s / 60)
    const rs = s % 60
    if (m < 60) return rs > 0 ? `~${m} min ${rs} sek` : `~${m} min`
    const h = Math.floor(m / 60)
    return `~${h} t ${m % 60} min`
  }

  return (
    <div style={{ ...card, padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Reindekser «{indexName}»</div>
          <div style={{ fontSize: 12, color: C.textMute, marginTop: 2 }}>
            Manglende: kun nye oppføringer prosesseres. Full: sletter eksisterende indeks og bygger på nytt.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => start('incremental')} disabled={busy} style={btn.primary}>
            {busy ? 'Kjører…' : 'Regenerer manglende'}
          </button>
          <button onClick={() => start('full')} disabled={busy} style={btn.ghost}>
            Regenerer alt
          </button>
        </div>
      </div>

      {err && <div style={{ fontSize: 12, color: C.danger, marginTop: 10 }}>{err}</div>}

      {job && (
        <div style={{ marginTop: 14 }}>
          {job.status === 'running' && !startEvt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 12 }}>
              <LoadingDots />
              <span style={{ fontSize: 14, color: C.textMute }}>Initialiserer reindeksering — laster dokumentlisten…</span>
            </div>
          )}

          {job.status === 'running' && startEvt && (
            <div style={{ padding: '14px 16px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {current}<span style={{ color: C.textFaint, fontWeight: 500 }}> / {total}</span>
                </div>
                <div style={{ fontSize: 13, color: C.textMute }}>dokumenter fullført</div>
                <div style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>
                  {pct}%
                </div>
              </div>

              <div style={{ height: 12, background: C.border, borderRadius: 99, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${C.accent}, #60A5FA)`,
                  borderRadius: 99,
                  transition: 'width .4s ease-out',
                  minWidth: pct > 0 ? 8 : 0,
                }} />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, marginBottom: latestProgress?.tittel ? 8 : 0 }}>
                <span style={{ color: C.text }}>
                  <strong style={{ color: remaining > 0 ? C.accent : C.success }}>{remaining}</strong> gjenstår
                </span>
                {etaMs != null && remaining > 0 && (
                  <span style={{ color: C.textMute }}>{fmtDur(etaMs)} igjen</span>
                )}
              </div>

              {latestProgress?.tittel && (
                <div style={{ fontSize: 12, color: C.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Behandler: {latestProgress.tittel}
                </div>
              )}
            </div>
          )}

          {job.status === 'done' && doneEvt && (() => {
            // Compute counts from the events we actually received instead of trusting
            // doneEvt.processed/total — the server occasionally double-counts processed
            // items, which would otherwise show e.g. "37/35".
            const newCount     = docCounts.new
            const failedCount  = docCounts.failed
            const skippedCount = docCounts.skipped
            const processed    = newCount + failedCount + skippedCount
            const totalDocs    = startEvt?.total ?? doneEvt.total ?? processed
            return (
              <div style={{ padding: '12px 16px', background: C.successBg, border: `1px solid #A7F3D0`, borderRadius: 10, marginBottom: 12, fontSize: 13, color: C.success, fontWeight: 500 }}>
                ✓ Ferdig — {newCount} nye, {failedCount} feilet, {processed}/{totalDocs} totalt prosessert
              </div>
            )
          })()}
          {job.status === 'error' && (() => {
            const errEvt = events.find(e => e.event === 'error')
            return (
              <div style={{ padding: '12px 16px', background: C.dangerBg, border: `1px solid #FECACA`, borderRadius: 10, marginBottom: 12, fontSize: 13, color: C.danger, fontWeight: 500 }}>
                <div style={{ marginBottom: errEvt?.message ? 6 : 0 }}>Feil under reindeksering</div>
                {errEvt?.message && (
                  <pre style={{ margin: 0, fontFamily: 'inherit', fontWeight: 400, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {errEvt.message}
                  </pre>
                )}
              </div>
            )
          })()}

          {job.status === 'running' && docEvents.length > 0 && (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', maxHeight: '50vh', overflowY: 'auto' }}>
              {docEvents.map((ev, i) => (
                <div key={i} style={{ fontSize: 12, color: ev.event === 'doc_failed' ? C.danger : ev.event === 'doc_skipped' ? C.warn : ev.event === 'doc_done' ? C.success : C.textMute, padding: '2px 0' }}>
                  <span style={{ fontFamily: 'monospace', marginRight: 6, color: C.textFaint }}>
                    {ev.event === 'doc_done' && '✓'}
                    {ev.event === 'doc_failed' && '✗'}
                    {ev.event === 'doc_skipped' && '~'}
                    {ev.event === 'skip' && '·'}
                    {ev.event === 'start' && '▶'}
                    {ev.event === 'done' && '■'}
                    {ev.event === 'reload' && '↻'}
                    {ev.event === 'error' && '!'}
                  </span>
                  {ev.tittel || ev.message || ev.event}
                </div>
              ))}
            </div>
          )}

          {(job.status === 'done' || job.status === 'error') && docResults.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${C.border}`, background: C.bg, flexWrap: 'wrap' }}>
                {[
                  { key: 'all',     label: 'Alle' },
                  { key: 'new',     label: 'Nye' },
                  { key: 'skipped', label: 'Hoppet over' },
                  { key: 'failed',  label: 'Feilet' },
                ].map(t => {
                  const n = docCounts[t.key]
                  const active = docFilter === t.key
                  return (
                    <button key={t.key} onClick={() => setDocFilter(t.key)} style={{
                      padding: '4px 10px', fontSize: 12, borderRadius: 6,
                      border: `1px solid ${active ? C.accent : C.border}`,
                      background: active ? C.accentBg : C.surface,
                      color: active ? C.accent : C.textMute,
                      cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
                    }}>
                      {t.label} <span style={{ color: active ? C.accent : C.textFaint, marginLeft: 2 }}>({n})</span>
                    </button>
                  )
                })}
              </div>

              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {filteredDocs.length === 0 ? (
                  <div style={{ padding: '14px', textAlign: 'center', fontSize: 12, color: C.textFaint }}>Ingen oppføringer i denne kategorien.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ background: C.bg }}>
                        <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: C.textFaint, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, width: 110, position: 'sticky', top: 0, background: C.bg, zIndex: 1 }}>Status</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: C.textFaint, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.bg, zIndex: 1 }}>Tittel / Kilde</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: C.textFaint, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.bg, zIndex: 1 }}>Detalj</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocs.map((d, i) => {
                        const palette = d.status === 'new'
                          ? { bg: C.successBg, fg: C.success, icon: '✓', label: 'Ny' }
                          : d.status === 'failed'
                          ? { bg: C.dangerBg,  fg: C.danger,  icon: '✗', label: 'Feilet' }
                          : { bg: C.warnBg,    fg: C.warn,    icon: '~', label: 'Hoppet' }
                        return (
                          <tr key={i} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.border}` }}>
                            <td style={{ padding: '6px 10px', verticalAlign: 'top' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: palette.bg, color: palette.fg, fontWeight: 600, fontSize: 11 }}>
                                <span style={{ fontFamily: 'monospace' }}>{palette.icon}</span> {palette.label}
                              </span>
                            </td>
                            <td style={{ padding: '6px 10px', verticalAlign: 'top' }}>
                              <div style={{ color: C.text, fontWeight: 500, wordBreak: 'break-word' }}>
                                {d.tittel || <span style={{ color: C.textFaint, fontStyle: 'italic' }}>uten tittel</span>}
                              </div>
                              {d.kilde && d.kilde !== d.tittel && (
                                <div style={{ color: C.textFaint, fontSize: 11, wordBreak: 'break-all', marginTop: 2 }}>{d.kilde}</div>
                              )}
                            </td>
                            <td style={{ padding: '6px 10px', verticalAlign: 'top', color: d.status === 'failed' ? C.danger : C.textMute, wordBreak: 'break-word' }}>
                              {d.message || (d.status === 'new' ? 'Lagt til' : d.status === 'skipped' ? 'Allerede indeksert' : '—')}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AdminView({ server, indexName, onBackToSearch, onIndexCreated }) {
  const [entries, setEntries] = useState(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [creatingIndex, setCreatingIndex] = useState(false)
  const [newIndexName, setNewIndexName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createErr, setCreateErr] = useState('')

  const submitNewIndex = async (e) => {
    e?.preventDefault?.()
    const name = newIndexName.trim()
    if (!name) { setCreateErr('Navn må fylles ut'); return }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      setCreateErr('Ugyldig navn. Tillatte tegn: a-z, A-Z, 0-9, _ og -')
      return
    }
    setCreateBusy(true); setCreateErr('')
    try {
      const base = server.replace(/\/$/, '')
      const res  = await fetch(`${base}/admin/indexes?name=${encodeURIComponent(name)}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      onIndexCreated?.(name)
      setCreatingIndex(false); setNewIndexName('')
    } catch (e) {
      setCreateErr(e.message)
    } finally {
      setCreateBusy(false)
    }
  }

  const load = useCallback(async () => {
    if (!indexName) return
    setErr('')
    try {
      const base = server.replace(/\/$/, '')
      const res = await fetch(`${base}/admin/entries?index_name=${encodeURIComponent(indexName)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setEntries(data.entries || [])
    } catch (e) { setErr(e.message); setEntries([]) }
  }, [server, indexName])

  useEffect(() => { load() }, [load])

  const handleSaved   = (updated) => setEntries(es => es.map(e => entryKey(e) === entryKey(updated) ? updated : e))
  const handleDeleted = (key)     => setEntries(es => es.filter(e => entryKey(e) !== key))
  const handleAdded   = (entry)   => setEntries(es => [...(es || []), entry])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: C.text }}>Administrer dokumenter</div>
          <div style={{ fontSize: 13, color: C.textMute, marginTop: 2 }}>
            Indeks: <strong>{indexName || '—'}</strong> · {entries == null ? '…' : `${entries.length} oppføringer`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onBackToSearch} style={btn.ghost}>← Tilbake til søk</button>
          <button onClick={() => { setCreatingIndex(true); setCreateErr(''); setNewIndexName('') }} style={btn.ghost}>+ Ny indeks</button>
          <button onClick={() => setAdding(true)} disabled={adding || !indexName} style={btn.primary}>+ Legg til rapport</button>
        </div>
      </div>

      {creatingIndex && (
        <form onSubmit={submitNewIndex} style={{ ...card, padding: '1rem 1.25rem', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8 }}>Ny indeks</div>
          <div style={{ fontSize: 12, color: C.textMute, marginBottom: 10 }}>
            Indeksen opprettes som en tom liste i document_store.json. Legg til dokumenter etterpå med «+ Legg til rapport».
          </div>
          <input
            autoFocus
            value={newIndexName}
            onChange={(e) => setNewIndexName(e.target.value)}
            placeholder="f.eks. helsenorge_artikler"
            disabled={createBusy}
            style={{
              width: '100%', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
              border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.text,
              marginBottom: 8,
            }}
          />
          {createErr && <div style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{createErr}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={createBusy} style={btn.primary}>{createBusy ? 'Oppretter…' : 'Opprett'}</button>
            <button type="button" onClick={() => setCreatingIndex(false)} disabled={createBusy} style={btn.ghost}>Avbryt</button>
          </div>
        </form>
      )}

      {adding && (
        <AddEntryForm server={server} indexName={indexName}
          onAdded={handleAdded} onClose={() => setAdding(false)} />
      )}

      <div style={{ marginBottom: 16 }}>
        <ReindexPanel server={server} indexName={indexName} />
      </div>

      {err && <div style={{ ...card, padding: '0.75rem 1rem', marginBottom: 12, color: C.danger, fontSize: 13 }}>Feil ved lasting: {err}</div>}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', background: C.bg, borderBottom: `1px solid ${C.border}`,
          display: 'grid', gridTemplateColumns: '2fr 2fr 1.2fr 0.6fr auto', gap: 12, fontSize: 11, color: C.textFaint, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          <div>Tittel</div>
          <div>Kilde</div>
          <div>Segment</div>
          <div>År</div>
          <div style={{ textAlign: 'right' }}>Handling</div>
        </div>
        {entries == null ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: 13, color: C.textFaint }}>Laster…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: 13, color: C.textFaint }}>Ingen oppføringer ennå.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {entries.map((entry, i) => (
                <AdminEntryRow key={entryKey(entry) || i}
                  entry={entry} server={server} indexName={indexName}
                  onSaved={handleSaved} onDeleted={handleDeleted} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// shared button + input styles for the admin view
const btn = {
  primary: {
    padding: '8px 16px', borderRadius: 8, border: 'none',
    background: C.accent, color: '#fff', cursor: 'pointer',
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  },
  ghost: {
    padding: '8px 14px', borderRadius: 8,
    border: `1px solid ${C.border}`, background: C.surface, color: C.textMute,
    cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
  },
  danger: {
    padding: '8px 14px', borderRadius: 8,
    border: `1px solid ${C.border}`, background: C.surface, color: C.danger,
    cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
  },
}
const inp = {
  text: {
    width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: C.surface, color: C.text,
  },
  textarea: {
    width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: C.surface, color: C.text,
    resize: 'vertical', minHeight: 60,
  },
}

function EmptyState({ mode, indexName, onPick }) {
  const examples = examplesFor(indexName, mode)
  return (
    <div style={{ ...card, padding: '2rem 1.75rem', textAlign: 'center' }}>
      <div style={{ fontSize: 15, color: C.text, fontWeight: 600, marginBottom: 6 }}>
        {mode === 'aggregate' ? 'Klar til å analysere på tvers av dokumentene' : 'Klar til å svare på spørsmål'}
      </div>
      <div style={{ fontSize: 13, color: C.textMute, marginBottom: 18 }}>
        Skriv et spørsmål over — eller prøv et av disse:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560, margin: '0 auto' }}>
        {examples.map((q, i) => (
          <button key={i} onClick={() => onPick(q)} style={{
            padding: '10px 14px', fontSize: 13, textAlign: 'left',
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.text, cursor: 'pointer', fontFamily: 'inherit',
          }}>{q}</button>
        ))}
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [server, setServer]             = useState(webserverEndPoint)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [themeName, setThemeName]       = useState(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (saved && THEMES[saved]) return saved
    } catch {}
    return DEFAULT_THEME
  })

  // Apply synchronously during render so children see the fresh palette on
  // the same render that themeName changes. useEffect would run too late.
  applyTheme(themeName)

  useEffect(() => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, themeName) } catch {}
  }, [themeName])
  const [view, setView]                 = useState('search')   // 'search' | 'admin'
  const [mode, setMode]                 = useState('aggregate')
  const [question, setQuestion]         = useState('')
  const [loading, setLoading]           = useState(false)
  const [status, setStatus]             = useState('')
  const [statusErr, setStatusErr]       = useState(false)
  // Server index-load readiness (polled from /health). Querying is blocked
  // until every index has finished loading — no silent fallback to another one.
  const [health, setHealth]             = useState({ state: 'loading', message: 'Kobler til serveren…', loaded: [], expected: [], failed: {} })
  const healthRef                       = useRef(health)
  healthRef.current = health
  const cancelRef                       = useRef({ controller: null, jobId: null, cancelled: false })
  const [results, setResults]           = useState([])
  const [indexes, setIndexes]           = useState([])
  const [selectedIndex, setSelectedIndex] = useState('')
  const selectedIndexRef                = useRef('')
  const [options, setOptions]           = useState({})
  const [entries, setEntries]           = useState([])
  const [optionsErr, setOptionsErr]     = useState('')
  const [queryTypeDefs, setQueryTypeDefs] = useState({})
  const [filtersOpen, setFiltersOpen]   = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [topK, setTopK]                 = useState(5)
  const [cutoff, setCutoff]             = useState(0.30)
  const [queryType, setQueryType]       = useState('free')

  // Per-index query type filtering: only show analysis types that apply to
  // the currently selected index. Common types (no `indexes` list) are
  // available everywhere.
  const availableQueryTypes = useMemo(
    () => queryTypesForIndex(selectedIndex),
    [selectedIndex]
  )

  // If the active query type isn't available for the new index, fall back to
  // the first available type (typically 'free').
  useEffect(() => {
    if (!availableQueryTypes.some(qt => qt.key === queryType)) {
      setQueryType(availableQueryTypes[0]?.key || 'free')
    }
  }, [availableQueryTypes, queryType])
  const [nPersonas, setNPersonas]       = useState(3)
  const [chunksPerDoc, setChunksPerDoc] = useState(8)
  const [includeAggregate, setIncludeAggregate] = useState(false)

  const [draft, setDraft]                   = useState({})
  const draftRef                            = useRef({})
  const [activeFilters, setActiveFilters]   = useState({})
  const activeFiltersRef                    = useRef({})

  useEffect(() => {
    draftRef.current = {}
    activeFiltersRef.current = {}
    setDraft({})
    setActiveFilters({})
    setOptions({})

    const controller = new AbortController()
    const base = server.replace(/\/$/, '')
    const qs   = selectedIndex ? `?index_name=${encodeURIComponent(selectedIndex)}` : ''
    const url  = `${base}/document-store/filter-options${qs}`
    fetch(url, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(({ _entries = [], ...fields }) => { setEntries(_entries); setOptions(fields); setOptionsErr('') })
      .catch(err => { if (err.name !== 'AbortError') setOptionsErr('Kunne ikke laste filtervalg fra serveren') })
    return () => controller.abort()
  }, [server, selectedIndex])

  const refreshQueryTypes = useCallback(() => {
    const base = server.replace(/\/$/, '')
    return fetch(`${base}/query-types`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setQueryTypeDefs)
      .catch(() => {})
  }, [server])

  useEffect(() => {
    const base = server.replace(/\/$/, '')
    fetch(`${base}/indexes`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(list => {
        setIndexes(list)
        if (list.length && !selectedIndexRef.current) {
          selectedIndexRef.current = list[0]
          setSelectedIndex(list[0])
        }
      })
      .catch(() => {})
    refreshQueryTypes()
  }, [server, refreshQueryTypes])

  // Poll /health until the server reports all indexes loaded. Keeps polling
  // (slower) while not ready so a recovery (e.g. after reindex) is picked up.
  useEffect(() => {
    const base = server.replace(/\/$/, '')
    let cancelled = false
    let timer = null
    const poll = async () => {
      try {
        const r = await fetch(`${base}/health`, { cache: 'no-store' })
        const d = await r.json()
        if (cancelled) return
        const ready = !!d.ready
        setHealth({
          state:    ready ? 'ready' : (d.status === 'error' ? 'error' : 'loading'),
          message:  d.message || '',
          loaded:   d.loaded || d.indexes_loaded || [],
          expected: d.expected || [],
          failed:   d.failed || {},
        })
        if (!ready) timer = setTimeout(poll, 2500)
      } catch {
        if (cancelled) return
        setHealth({ state: 'error', message: 'Får ikke kontakt med serveren.', loaded: [], expected: [], failed: {} })
        timer = setTimeout(poll, 4000)
      }
    }
    setHealth(h => ({ ...h, state: 'loading', message: 'Kobler til serveren…' }))
    poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [server])

  const handleDraftChange = (field, vals) => {
    const next = { ...draftRef.current, [field]: vals }
    draftRef.current = next
    setDraft(next)
  }

  const applyFilters = useCallback(() => {
    const applied = {}
    Object.entries(draftRef.current).forEach(([key, vals]) => {
      if (vals?.length) applied[key] = vals
    })
    activeFiltersRef.current = applied
    setActiveFilters(applied)
    setFiltersOpen(false)
  }, [])

  const clearFilters = () => {
    draftRef.current = {}
    activeFiltersRef.current = {}
    setDraft({})
    setActiveFilters({})
  }

  const removeValue = (field, val) => {
    const next = (activeFiltersRef.current[field] || []).filter(v => v !== val)
    const updated = { ...activeFiltersRef.current }
    if (next.length) updated[field] = next
    else delete updated[field]
    activeFiltersRef.current = updated
    draftRef.current = { ...draftRef.current, [field]: next }
    setActiveFilters({ ...updated })
    setDraft({ ...draftRef.current })
  }

  const activeCount = Object.values(activeFilters).flat().length

  const cascadingOptions = useMemo(() => {
    if (!entries.length) return options
    const result = {}
    Object.keys(options).forEach(field => {
      const filtered = entries.filter(entry =>
        Object.entries(draft).every(([key, vals]) => {
          if (key === field || !vals?.length) return true
          const raw = String(entry[key] ?? '').trim()
          return vals.some(v => raw.split(';').map(s => s.trim()).includes(v))
        })
      )
      const vals = new Set()
      filtered.forEach(entry => {
        String(entry[field] ?? '').trim().split(';').forEach(p => { p = p.trim(); if (p) vals.add(p) })
      })
      result[field] = [...vals].sort()
    })
    return result
  }, [entries, options, draft])

  const cancelRun = async () => {
    cancelRef.current.cancelled = true
    const { controller, jobId } = cancelRef.current
    if (controller) {
      try { controller.abort() } catch {}
    }
    if (jobId) {
      try {
        await fetch(`${server.replace(/\/$/, '')}/aggregate/cancel/${jobId}`, { method: 'POST' })
      } catch {}
    }
    setStatus('Avbryter…')
  }

  const runQuery = async (overrideQuestion) => {
    const q = (overrideQuestion ?? question).trim()
    // Aggregate mode may run without a question — the analysis is then driven by
    // the query type's system prompt. Query mode still requires a question.
    if (!q && mode !== 'aggregate') return
    // Block until the server has loaded all indexes — avoids querying the wrong
    // (or no) index while loading is still in progress.
    if (healthRef.current.state !== 'ready') {
      setStatusErr(true)
      setStatus(healthRef.current.message || 'Serveren er ikke klar ennå — vent til indeksene er lastet.')
      return
    }
    if (overrideQuestion) setQuestion(overrideQuestion)
    setLoading(true)
    setStatus(mode === 'aggregate' ? 'Analyserer dokumenter — dette tar 1–3 min…' : 'Søker…')
    setStatusErr(false)

    const controller = new AbortController()
    cancelRef.current = { controller, jobId: null, cancelled: false }

    const filters = activeFiltersRef.current
    const filtersToSend = Object.keys(filters).length
      ? Object.fromEntries(Object.entries(filters).map(([k, vals]) => [k, vals.join(';')]))
      : undefined

    try {
      let res
      if (mode === 'query') {
        const body = { question: q, top_k: topK, cutoff, index_name: selectedIndexRef.current }
        if (filtersToSend) body.filters = filtersToSend

        const placeholderId = Date.now()
        setResults(prev => [{
          _type: 'query', _id: placeholderId, _loading: true,
          question: q, filters: activeFiltersRef.current, index_name: selectedIndexRef.current,
        }, ...prev])

        res = await fetch(`${server.replace(/\/$/, '')}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || res.statusText)
        setStatus(`${(data.sources || []).length} kilder funnet`)
        setResults(prev => prev.map(r => r._id === placeholderId
          ? { _type: 'query', ...data, filters: activeFiltersRef.current, index_name: selectedIndexRef.current }
          : r))

      } else {
        const body = {
          question: q, query_type: queryType, n_personas: nPersonas,
          chunks_per_doc: chunksPerDoc, index_name: selectedIndexRef.current,
          // Cross-document syntese is opt-in for strategisk_risiko; other types always aggregate.
          include_aggregate: queryType === 'strategisk_risiko' ? includeAggregate : true,
        }
        if (filtersToSend) body.filters = filtersToSend

        const placeholderId = Date.now()
        setResults(prev => [{
          _type: 'aggregate', _id: placeholderId, _loading: true,
          question: q, query_type: queryType, index_name: selectedIndexRef.current,
          documents_visited: 0, documents_with_findings: 0,
        }, ...prev])

        res = await fetch(`${server.replace(/\/$/, '')}/aggregate/stream`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || res.statusText)
        }
        const { job_id } = await res.json()
        cancelRef.current.jobId = job_id

        const patch = (p) => setResults(prev => prev.map(r => r._id === placeholderId ? { ...r, ...p } : r))
        patch({ _job_id: job_id })

        let last = 0
        let done = false
        while (!done) {
          await new Promise(r => setTimeout(r, 600))
          const pollRes = await fetch(`${server.replace(/\/$/, '')}/aggregate/stream/${job_id}?last=${last}`)
          if (!pollRes.ok) break
          const poll = await pollRes.json()

          for (const evt of poll.events) {
            if (evt.event === 'node') {
              patch({ _currentNode: evt.node, _nodeMessage: evt.message })
              setStatus(evt.message)
            } else if (evt.event === 'doc_start') {
              patch({ _docIndex: evt.index, _docTotal: evt.total, _docTittel: evt.tittel })
              setStatus(`[${evt.index + 1}/${evt.total}] ${evt.tittel}`)
            } else if (evt.event === 'doc_done') {
              patch({ documents_visited: evt.index + 1 })
            } else if (evt.event === 'result') {
              const items = evt[STRUCTURED_OUTPUT_KEYS[queryType]] || []
              setStatus(`${evt.documents_visited} dokumenter · ${evt.documents_with_findings} med funn · ${items.length} resultater`)
              patch({ ...evt, _loading: false, _type: 'aggregate' })
              done = true
            } else if (evt.event === 'cancelled') {
              setStatusErr(true)
              setStatus(`Avbrutt: ${evt.message || 'av bruker'}`)
              patch({ _loading: false, _cancelled: true })
              done = true
            } else if (evt.event === 'error') {
              setStatusErr(true)
              setStatus(`Feil: ${evt.message}`)
              patch({ _loading: false })
              done = true
            }
          }
          last = poll.total
          if (poll.status === 'done' || poll.status === 'error' || poll.status === 'cancelled') done = true
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || cancelRef.current.cancelled) {
        setStatusErr(true)
        setStatus('Avbrutt av bruker')
        setResults(prev => prev.map(r => r._loading ? { ...r, _loading: false, _cancelled: true } : r))
      } else {
        setStatusErr(true)
        setStatus(`Nettverksfeil: ${e.message}`)
        setResults(prev => prev.map(r => r._loading ? { ...r, _loading: false, _error: true } : r))
      }
    } finally {
      cancelRef.current = { controller: null, jobId: null, cancelled: false }
      setLoading(false)
    }
  }

  const placeholder = mode === 'query'
    ? 'Still et spørsmål om et tema i dokumentene…'
    : (QUERY_TYPES.find(q => q.key === queryType)?.description || 'Skriv et spørsmål…')
      + ' (valgfritt — la stå tomt for å bruke systemprompten)'

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: C.text,
    }}>
      {/* Top bar */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(248,250,252,0.85)', backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `linear-gradient(135deg, ${C.accent}, #60A5FA)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 14,
            }}>L</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.text, lineHeight: 1.2 }}>Lab Document Query</div>
              <div style={{ fontSize: 12, color: C.textFaint, lineHeight: 1.2 }}>Søk og analyser dokumenter med AI</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {indexes.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: C.textFaint }}>Index:</span>
                <select
                  value={selectedIndex}
                  onChange={e => { selectedIndexRef.current = e.target.value; setSelectedIndex(e.target.value) }}
                  style={{
                    padding: '6px 10px', fontSize: 13, fontFamily: 'inherit',
                    border: `1px solid ${C.border}`, borderRadius: 8,
                    background: C.surface, color: C.text, cursor: 'pointer',
                  }}>
                  {indexes.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
            )}
            <button
              onClick={() => setView(v => v === 'admin' ? 'search' : 'admin')}
              title="Administrer dokumenter"
              style={{
                padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: view === 'admin' ? C.accentBg : C.surface, cursor: 'pointer', fontSize: 13,
                color: view === 'admin' ? C.accent : C.textMute, fontFamily: 'inherit', fontWeight: 500,
              }}
            >Admin</button>
            <button
              onClick={() => setSettingsOpen(p => !p)}
              title="Server-innstillinger"
              style={{
                padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: settingsOpen ? C.accentBg : C.surface, cursor: 'pointer', fontSize: 15,
                color: settingsOpen ? C.accent : C.textMute, lineHeight: 1,
              }}
            >⚙</button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1.75rem 1.5rem 3rem' }}>

        {view === 'admin' && (
          <AdminView
            server={server}
            indexName={selectedIndex}
            onBackToSearch={() => setView('search')}
            onIndexCreated={(name) => {
              setIndexes(prev => prev.includes(name) ? prev : [...prev, name].sort())
              selectedIndexRef.current = name
              setSelectedIndex(name)
            }}
          />
        )}

        {view === 'search' && <>
        {/* Index-load readiness banner — querying is blocked until ready */}
        {health.state !== 'ready' && (
          <div style={{
            ...card, padding: '0.9rem 1.25rem', marginBottom: 16,
            border: `1px solid ${health.state === 'error' ? C.danger : C.borderHi}`,
            background: health.state === 'error' ? C.dangerBg : C.accentBg,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4,
              color: health.state === 'error' ? C.danger : C.text }}>
              {health.state === 'error' ? 'Serveren er ikke klar' : 'Laster inn indekser…'}
            </div>
            <div style={{ fontSize: 13, color: C.textMute }}>
              {health.message || (health.state === 'error'
                ? 'Kunne ikke laste alle indeksene.'
                : 'Venter på at alle indekser er lastet inn før søk kan kjøres.')}
            </div>
            {health.expected.length > 0 && (
              <div style={{ fontSize: 12, color: C.textFaint, marginTop: 6 }}>
                {health.loaded.length}/{health.expected.length} indekser lastet
                {Object.keys(health.failed || {}).length > 0 &&
                  ` · feilet: ${Object.keys(health.failed).join(', ')}`}
              </div>
            )}
          </div>
        )}
        {/* Server settings */}
        {settingsOpen && (
          <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: 16 }}>
            <div style={{ ...metaLabel, marginBottom: 8 }}>Server-URL</div>
            <input value={server} onChange={e => setServer(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box', fontFamily: 'monospace', background: C.surface, color: C.text }} />
            <div style={{ ...metaLabel, marginTop: 16, marginBottom: 8 }}>Fargetema</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {THEME_LIST.map(t => {
                const selected = t.key === themeName
                return (
                  <button key={t.key} onClick={() => setThemeName(t.key)}
                    title={t.label}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${selected ? C.accent : C.border}`,
                      background: selected ? C.accentBg : C.surface,
                      color: selected ? C.accent : C.text,
                      fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                    }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: 999,
                      background: t.swatch, border: `1.5px solid ${C.border}`,
                      display: 'inline-block',
                    }} />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Mode selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'inline-flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3 }}>
            {[
              ['query', 'Dokumentsøk', 'Direkte spørsmål med kildehenvisninger'],
              ['aggregate', 'Aggregert analyse', 'Syntetiser funn på tvers av dokumenter'],
            ].map(([m, label, hint]) => (
              <button key={m} onClick={() => { setMode(m); setStatus('') }} title={hint} style={{
                padding: '8px 16px', fontSize: 13, border: 'none', cursor: 'pointer', borderRadius: 8,
                background: mode === m ? C.accentBg : 'transparent',
                color: mode === m ? C.accent : C.textMute,
                fontWeight: mode === m ? 600 : 500,
                fontFamily: 'inherit',
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Analysis type — only for aggregate */}
        {mode === 'aggregate' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {availableQueryTypes.map(qt => {
                const active = queryType === qt.key
                return (
                  <button key={qt.key} onClick={() => setQueryType(qt.key)} style={{
                    padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    border: active ? `1.5px solid ${C.accent}` : `1px solid ${C.border}`,
                    background: active ? C.accentBg : C.surface,
                    fontFamily: 'inherit',
                    position: 'relative',
                  }}>
                    <div style={{
                      position: 'absolute', top: 12, right: 12,
                      width: 8, height: 8, borderRadius: 99,
                      background: QUERY_TYPE_TINT[qt.key],
                      border: `1px solid ${C.border}`,
                    }} />
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? C.accent : C.text, marginBottom: 3 }}>{qt.label}</div>
                    <div style={{ fontSize: 12, color: C.textMute, lineHeight: 1.4 }}>{qt.description}</div>
                  </button>
                )
              })}
            </div>
            {queryType === 'strategisk_risiko' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: C.textMute, cursor: 'pointer' }}>
                <input type="checkbox" checked={includeAggregate} onChange={e => setIncludeAggregate(e.target.checked)} />
                Aggreger på tvers av dokumenter (longlist) — ellers vises kun analyse per dokument
              </label>
            )}
          </div>
        )}

        {/* Search input — large, prominent */}
        <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && runQuery()}
              placeholder={placeholder}
              style={{
                flex: 1, padding: '12px 14px', border: `1px solid ${C.border}`, borderRadius: 10,
                fontSize: 16, outline: 'none', fontFamily: 'inherit', background: C.bg,
              }}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            <button onClick={() => runQuery()} disabled={loading || health.state !== 'ready' || (mode !== 'aggregate' && !question.trim())} style={{
              padding: '12px 24px', borderRadius: 10, border: 'none',
              background: loading || health.state !== 'ready' || (mode !== 'aggregate' && !question.trim()) ? '#93C5FD' : C.accent,
              color: '#fff', cursor: loading || health.state !== 'ready' || (mode !== 'aggregate' && !question.trim()) ? 'not-allowed' : 'pointer',
              fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'inherit',
              minWidth: 110,
            }}>
              {loading ? <LoadingDots /> : mode === 'aggregate' ? 'Analyser' : 'Spør'}
            </button>
            {loading && (
              <button onClick={cancelRun} style={{
                padding: '12px 18px', borderRadius: 10,
                border: `1px solid ${C.danger}`, background: '#fff', color: C.danger,
                cursor: 'pointer', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}>
                Avbryt
              </button>
            )}
          </div>

          {/* Options row: filters + advanced */}
          <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
            <SectionToggle open={filtersOpen} onToggle={() => setFiltersOpen(p => !p)} label="Filtre" badge={activeCount} />
            <SectionToggle open={advancedOpen} onToggle={() => setAdvancedOpen(p => !p)} label="Avansert" />
            {status && (
              <div style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: statusErr ? C.danger : C.textMute,
                background: statusErr ? C.dangerBg : C.bg,
                padding: '4px 10px', borderRadius: 6,
                border: `1px solid ${statusErr ? '#FECACA' : C.border}`,
                maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {status}
              </div>
            )}
          </div>

          {/* Filters drawer */}
          {optionsErr && <div style={{ fontSize: 12, color: C.danger, marginTop: 6 }}>{optionsErr}</div>}
          {filtersOpen && (
            <FilterPanel
              draft={draft}
              onChangeDraft={handleDraftChange}
              onApply={applyFilters}
              onClear={clearFilters}
              options={cascadingOptions}
              entries={entries}
            />
          )}
          <ActiveFilterTags filters={activeFilters} onRemoveValue={removeValue} />

          {/* Advanced drawer */}
          {advancedOpen && (
            <div style={{ marginTop: 14, padding: '14px 16px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
                {mode === 'query' && <>
                  <ParamSlider label="top_k" min={1} max={40} step={1} value={topK} onChange={setTopK} format={v => v} />
                  <ParamSlider label="cutoff" min={0} max={1} step={0.05} value={cutoff} onChange={setCutoff} format={v => v.toFixed(2)} />
                </>}
                {mode === 'aggregate' && <>
                  {queryType === 'personas' && (
                    <ParamSlider label="Antall personas" min={1} max={8} step={1} value={nPersonas} onChange={setNPersonas} format={v => v} />
                  )}
                  <ParamSlider label="Chunks per doc" min={1} max={16} step={1} value={chunksPerDoc} onChange={setChunksPerDoc} format={v => v} />
                </>}
              </div>
              {mode === 'aggregate' && (
                <PromptsEditor
                  queryType={queryType}
                  defs={queryTypeDefs}
                  server={server}
                  onSaved={refreshQueryTypes}
                />
              )}
            </div>
          )}
        </div>

        {/* Results */}
        {results.length === 0 && !loading && (
          <EmptyState mode={mode} indexName={selectedIndex} onPick={q => runQuery(q)} />
        )}
        {results.map((data, i) =>
          data._type === 'aggregate'
            ? <AggregateResultCard key={i} data={data} />
            : <QueryResultCard key={i} data={data} />
        )}
        </>}

      </div>
    </div>
  )
}
