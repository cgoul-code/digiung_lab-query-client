import { useState, useEffect } from 'react'

const SERVER_DEFAULT = 'http://localhost:80'

const FILTER_FIELDS = [
  { key: 'tittel',            label: 'Rapport' },
  { key: 'publisert_av',      label: 'Publisert av' },
  { key: 'segment',           label: 'Segment' },
  { key: 'type_kilde',        label: 'Type kilde' },
  { key: 'malgruppe',         label: 'Målgruppe' },
  { key: 'publisert_arstall', label: 'Årstall' },
]

const TAG_COLORS = {
  file:  { bg: '#E6F1FB', color: '#0C447C' },
  page:  { bg: '#EAF3DE', color: '#27500A' },
  score: { bg: '#FAEEDA', color: '#633806' },
  seg:   { bg: '#EEEDFE', color: '#3C3489' },
  pub:   { bg: '#E1F5EE', color: '#085041' },
  filter:{ bg: '#E6F1FB', color: '#0C447C' },
}

// ── Tag ───────────────────────────────────────────────────────────────────────
function Tag({ type, children }) {
  const c = TAG_COLORS[type] || TAG_COLORS.file
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 9px',
      borderRadius: 99, fontSize: 12, fontWeight: 500,
      background: c.bg, color: c.color,
    }}>{children}</span>
  )
}

