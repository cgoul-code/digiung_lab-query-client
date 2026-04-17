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

function ModeTabs({ mode, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #eee' }}>
      {['query', 'aggregate'].map(m => (
        <button key={m} onClick={() => onChange(m)} style={{
          padding: '8px 18px', fontSize: 14, border: 'none', background: 'none', cursor: 'pointer',
          borderBottom: mode === m ? '2px solid #185FA5' : '2px solid transparent',
          color: mode === m ? '#185FA5' : '#888', fontWeight: mode === m ? 500 : 400, marginBottom: -1,
        }}>
          {m === 'query' ? 'Document query' : 'Aggregate analysis'}
        </button>
      ))}
    </div>
  )
}

function MultiSelect({ label, options = [], selected, onChange }) {
  const [open, setOpen] = useState(false)
  const count = selected.length
  const toggle = val => onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val])
  return (
    <div style={{ position: 'relative' }}>
      <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{label}</label>
      <button onClick={() => setOpen(p => !p)} style={{
        width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8,
        background: '#fff', textAlign: 'left', cursor: 'pointer', fontSize: 13,
        color: count ? '#111' : '#999', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{count ? `${count} valgt` : '— alle —'}</span>
        <span style={{ fontSize: 10, color: '#aaa' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid #ddd', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 220, overflowY: 'auto', marginTop: 2,
        }}>
          {count > 0 && (
            <div onClick={() => { onChange([]); setOpen(false) }}
              style={{ padding: '8px 12px', fontSize: 12, color: '#888', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}>
              Fjern alle valg
            </div>
          )}
          {options.map(opt => (
            <label key={opt} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              cursor: 'pointer', fontSize: 13,
              background: selected.includes(opt) ? '#f0f6ff' : 'transparent',
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
    <div ref={panelRef} style={{ border: '1px solid #eee', borderRadius: 12, padding: '1rem', marginBottom: 12, background: '#fafafa' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px', marginBottom: 14 }}>
        {FILTER_FIELDS.map(f => (
          <MultiSelect key={f.key} label={f.label}
            options={options[f.key] || []}
            selected={draft[f.key] || []}
            onChange={vals => onChangeDraft(f.key, vals)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onApply} style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Apply</button>
        <button onClick={onClear} style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: '1px solid #eee', background: 'none', color: '#888', cursor: 'pointer' }}>Clear all</button>
      </div>
    </div>
  )
}

function ActiveFilterTags({ filters, onRemoveValue }) {
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
            <button onClick={() => onRemoveValue(key, val)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#185FA5', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>×</button>
          </span>
        ))
      )}
    </div>
  )
}

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

function SourceItem({ src }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
        <Tag type="file">{src.filename || 'unknown'}</Tag>
        {src.page_number != null && <Tag type="page">p. {src.page_number}</Tag>}
        <Tag type="score">score {src.score.toFixed(2)}</Tag>
        {src.segment && <Tag type="seg">{src.segment}</Tag>}
        {src.publisert_av && <Tag type="pub">{src.publisert_av}</Tag>}
      </div>
      {src.tittel && <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', marginBottom: 4 }}>{src.tittel}</div>}
      {src.excerpt && <>
        <span onClick={() => setOpen(p => !p)} style={{ fontSize: 12, color: '#888', cursor: 'pointer', textDecoration: 'underline' }}>
          {open ? 'hide excerpt' : 'show excerpt'}
        </span>
        {open && <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, marginTop: 6, padding: '8px 10px', background: '#f8f8f8', borderRadius: 6, whiteSpace: 'pre-wrap' }}>{src.excerpt}</div>}
      </>}
    </div>
  )
}

function QueryResultCard({ data }) {
  const appliedFilters = data.filters || {}
  const sources = data.sources || []
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: '#aaa' }}>Document query</div>
        {data.index_name && <Tag type="seg">{data.index_name}</Tag>}
      </div>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>{data.question}</div>
      {Object.keys(appliedFilters).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {Object.entries(appliedFilters).map(([k, v]) => (
            <Tag key={k} type="seg">{k}: {Array.isArray(v) ? v.join(', ') : v}</Tag>
          ))}
        </div>
      )}
      <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '8px 0 12px' }} />
      <div style={{ fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>{data.answer}</div>
      {sources.length > 0 && <>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Sources</div>
        {sources.map((src, i) => <SourceItem key={i} src={src} />)}
      </>}
    </div>
  )
}

