import { useState, useEffect, useRef, useCallback } from 'react'

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

const QUERY_TYPES = [
  { key: 'problems', label: 'Problemer',         description: 'Hvilke problemer sliter unge med?' },
  { key: 'moments',  label: 'Kritiske øyeblikk', description: 'Kritiske øyeblikk og vendepunkter i unges liv' },
  { key: 'personas', label: 'Personas',           description: 'Syntetiser personas basert på funn' },
  { key: 'free',     label: 'Fri analyse',        description: 'Åpent spørsmål på tvers av alle dokumenter' },
]

const TAG_COLORS = {
  file:  { bg: '#E6F1FB', color: '#0C447C' },
  page:  { bg: '#EAF3DE', color: '#27500A' },
  score: { bg: '#FAEEDA', color: '#633806' },
  seg:   { bg: '#EEEDFE', color: '#3C3489' },
  pub:   { bg: '#E1F5EE', color: '#085041' },
}

const card = {
  background: '#fff',
  borderRadius: 14,
  boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)',
  border: '1px solid #E5E7EB',
}

const metaLabel = {
  fontSize: 11, fontWeight: 600, color: '#9CA3AF',
  textTransform: 'uppercase', letterSpacing: '.06em',
}

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

function Chevron({ open }) {
  return (
    <span style={{
      fontSize: 10, color: '#9CA3AF', display: 'inline-block',
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
      <span style={{ fontSize: 13, color: '#6B7280' }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          background: '#185FA5', color: '#fff', borderRadius: 99,
          padding: '1px 7px', fontSize: 11, fontWeight: 600,
        }}>{badge}</span>
      )}
    </div>
  )
}

function MultiSelect({ label, options = [], selected, onChange }) {
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
      <label style={{ fontSize: 11, color: '#6B7280', display: 'block', marginBottom: 4, fontWeight: 500 }}>{label}</label>
      <button onClick={() => setOpen(p => !p)} style={{
        width: '100%', padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 8,
        background: '#fff', textAlign: 'left', cursor: 'pointer', fontSize: 13,
        color: count ? '#111' : '#9CA3AF', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{count ? `${count} valgt` : '— alle —'}</span>
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.10)', maxHeight: 220, overflowY: 'auto', marginTop: 4,
        }}>
          {count > 0 && (
            <div onClick={() => { onChange([]); setOpen(false) }}
              style={{ padding: '8px 12px', fontSize: 12, color: '#6B7280', cursor: 'pointer', borderBottom: '1px solid #F3F4F6' }}>
              Fjern alle valg
            </div>
          )}
          {options.map(opt => (
            <label key={opt} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              cursor: 'pointer', fontSize: 13,
              background: selected.includes(opt) ? '#EFF6FF' : 'transparent',
            }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)}
                style={{ accentColor: '#185FA5' }} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterPanel({ draft, onChangeDraft, onApply, onClear, options }) {
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

  return (
    <div ref={panelRef} style={{ border: '1px solid #E5E7EB', borderRadius: 12, padding: '1rem', marginTop: 10, marginBottom: 12, background: '#FAFAFA' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px', marginBottom: 14 }}>
        {FILTER_FIELDS.map(f => (
          <MultiSelect key={f.key} label={f.label}
            options={options[f.key] || []}
            selected={draft[f.key] || []}
            onChange={vals => onChangeDraft(f.key, vals)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #F3F4F6', paddingTop: 12 }}>
        <button onClick={onApply} style={{
          fontSize: 13, padding: '7px 16px', borderRadius: 8,
          border: 'none', background: '#185FA5', color: '#fff', cursor: 'pointer', fontWeight: 500,
        }}>Apply filters</button>
        <button onClick={onClear} style={{
          fontSize: 13, padding: '7px 14px', borderRadius: 8,
          border: '1px solid #E5E7EB', background: 'none', color: '#6B7280', cursor: 'pointer',
        }}>Clear all</button>
      </div>
    </div>
  )
}

function ActiveFilterTags({ filters, onRemoveValue }) {
  const entries = Object.entries(filters).filter(([, v]) => v && v.length > 0)
  if (!entries.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 4 }}>
      {entries.flatMap(([key, values]) =>
        values.map(val => (
          <span key={`${key}:${val}`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px 3px 10px', borderRadius: 99,
            fontSize: 12, fontWeight: 500, background: '#EFF6FF', color: '#1D4ED8',
            border: '1px solid #BFDBFE',
          }}>
            <span style={{ color: '#3B82F6', marginRight: 2 }}>{FILTER_FIELDS.find(f => f.key === key)?.label ?? key}:</span>
            <strong>{val}</strong>
            <button onClick={() => onRemoveValue(key, val)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3B82F6', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>×</button>
          </span>
        ))
      )}
    </div>
  )
}

function ParamSlider({ label, min, max, step, value, onChange, format }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#6B7280' }}>
      <label style={{ minWidth: 100 }}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{ width: 100, accentColor: '#185FA5' }} />
      <span style={{ fontWeight: 600, minWidth: 32, color: '#111827', fontSize: 13 }}>{format(value)}</span>
    </div>
  )
}

function SourceItem({ src }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
        <Tag type="file">{src.filename || 'unknown'}</Tag>
        {src.page_number != null && <Tag type="page">p. {src.page_number}</Tag>}
        <Tag type="score">score {src.score.toFixed(2)}</Tag>
        {src.segment && <Tag type="seg">{src.segment}</Tag>}
        {src.publisert_av && <Tag type="pub">{src.publisert_av}</Tag>}
      </div>
      {src.tittel && <div style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 4 }}>{src.tittel}</div>}
      {src.excerpt && <>
        <span onClick={() => setOpen(p => !p)} style={{ fontSize: 12, color: '#6B7280', cursor: 'pointer', textDecoration: 'underline' }}>
          {open ? 'Skjul utdrag' : 'Vis utdrag'}
        </span>
        {open && <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, marginTop: 6, padding: '8px 12px', background: '#F9FAFB', borderRadius: 8, whiteSpace: 'pre-wrap', border: '1px solid #F3F4F6' }}>{src.excerpt}</div>}
      </>}
    </div>
  )
}