// ── Multi-select dropdown ─────────────────────────────────────────────────────
function MultiSelect({ field, label, options = [], selected, onChange }) {
  const [open, setOpen] = useState(false)
  const count = selected.length

  const toggle = (val) => {
    onChange(
      selected.includes(val)
        ? selected.filter(v => v !== val)
        : [...selected, val]
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{label}</label>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          width: '100%', padding: '7px 10px', border: '1px solid #ddd',
          borderRadius: 8, background: '#fff', textAlign: 'left', cursor: 'pointer',
          fontSize: 13, color: count ? '#111' : '#999',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span>{count ? `${count} valgt` : '— alle —'}</span>
        <span style={{ fontSize: 10, color: '#aaa' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid #ddd', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 220, overflowY: 'auto',
          marginTop: 2,
        }}>
          {count > 0 && (
            <div
              onClick={() => { onChange([]); setOpen(false) }}
              style={{ padding: '8px 12px', fontSize: 12, color: '#888', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
            >
              Fjern alle valg
            </div>
          )}
          {options.map(opt => (
            <label key={opt} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', cursor: 'pointer', fontSize: 13,
              background: selected.includes(opt) ? '#f0f6ff' : 'transparent',
            }}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                style={{ accentColor: '#185FA5' }}
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Filter panel ──────────────────────────────────────────────────────────────
function FilterPanel({ draft, setDraft, onApply, onClear, options }) {
  const update = (field, vals) => setDraft(p => ({ ...p, [field]: vals }))

  return (
    <div style={{
      border: '1px solid #eee', borderRadius: 12, padding: '1rem',
      marginBottom: 12, background: '#fafafa',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px', marginBottom: 14,
      }}>
        {FILTER_FIELDS.map(f => (
          <MultiSelect
            key={f.key}
            field={f.key}
            label={f.label}
            options={options[f.key] || []}
            selected={draft[f.key] || []}
            onChange={vals => update(f.key, vals)}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onApply}
          style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>
          Apply
        </button>
        <button onClick={onClear}
          style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: '1px solid #eee', background: 'none', color: '#888', cursor: 'pointer' }}>
          Clear all
        </button>
      </div>
    </div>
  )
}

// ── Active filter tags ────────────────────────────────────────────────────────
function ActiveFilterTags({ filters, onRemoveField, onRemoveValue }) {
  const entries = Object.entries(filters).filter(([, v]) => v && v.length > 0)
  if (!entries.length) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
      {entries.flatMap(([key, values]) =>
        values.map(val => (
          <span key={`${key}:${val}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px 3px 10px', borderRadius: 99,
            fontSize: 12, fontWeight: 500, background: '#E6F1FB', color: '#0C447C',
          }}>
            <span style={{ color: '#185FA5', marginRight: 2 }}>{key}:</span>
            <strong>{val}</strong>
            <button
              onClick={() => onRemoveValue(key, val)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#185FA5', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>
              ×
            </button>
          </span>
        ))
      )}
    </div>
  )
}

// ── Source item ───────────────────────────────────────────────────────────────
function SourceItem({ src }) {
  const [excerptOpen, setExcerptOpen] = useState(false)
  return (
    <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
        <Tag type="file">{src.filename || 'unknown'}</Tag>
        {src.page_number != null && <Tag type="page">p. {src.page_number}</Tag>}
        <Tag type="score">score {src.score.toFixed(2)}</Tag>
        {src.segment && <Tag type="seg">{src.segment}</Tag>}
        {src.publisert_av && <Tag type="pub">{src.publisert_av}</Tag>}
      </div>
      {src.tittel && (
        <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', marginBottom: 4 }}>{src.tittel}</div>
      )}
      {src.excerpt && <>
        <span onClick={() => setExcerptOpen(p => !p)}
          style={{ fontSize: 12, color: '#888', cursor: 'pointer', textDecoration: 'underline' }}>
          {excerptOpen ? 'hide excerpt' : 'show excerpt'}
        </span>
        {excerptOpen && (
          <div style={{
            fontSize: 12, color: '#555', lineHeight: 1.6, marginTop: 6,
            padding: '8px 10px', background: '#f8f8f8', borderRadius: 6, whiteSpace: 'pre-wrap',
          }}>{src.excerpt}</div>
        )}
      </>}
    </div>
  )
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ data }) {
  const appliedFilters = data.filters || {}
  const sources = data.sources || []

  return (
    <div style={{ border: '1px solid #eee', borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' }}>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>{data.question}</div>

      {Object.keys(appliedFilters).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {Object.entries(appliedFilters).map(([k, v]) => (
            <Tag key={k} type="seg">{k}: {Array.isArray(v) ? v.join(', ') : v}</Tag>
          ))}
        </div>
      )}

      <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '8px 0 12px' }} />

      <div style={{ fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>
        {data.answer}
      </div>

      {sources.length > 0 && <>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Sources
        </div>
        {sources.map((src, i) => <SourceItem key={i} src={src} />)}
      </>}
    </div>
  )
}

// ── Param slider ──────────────────────────────────────────────────────────────
function ParamSlider({ label, min, max, step, value, onChange, format }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#666' }}>
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{ width: 90 }} />
      <span style={{ fontWeight: 500, minWidth: 28, color: '#111' }}>{format(value)}</span>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [server, setServer]       = useState(SERVER_DEFAULT)
  const [question, setQuestion]   = useState('')
  const [topK, setTopK]           = useState(5)
  const [cutoff, setCutoff]       = useState(0.30)
  const [loading, setLoading]     = useState(false)
  const [status, setStatus]       = useState('')
  const [statusErr, setStatusErr] = useState(false)
  const [results, setResults]     = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [options, setOptions]     = useState({})
  const [optionsErr, setOptionsErr] = useState('')

  useEffect(() => {
    const base = server.replace(/\/$/, '')
    fetch(`${base}/document-store/filter-options`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setOptions(data); setOptionsErr('') })
      .catch(() => setOptionsErr('Could not load filter options from server'))
  }, [server])

  // draft = what's shown in the open panel (arrays per field)
  const [draft, setDraft]               = useState({})
  // activeFilters = what was last applied (sent with queries)
  const [activeFilters, setActiveFilters] = useState({})

  const applyFilters = () => {
    // Only keep fields that have at least one value selected
    const applied = {}
    FILTER_FIELDS.forEach(({ key }) => {
      const vals = draft[key] || []
      if (vals.length) applied[key] = vals
    })
    setActiveFilters(applied)
    setFiltersOpen(false)
  }

  const clearFilters = () => {
    setDraft({})
    setActiveFilters({})
  }

  const removeValue = (field, val) => {
    const next = (activeFilters[field] || []).filter(v => v !== val)
    const updated = { ...activeFilters }
    if (next.length) updated[field] = next
    else delete updated[field]
    setActiveFilters(updated)
    setDraft(p => ({ ...p, [field]: next }))
  }

  const activeCount = Object.values(activeFilters).flat().length

  // Build the filters object sent to the server.
  // The server expects EQ filters — for multi-select we OR them by sending
  // the first value (single) or include all as separate filter calls.
  // Since our server currently supports EQ only, we send each selected
  // value as a comma-joined string so the server can be extended later.
  // For single selections the value is sent as a plain string.
  const buildServerFilters = () => {
    if (!Object.keys(activeFilters).length) return undefined
    const out = {}
    Object.entries(activeFilters).forEach(([k, vals]) => {
      out[k] = vals.length === 1 ? vals[0] : vals.join(',')
    })
    return out
  }

  const runQuery = async () => {
    const q = question.trim()
    if (!q) return
    setLoading(true)
    setStatus('Querying…')
    setStatusErr(false)

    const body = { question: q, top_k: topK, cutoff }
    const serverFilters = buildServerFilters()
    if (serverFilters) body.filters = serverFilters

    try {
      const res = await fetch(`${server.replace(/\/$/, '')}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setStatusErr(true)
        setStatus(`Error ${res.status}: ${err.error || res.statusText}`)
        return
      }
      const data = await res.json()
      setStatus(`${(data.sources || []).length} source chunk(s) retrieved`)
      setResults(prev => [{ ...data, filters: activeFilters }, ...prev])
    } catch (e) {
      setStatusErr(true)
      setStatus(`Could not reach server: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: '1.5rem' }}>Lab document query</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>Server</label>
        <input value={server} onChange={e => setServer(e.target.value)}
          style={{ flex: 1, padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runQuery()}
          placeholder="Ask a question about the lab documents…"
          style={{ flex: 1, padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 15 }} />
        <button onClick={runQuery} disabled={loading}
          style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 15 }}>
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <ParamSlider label="top_k" min={1} max={15} step={1} value={topK} onChange={setTopK} format={v => v} />
        <ParamSlider label="cutoff" min={0} max={1} step={0.05} value={cutoff} onChange={setCutoff} format={v => v.toFixed(2)} />
      </div>

      <div
        onClick={() => setFiltersOpen(p => !p)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer', userSelect: 'none', width: 'fit-content' }}
      >
        <span style={{ fontSize: 10, color: '#aaa', display: 'inline-block', transform: filtersOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}>▶</span>
        <span style={{ fontSize: 13, color: '#666' }}>
          Filters{activeCount > 0 ? ` (${activeCount} valgt)` : ''}
        </span>
      </div>

      {optionsErr && (
        <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 8 }}>{optionsErr}</div>
      )}
      {filtersOpen && (
        <FilterPanel draft={draft} setDraft={setDraft} onApply={applyFilters} onClear={clearFilters} options={options} />
      )}

      <ActiveFilterTags filters={activeFilters} onRemoveValue={removeValue} />

      {status && (
        <div style={{ fontSize: 13, color: statusErr ? '#c0392b' : '#888', marginBottom: 14 }}>{status}</div>
      )}

      {results.map((data, i) => <ResultCard key={i} data={data} />)}
    </div>
  )
}