function AggregateItem({ item, queryType }) {
  const isPersona = queryType === 'personas'
  return (
    <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12, marginTop: 12 }}>
      <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4, color: '#111' }}>{item.label}</div>
      <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 6 }}>{item.description}</div>
      {isPersona && item.challenges?.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Utfordringer</div>
          {item.challenges.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: '#555', paddingLeft: 10, borderLeft: '2px solid #E6F1FB', marginBottom: 3 }}>{c}</div>
          ))}
        </div>
      )}
      {isPersona && item.needs?.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Behov</div>
          {item.needs.map((n, i) => (
            <div key={i} style={{ fontSize: 13, color: '#555', paddingLeft: 10, borderLeft: '2px solid #EAF3DE', marginBottom: 3 }}>{n}</div>
          ))}
        </div>
      )}
      {item.sources?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
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
    <div style={{ marginTop: 10, marginBottom: 14 }}>
      <div onClick={() => setOpen(p => !p)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', width: 'fit-content' }}>
        <span style={{ fontSize: 10, color: '#aaa', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}>▶</span>
        <span style={{ fontSize: 13, color: '#666' }}>Show prompts</span>
      </div>
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map(({ key, label }) => (
            <div key={key}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{label}</div>
              <pre style={{ margin: 0, padding: '8px 12px', background: '#f6f6f6', borderRadius: 6, fontSize: 12, color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid #eee' }}>{cfg[key]}</pre>
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
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{nodeMessage || 'Kjører…'}</div>
      <div style={{ height: 4, background: '#f0f0f0', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#185FA5', borderRadius: 99, transition: 'width .3s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#aaa' }}>
        <span style={{ maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tittel || ''}</span>
        <span>{index}/{total}</span>
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
    <div style={{ border: '1px solid #eee', borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: '#aaa' }}>Aggregate analysis</div>
        {data.index_name && <Tag type="seg">{data.index_name}</Tag>}
        <Tag type="seg">{qt.label}</Tag>
        {isLoading && <span style={{ fontSize: 12, color: '#185FA5' }}>kjører…</span>}
      </div>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 10 }}>{data.question}</div>
      {isLoading && (
        <ProgressBar index={data._docIndex ?? 0} total={data._docTotal ?? 0}
          tittel={data._docTittel} nodeMessage={data._nodeMessage} />
      )}
      {!isLoading && (
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
          {data.documents_visited} dokumenter besøkt · {data.documents_with_findings} med funn · {items.length} {qt.label.toLowerCase()}
        </div>
      )}
      {!isLoading && <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '0 0 4px' }} />}
      {!isLoading && (items.length === 0
        ? <div style={{ fontSize: 14, color: '#888', padding: '1rem 0' }}>Ingen funn ble aggregert.</div>
        : items.map((item, i) => <AggregateItem key={i} item={item} queryType={data.query_type} />)
      )}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [server, setServer]           = useState(webserverEndPoint)
  const [mode, setMode]               = useState('query')
  const [question, setQuestion]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [status, setStatus]           = useState('')
  const [statusErr, setStatusErr]     = useState(false)
  const [results, setResults]         = useState([])
  const [indexes, setIndexes]         = useState([])
  const [selectedIndex, setSelectedIndex] = useState('')
  const selectedIndexRef              = useRef('')
  const [options, setOptions]         = useState({})
  const [optionsErr, setOptionsErr]   = useState('')
  const [queryTypeDefs, setQueryTypeDefs] = useState({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [topK, setTopK]               = useState(5)
  const [cutoff, setCutoff]           = useState(0.30)
  const [queryType, setQueryType]     = useState('problems')
  const [nPersonas, setNPersonas]     = useState(3)
  const [chunksPerDoc, setChunksPerDoc] = useState(4)

  // ── Filter state — use refs so async runQuery always sees latest values ──
  // draft: what's shown in the open panel
  // activeFilters: what was last Applied
  // Both have a ref mirror updated synchronously
  const [draft, setDraft]                 = useState({})
  const draftRef                          = useRef({})
  const [activeFilters, setActiveFilters] = useState({})
  const activeFiltersRef                  = useRef({})

  // When server or selected index changes, reload filter options
  useEffect(() => {
    const base = server.replace(/\/$/, '')
    const idx  = selectedIndexRef.current
    const qs   = idx ? `?index_name=${encodeURIComponent(idx)}` : ''
    fetch(`${base}/document-store/filter-options${qs}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setOptions(data); setOptionsErr('') })
      .catch(() => setOptionsErr('Could not load filter options from server'))
  }, [server, selectedIndex])

  // On server change, reload index list + query types
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

  // Update a single field in draft — keeps ref in sync
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
    console.log('[applyFilters] applying:', applied)
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

    // Read filters from ref — guaranteed latest regardless of render cycle
    const filters = activeFiltersRef.current
    const filtersToSend = Object.keys(filters).length
      ? Object.fromEntries(Object.entries(filters).map(([k, vals]) => [k, vals.join(';')]))
      : undefined

    console.log('[runQuery] filters:', filtersToSend)

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
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: '1.5rem' }}>Lab document query</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>Server</label>
        <input value={server} onChange={e => setServer(e.target.value)}
          style={{ flex: 1, padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
      </div>

      {indexes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>Index</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {indexes.map(name => (
              <button key={name} onClick={() => { selectedIndexRef.current = name; setSelectedIndex(name) }} style={{
                padding: '5px 14px', borderRadius: 99, fontSize: 13, cursor: 'pointer',
                border: selectedIndex === name ? '1.5px solid #185FA5' : '1px solid #ddd',
                background: selectedIndex === name ? '#E6F1FB' : '#fff',
                color: selectedIndex === name ? '#0C447C' : '#555',
                fontWeight: selectedIndex === name ? 500 : 400,
              }}>{name}</button>
            ))}
          </div>
        </div>
      )}

      <ModeTabs mode={mode} onChange={m => { setMode(m); setStatus('') }} />

      {mode === 'query' && (
        <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <ParamSlider label="top_k" min={1} max={40} step={1} value={topK} onChange={setTopK} format={v => v} />
          <ParamSlider label="cutoff" min={0} max={1} step={0.05} value={cutoff} onChange={setCutoff} format={v => v.toFixed(2)} />
        </div>
      )}

      {mode === 'aggregate' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Query type</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {QUERY_TYPES.map(qt => (
                  <button key={qt.key} onClick={() => setQueryType(qt.key)} style={{
                    padding: '6px 14px', borderRadius: 99, fontSize: 13, cursor: 'pointer',
                    border: queryType === qt.key ? '1.5px solid #185FA5' : '1px solid #ddd',
                    background: queryType === qt.key ? '#E6F1FB' : '#fff',
                    color: queryType === qt.key ? '#0C447C' : '#555',
                    fontWeight: queryType === qt.key ? 500 : 400,
                  }}>{qt.label}</button>
                ))}
              </div>
            </div>
            {queryType === 'personas' && (
              <ParamSlider label="Antall personas" min={1} max={8} step={1} value={nPersonas} onChange={setNPersonas} format={v => v} />
            )}
            <ParamSlider label="Chunks per doc" min={1} max={8} step={1} value={chunksPerDoc} onChange={setChunksPerDoc} format={v => v} />
          </div>
          <PromptsViewer queryType={queryType} defs={queryTypeDefs} />
        </>
      )}

      <div onClick={() => setFiltersOpen(p => !p)} onMouseDown={e => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer', userSelect: 'none', width: 'fit-content' }}>
        <span style={{ fontSize: 10, color: '#aaa', display: 'inline-block', transform: filtersOpen ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}>▶</span>
        <span style={{ fontSize: 13, color: '#666' }}>Filters{activeCount > 0 ? ` (${activeCount} valgt)` : ''}</span>
      </div>
      {optionsErr && <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 8 }}>{optionsErr}</div>}
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && runQuery()}
          placeholder={placeholder}
          style={{ flex: 1, padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 15 }} />
        <button onClick={runQuery} disabled={loading} style={{
          padding: '10px 20px', borderRadius: 8, border: '1px solid #ddd',
          background: '#fff', cursor: 'pointer', fontSize: 15, whiteSpace: 'nowrap',
        }}>
          {loading ? '…' : mode === 'aggregate' ? 'Analyser' : 'Spør'}
        </button>
      </div>

      {status && <div style={{ fontSize: 13, color: statusErr ? '#c0392b' : '#888', marginBottom: 14 }}>{status}</div>}

      {results.map((data, i) =>
        data._type === 'aggregate'
          ? <AggregateResultCard key={i} data={data} />
          : <QueryResultCard key={i} data={data} />
      )}
    </div>
  )
}