function QueryResultCard({ data }) {
  const appliedFilters = data.filters || {}
  const sources = data.sources || []
  return (
    <div style={{ ...card, padding: '1.25rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={metaLabel}>Document query</span>
        {data.index_name && <Tag type="seg">{data.index_name}</Tag>}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: '#111827', marginBottom: 8 }}>{data.question}</div>
      {Object.keys(appliedFilters).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {Object.entries(appliedFilters).map(([k, v]) => (
            <Tag key={k} type="seg">{FILTER_FIELDS.find(f => f.key === k)?.label ?? k}: {Array.isArray(v) ? v.join(', ') : v}</Tag>
          ))}
        </div>
      )}
      <hr style={{ border: 'none', borderTop: '1px solid #F3F4F6', margin: '10px 0 14px' }} />
      <div style={{ fontSize: 15, lineHeight: 1.75, whiteSpace: 'pre-wrap', marginBottom: '1rem', color: '#1F2937' }}>{data.answer}</div>
      {sources.length > 0 && <>
        <div style={{ ...metaLabel, marginBottom: 8 }}>Sources ({sources.length})</div>
        {sources.map((src, i) => <SourceItem key={i} src={src} />)}
      </>}
    </div>
  )
}

function AggregateItem({ item, queryType }) {
  const isPersona = queryType === 'personas'
  return (
    <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 14, marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: '#111827' }}>{item.label}</div>
      <div style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.65, marginBottom: 8 }}>{item.description}</div>
      {isPersona && item.challenges?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ ...metaLabel, marginBottom: 6 }}>Utfordringer</div>
          {item.challenges.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: '#4B5563', paddingLeft: 12, borderLeft: '2px solid #BFDBFE', marginBottom: 4 }}>{c}</div>
          ))}
        </div>
      )}
      {isPersona && item.needs?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ ...metaLabel, marginBottom: 6 }}>Behov</div>
          {item.needs.map((n, i) => (
            <div key={i} style={{ fontSize: 13, color: '#4B5563', paddingLeft: 12, borderLeft: '2px solid #BBF7D0', marginBottom: 4 }}>{n}</div>
          ))}
        </div>
      )}
      {item.sources?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
          {item.sources.map((s, i) => <Tag key={i} type="pub">{s}</Tag>)}
        </div>
      )}
    </div>
  )
}

function PromptsViewer({ queryType, defs }) {
  const [open, setOpen] = useState(false)
  const cfg = defs[queryType]
  if (!cfg) return null
  const fields = [
    { key: 'extract_system',   label: 'Extract — system' },
    { key: 'extract_prompt',   label: 'Extract — user' },
    { key: 'aggregate_system', label: 'Aggregate — system' },
    { key: 'aggregate_prompt', label: 'Aggregate — user' },
  ]
  return (
    <div style={{ marginTop: 14 }}>
      <SectionToggle open={open} onToggle={() => setOpen(p => !p)} label="Show prompts" />
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map(({ key, label }) => (
            <div key={key}>
              <div style={{ ...metaLabel, marginBottom: 4 }}>{label}</div>
              <pre style={{ margin: 0, padding: '8px 12px', background: '#F9FAFB', borderRadius: 8, fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid #E5E7EB' }}>{cfg[key]}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProgressBar({ index, total, tittel, nodeMessage }) {
  const pct = total > 0 ? Math.round((index / total) * 100) : 0
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 8 }}>{nodeMessage || 'Kjører…'}</div>
      <div style={{ height: 6, background: '#F3F4F6', borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #185FA5, #3B82F6)', borderRadius: 99, transition: 'width .3s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9CA3AF' }}>
        <span style={{ maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tittel || ''}</span>
        <span style={{ fontWeight: 500 }}>{pct}% · {index}/{total}</span>
      </div>
    </div>
  )
}

function AggregateResultCard({ data }) {
  const qt = QUERY_TYPES.find(q => q.key === data.query_type) || QUERY_TYPES[0]
  const outputKeys = { problems: 'problems', moments: 'moments', personas: 'personas', free: 'findings' }
  const items = data[outputKeys[data.query_type]] || []
  const isLoading = data._loading
  return (
    <div style={{ ...card, padding: '1.25rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={metaLabel}>Aggregate analysis</span>
        {data.index_name && <Tag type="seg">{data.index_name}</Tag>}
        <Tag type="seg">{qt.label}</Tag>
        {isLoading && <span style={{ fontSize: 12, color: '#185FA5', fontWeight: 500 }}>kjører…</span>}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: '#111827', marginBottom: 10 }}>{data.question}</div>
      {isLoading && (
        <ProgressBar index={data._docIndex ?? 0} total={data._docTotal ?? 0}
          tittel={data._docTittel} nodeMessage={data._nodeMessage} />
      )}
      {!isLoading && (
        <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 14, display: 'flex', gap: 16 }}>
          <span>{data.documents_visited} dokumenter besøkt</span>
          <span>{data.documents_with_findings} med funn</span>
          <span>{items.length} {qt.label.toLowerCase()}</span>
        </div>
      )}
      {!isLoading && <hr style={{ border: 'none', borderTop: '1px solid #F3F4F6', margin: '0 0 4px' }} />}
      {!isLoading && (items.length === 0
        ? <div style={{ fontSize: 14, color: '#9CA3AF', padding: '1rem 0' }}>Ingen funn ble aggregert.</div>
        : items.map((item, i) => <AggregateItem key={i} item={item} queryType={data.query_type} />)
      )}
      {!isLoading && data._job_id && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <a href={`${webserverEndPoint.replace(/\/$/, '')}/aggregate/report/${data._job_id}`}
            download
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, color: '#185FA5', textDecoration: 'none',
              padding: '6px 14px', border: '1px solid #ddd', borderRadius: 8,
              background: '#fff',
            }}>
            ⬇ Last ned rapport (.docx)
          </a>
        </div>
      )}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [server, setServer]             = useState(webserverEndPoint)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mode, setMode]                 = useState('query')
  const [question, setQuestion]         = useState('')
  const [loading, setLoading]           = useState(false)
  const [status, setStatus]             = useState('')
  const [statusErr, setStatusErr]       = useState(false)
  const [results, setResults]           = useState([])
  const [indexes, setIndexes]           = useState([])
  const [selectedIndex, setSelectedIndex] = useState('')
  const selectedIndexRef                = useRef('')
  const [options, setOptions]           = useState({})
  const [optionsErr, setOptionsErr]     = useState('')
  const [queryTypeDefs, setQueryTypeDefs] = useState({})
  const [filtersOpen, setFiltersOpen]   = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [topK, setTopK]                 = useState(5)
  const [cutoff, setCutoff]             = useState(0.30)
  const [queryType, setQueryType]       = useState('problems')
  const [nPersonas, setNPersonas]       = useState(3)
  const [chunksPerDoc, setChunksPerDoc] = useState(4)

  const [draft, setDraft]                   = useState({})
  const draftRef                            = useRef({})
  const [activeFilters, setActiveFilters]   = useState({})
  const activeFiltersRef                    = useRef({})

  useEffect(() => {
    const base = server.replace(/\/$/, '')
    const idx  = selectedIndexRef.current
    const qs   = idx ? `?index_name=${encodeURIComponent(idx)}` : ''
    fetch(`${base}/document-store/filter-options${qs}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setOptions(data); setOptionsErr('') })
      .catch(() => setOptionsErr('Could not load filter options from server'))
  }, [server, selectedIndex])

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
    fetch(`${base}/query-types`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setQueryTypeDefs)
      .catch(() => {})
  }, [server])

  const handleDraftChange = (field, vals) => {
    const next = { ...draftRef.current, [field]: vals }
    draftRef.current = next
    setDraft(next)
  }

  const applyFilters = useCallback(() => {
    const applied = {}
    FILTER_FIELDS.forEach(({ key }) => {
      const vals = draftRef.current[key] || []
      if (vals.length) applied[key] = vals
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

  const runQuery = async () => {
    const q = question.trim()
    if (!q) return
    setLoading(true)
    setStatus(mode === 'aggregate' ? 'Analyserer dokumenter — dette tar 1-3 min…' : 'Querying…')
    setStatusErr(false)

    const filters = activeFiltersRef.current
    const filtersToSend = Object.keys(filters).length
      ? Object.fromEntries(Object.entries(filters).map(([k, vals]) => [k, vals.join(';')]))
      : undefined

    try {
      let res
      if (mode === 'query') {
        const body = { question: q, top_k: topK, cutoff, index_name: selectedIndexRef.current }
        if (filtersToSend) body.filters = filtersToSend
        res = await fetch(`${server.replace(/\/$/, '')}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || res.statusText)
        setStatus(`${(data.sources || []).length} source chunk(s) retrieved`)
        setResults(prev => [{ _type: 'query', ...data, filters: activeFiltersRef.current, index_name: selectedIndexRef.current }, ...prev])

      } else {
        const body = { question: q, query_type: queryType, n_personas: nPersonas, chunks_per_doc: chunksPerDoc, index_name: selectedIndexRef.current }
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
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || res.statusText)
        }
        const { job_id } = await res.json()

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
              const outputKeys = { problems: 'problems', moments: 'moments', personas: 'personas', free: 'findings' }
              const items = evt[outputKeys[queryType]] || []
              setStatus(`${evt.documents_visited} dokumenter · ${evt.documents_with_findings} med funn · ${items.length} resultater`)
              patch({ ...evt, _loading: false, _type: 'aggregate' })
              done = true
            } else if (evt.event === 'error') {
              setStatusErr(true)
              setStatus(`Error: ${evt.message}`)
              patch({ _loading: false })
              done = true
            }
          }
          last = poll.total
          if (poll.status === 'done' || poll.status === 'error') done = true
        }
      }
    } catch (e) {
      setStatusErr(true)
      setStatus(`Nettverksfeil: ${e.message}`)
      setResults(prev => prev.map(r => r._loading ? { ...r, _loading: false, _error: true } : r))
    } finally {
      setLoading(false)
    }
  }

  const placeholder = mode === 'query'
    ? 'Spør om et spesifikt tema i dokumentene…'
    : QUERY_TYPES.find(q => q.key === queryType)?.description || 'Skriv inn spørsmål…'

  return (
    <div style={{ minHeight: '100vh', background: '#F4F5F7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '2rem 1.25rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#111827', margin: 0 }}>Lab Document Query</h1>
            <p style={{ fontSize: 13, color: '#9CA3AF', margin: '3px 0 0' }}>Søk og analyser dokumenter med AI</p>
          </div>
          <button
            onClick={() => setSettingsOpen(p => !p)}
            title="Server settings"
            style={{
              padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB',
              background: settingsOpen ? '#EFF6FF' : '#fff', cursor: 'pointer', fontSize: 17,
              color: settingsOpen ? '#185FA5' : '#6B7280', lineHeight: 1,
            }}
          >⚙</button>
        </div>

        {/* Server settings */}
        {settingsOpen && (
          <div style={{ ...card, padding: '1rem', marginBottom: 16 }}>
            <div style={{ ...metaLabel, marginBottom: 8 }}>Server URL</div>
            <input value={server} onChange={e => setServer(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', fontFamily: 'monospace' }} />
          </div>
        )}

        {/* Index selector */}
        {indexes.length > 0 && (
          <div style={{ ...card, padding: '0.875rem 1rem', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={metaLabel}>Index</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {indexes.map(name => (
                <button key={name} onClick={() => { selectedIndexRef.current = name; setSelectedIndex(name) }} style={{
                  padding: '5px 14px', borderRadius: 99, fontSize: 13, cursor: 'pointer',
                  border: selectedIndex === name ? '1.5px solid #185FA5' : '1px solid #E5E7EB',
                  background: selectedIndex === name ? '#EFF6FF' : '#F9FAFB',
                  color: selectedIndex === name ? '#185FA5' : '#4B5563',
                  fontWeight: selectedIndex === name ? 600 : 400,
                }}>{name}</button>
              ))}
            </div>
          </div>
        )}

        {/* Main query card */}
        <div style={{ ...card, padding: '1.25rem', marginBottom: 20 }}>

          {/* Mode tabs — pill segmented control */}
          <div style={{ display: 'inline-flex', background: '#F3F4F6', borderRadius: 10, padding: 3, marginBottom: 20 }}>
            {[['query', 'Document query'], ['aggregate', 'Aggregate analysis']].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setStatus('') }} style={{
                padding: '7px 18px', fontSize: 13, border: 'none', cursor: 'pointer', borderRadius: 8,
                background: mode === m ? '#fff' : 'transparent',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
                color: mode === m ? '#111827' : '#6B7280',
                fontWeight: mode === m ? 600 : 400,
                fontFamily: 'inherit',
              }}>{label}</button>
            ))}
          </div>

          {/* Aggregate query type cards */}
          {mode === 'aggregate' && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ ...metaLabel, marginBottom: 10 }}>Analysis type</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {QUERY_TYPES.map(qt => (
                  <button key={qt.key} onClick={() => setQueryType(qt.key)} style={{
                    padding: '10px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    border: queryType === qt.key ? '1.5px solid #185FA5' : '1px solid #E5E7EB',
                    background: queryType === qt.key ? '#EFF6FF' : '#F9FAFB',
                    fontFamily: 'inherit',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: queryType === qt.key ? '#185FA5' : '#374151', marginBottom: 3 }}>{qt.label}</div>
                    <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.4 }}>{qt.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Advanced */}
          <div style={{ marginBottom: 16 }}>
            <SectionToggle open={advancedOpen} onToggle={() => setAdvancedOpen(p => !p)} label="Advanced" />
            {advancedOpen && (
              <div style={{ marginTop: 12, paddingLeft: 18 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  {mode === 'query' && <>
                    <ParamSlider label="top_k" min={1} max={40} step={1} value={topK} onChange={setTopK} format={v => v} />
                    <ParamSlider label="cutoff" min={0} max={1} step={0.05} value={cutoff} onChange={setCutoff} format={v => v.toFixed(2)} />
                  </>}
                  {mode === 'aggregate' && <>
                    {queryType === 'personas' && (
                      <ParamSlider label="Antall personas" min={1} max={8} step={1} value={nPersonas} onChange={setNPersonas} format={v => v} />
                    )}
                    <ParamSlider label="Chunks per doc" min={1} max={8} step={1} value={chunksPerDoc} onChange={setChunksPerDoc} format={v => v} />
                  </>}
                </div>
                {mode === 'aggregate' && <PromptsViewer queryType={queryType} defs={queryTypeDefs} />}
              </div>
            )}
          </div>

          {/* Filters */}
          <div style={{ marginBottom: 16 }}>
            <SectionToggle open={filtersOpen} onToggle={() => setFiltersOpen(p => !p)} label="Filters" badge={activeCount} />
            {optionsErr && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 6 }}>{optionsErr}</div>}
            {filtersOpen && (
              <FilterPanel
                draft={draft}
                onChangeDraft={handleDraftChange}
                onApply={applyFilters}
                onClear={clearFilters}
                options={options}
              />
            )}
            <ActiveFilterTags filters={activeFilters} onRemoveValue={removeValue} />
          </div>

          {/* Search input */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && runQuery()}
              placeholder={placeholder}
              style={{
                flex: 1, padding: '11px 16px', border: '1px solid #E5E7EB', borderRadius: 10,
                fontSize: 15, outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button onClick={runQuery} disabled={loading} style={{
              padding: '11px 24px', borderRadius: 10, border: 'none',
              background: loading ? '#93C5FD' : '#185FA5',
              color: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'inherit',
            }}>
              {loading ? '…' : mode === 'aggregate' ? 'Analyser' : 'Spør'}
            </button>
          </div>

          {/* Status */}
          {status && (
            <div style={{ marginTop: 10, fontSize: 13, color: statusErr ? '#EF4444' : '#6B7280' }}>
              {status}
            </div>
          )}

        </div>

        {/* Results */}
        {results.map((data, i) =>
          data._type === 'aggregate'
            ? <AggregateResultCard key={i} data={data} />
            : <QueryResultCard key={i} data={data} />
        )}

      </div>
    </div>
  )
}
