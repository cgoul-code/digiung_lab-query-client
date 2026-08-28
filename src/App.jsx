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
const BUILTIN_QUERY_TYPES = [
  { key: 'problems', label: 'Problemer',         description: 'Hvilke problemer sliter unge med?',          indexes: ['DigiUng_lab'] },
  { key: 'moments',  label: 'Kritiske øyeblikk', description: 'Vendepunkter i unges liv',                   indexes: ['DigiUng_lab'] },
  { key: 'personas', label: 'Personas',          description: 'Syntetiser personas basert på funn',         indexes: ['DigiUng_lab'] },
  { key: 'free',     label: 'Fri analyse',       description: 'Åpent spørsmål på tvers av alle dokumenter' },
  { key: 'strategisk_risiko', label: 'Strategisk risiko', description: 'Analysekjede per dokument: driver → sårbarhet → konsekvens → risiko', indexes: ['Strategisk_risiko'] },
  // Compliance-svar mot WHO-koden / Baby-Friendly: Konklusjon + begrunnelse +
  // henvisning. The sentinel `indexes` keeps it hidden on existing indexes by
  // default; it stays selectable in the create dialog (which lists all types)
  // and becomes active for any index whose saved selection includes it.
  { key: 'who_kode', label: 'WHO-kode compliance', description: 'Regelverkssjekk: Tillatt/Ikke tillatt + begrunnelse + henvisning til artikkel/resolusjon/BFHI-trinn', indexes: ['__who_kode__'] },
]

// The live list: built-ins plus whatever has been defined on the server. Kept as
// a mutated module array — the same trick the theme object C uses — so the many
// call sites that read it during render pick up additions without every one of
// them having to take a new prop.
const QUERY_TYPES = [...BUILTIN_QUERY_TYPES]

function registerQueryTypes(defs) {
  const custom = Object.entries(defs || {})
    .filter(([, cfg]) => cfg && cfg.custom)
    .map(([key, cfg]) => ({
      key,
      label: cfg.label || key,
      description: cfg.description || '',
      custom: true,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'no'))
  QUERY_TYPES.length = 0
  QUERY_TYPES.push(...BUILTIN_QUERY_TYPES, ...custom)
}

// An admin can pin an explicit set of analysetyper to an index at creation time
// (persisted server-side as { indexName: [keys] }). When such a list exists it
// wins; otherwise we fall back to each type's built-in `indexes` restriction.
function queryTypesForIndex(indexName, overrideMap) {
  const keys = overrideMap?.[indexName]
  if (Array.isArray(keys)) {
    const wanted = new Set(keys)
    const picked = QUERY_TYPES.filter(qt => wanted.has(qt.key))
    // Never leave an index with no analysetype to run.
    return picked.length ? picked : QUERY_TYPES.filter(qt => qt.key === 'free')
  }
  return QUERY_TYPES.filter(qt => !qt.indexes?.length || qt.indexes.includes(indexName))
}

// Analysetyper available everywhere (no `indexes` restriction). Used as the
// default selection when creating a new index.
function defaultQueryTypeKeys() {
  return QUERY_TYPES.filter(qt => !qt.indexes?.length).map(qt => qt.key)
}

// query_type values that produce the structured analysekjede output.
const STRUCTURED_OUTPUT_KEYS = {
  problems: 'problems', moments: 'moments', personas: 'personas',
  free: 'findings', strategisk_risiko: 'risikoomrader', who_kode: 'findings',
}
// Anything defined at runtime runs on the free-analysis machinery.
function outputKeyFor(queryType) {
  return STRUCTURED_OUTPUT_KEYS[queryType] || 'findings'
}

// Copy behind the info button next to the «DokumentLab» title. The app runs
// a single mode — aggregert analyse.
const AGGREGATE_INFO = {
  title: 'Aggregert analyse',
  paragraphs: [
    'Aggregert analyse går motsatt vei: i stedet for å plukke ut de beste treffene går den systematisk gjennom dokumentene ett for ett, henter et fast antall tekstbiter fra hvert (innstillingen «Chunks per doc» under «Analysedybde»), kjører en ekstraksjon per dokument etter valgt analysetype — Problemer, Kritiske øyeblikk, Personas, Strategisk risiko og så videre — og syntetiserer deretter funnene på tvers til én strukturert liste.',
    'Derfor viser resultatet «X dokumenter besøkt · Y med funn»: dekningsgraden er poenget. Analysen tar 1–3 minutter og kan kjøres helt uten spørsmål — da er det analysetypens egen instruks som styrer jobben. Bruk den når du vil vite hva som er gjennomgående i materialet: mønstre, temaer og risikoområder som først blir synlige når man ser alle dokumentene under ett.',
  ],
}

// Copy for the info buttons on the sliders in the «Analysedybde» drawer.
const PARAM_INFO = {
  chunks_per_doc: [
    'Chunks per doc styrer hvor mange tekstbiter som hentes fra hvert enkelt dokument før ekstraksjonen kjøres. Aggregert analyse besøker alle dokumentene uansett, så denne innstillingen bestemmer dybden per dokument — ikke bredden i materialet. Bitene velges fortsatt etter relevans, men innenfor ett dokument om gangen.',
    'Høy verdi gir et mer fullstendig bilde av hvert dokument, men analysen tar lengre tid og koster mer, siden hele materialet gjennomgås. Standard er 8. Lange rapporter tåler en høyere verdi; er dokumentene korte, er det lite å hente på å skru opp.',
  ],
}

// Step-by-step help for the admin view. Two phases matter here: registering the
// entry, and rebuilding the index — a document is not searchable until both.
const ADD_DOC_HELP = {
  intro: [
    'Å legge til et dokument skjer i to steg, slik skjermbildet er delt opp: først registreres dokumentet med metadata (steg 1), deretter bygges innholdet inn i dokumentbanken slik at det blir søkbart (steg 2).',
  ],
  steps: [
    { label: 'Velg dokumentbank', text: 'Åpne «Administrer dokumenter» fra skinnen til venstre, og velg riktig bank i nedtrekket «Dokumentbank» øverst i panelet. Alt du legger til havner i den banken som står der.' },
    { label: 'Åpne skjemaet', text: 'Klikk «+ Legg til dokument(er)» til høyre i steg 1.' },
    { label: 'Velg filer', text: 'Filvelgeren åpnes med en gang. Merk én eller flere PDF-, DOCX- eller PPTX-filer — hold Ctrl eller Shift for å merke flere, eller Ctrl+A for alt i mappen. Ett dokument behandles akkurat som mange.' },
    { label: 'Se over utvalget', text: 'Listen viser hva som legges til, med størrelse per fil. Ta bort haken på det du ikke vil ha med. Dokumenter som allerede ligger i listen filtreres bort automatisk og røres ikke.' },
    { label: 'Legg til', text: 'Klikk «Legg til». Er «Avled metadata med AI» krysset av, leses hvert dokument og Tittel, Segment, Publisert av, Årstall, Type kilde, Målgruppe og Oppsummering fylles ut. Uten den får dokumentet en tittel utledet av filnavnet.' },
    { label: 'Rett metadata', text: 'Klikk «Rediger» på en rad for å justere feltene. Dette er de samme feltene du filtrerer på i analysene, så det lønner seg at de er ryddige og konsekvente.' },
    { label: 'Oppdater dokumentbanken', text: 'Nederst, i steg 2 «Bygg dokumentbanken», klikker du «Oppdater dokumentbanken» — da prosesseres kun de nye oppføringene, og dokumentet blir søkbart. «Bygg dokumentbanken på nytt» sletter hele banken og bygger den opp fra bunnen; det tar mye lengre tid og trengs normalt ikke.' },
  ],
  footnote: 'Trinnene over registrerer bare dokumentet. Det er først etter «Oppdater dokumentbanken» at innholdet ligger i dokumentbanken og kan søkes i.',
}

// Copy for the info button next to the two build buttons in the reindex panel.
const REINDEX_INFO = {
  title: 'Bygge dokumentbanken',
  paragraphs: [
    '«Oppdater dokumentbanken» prosesserer bare oppføringene som ikke er bygget inn ennå. Dokumenter du nettopp har lagt til blir lest, delt opp i tekstbiter og gjort søkbare, mens alt som allerede ligger i banken røres ikke. Dette er den du bruker til daglig, og den tar kort tid fordi bare det nye behandles.',
    '«Bygg dokumentbanken på nytt» sletter hele banken og bygger den opp fra bunnen av samtlige oppføringer. Det tar mye lengre tid og trengs normalt ikke — bruk den bare hvis banken har blitt inkonsistent, eller etter endringer som må slå gjennom på alt innhold. Dokumentene i listen forsvinner ikke; det er kun det innebygde søkeinnholdet som bygges om.',
  ],
}

// Example questions per index name. `_default` is used for any index without
// a tailored set.
const EXAMPLE_QUESTIONS = {
  _default: [
    'Hvilke temaer er gjennomgående i materialet?',
    'Hva er de viktigste funnene på tvers av dokumentene?',
    'Hvilke mønstre beskrives i flere av dokumentene?',
  ],
  DigiUng_lab: [
    'Hvilke utfordringer er gjennomgående blant unge i materialet?',
    'Hva er de viktigste vendepunktene i unges liv?',
    'Hvilke behov beskrives på tvers av dokumentene?',
  ],
  Strategisk_risiko: [
    'Hvilke strategiske risikoer fremgår på tvers av dokumentene?',
    'Hvilke drivere og sårbarheter er gjennomgående?',
    'Hvilke kunnskapshull bør ledergruppen være oppmerksom på?',
  ],
}

function examplesFor(indexName) {
  return EXAMPLE_QUESTIONS[indexName] || EXAMPLE_QUESTIONS._default
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
const INDEX_STORAGE_KEY = 'digiung_lab.index'
const QUERYTYPE_STORAGE_KEY = 'digiung_lab.queryType'
const HISTORY_STORAGE_KEY = 'digiung_lab.history'
const SIDEBAR_STORAGE_KEY = 'digiung_lab.sidebarOpen'
const HISTORY_MAX = 40

// ── Conversation log persistence ──────────────────────────────────────────────
// No backend user system exists, so "follows the user" = persisted in this
// browser's localStorage. Full results are stored so a conversation reopens
// instantly; on quota overflow we trim the oldest entries and retry.
// localStorage key is namespaced per signed-in user so multiple users on a
// shared browser don't see each other's log; null = anonymous/auth-off.
function historyKey(user) { return user ? `${HISTORY_STORAGE_KEY}.${user}` : HISTORY_STORAGE_KEY }
function loadHistory(user) {
  try {
    const arr = JSON.parse(window.localStorage.getItem(historyKey(user)) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function persistHistory(list, user) {
  let arr = list.slice(0, HISTORY_MAX)
  while (arr.length) {
    try { window.localStorage.setItem(historyKey(user), JSON.stringify(arr)); return arr }
    catch { arr = arr.slice(0, Math.max(0, arr.length - 3)) }  // drop oldest, retry
  }
  try { window.localStorage.removeItem(historyKey(user)) } catch { /* ignore */ }
  return arr
}
function conversationTitle(entry) {
  if (entry.question && entry.question.trim()) return entry.question.trim()
  const qt = QUERY_TYPES.find(q => q.key === entry.queryType)
  if (qt) return qt.label
  return 'Analyse'
}
function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'nå nettopp'
  const m = Math.floor(s / 60); if (m < 60) return `${m} min siden`
  const h = Math.floor(m / 60); if (h < 24) return `${h} t siden`
  const d = Math.floor(h / 24); if (d < 7) return `${d} d siden`
  return new Date(ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
}

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

// Small "i" button that opens a popover with a longer explanation. Rendered as
// a sibling of the button it belongs to — never nested inside one. Content is
// any combination of intro paragraphs, numbered steps and a closing note.
function InfoButton({ title, paragraphs = [], steps, footnote, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onEsc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen(p => !p)}
        title={`Om ${title}`}
        aria-label={`Om ${title}`}
        aria-expanded={open}
        style={{
          width: 18, height: 18, padding: 0, borderRadius: 99, cursor: 'pointer',
          border: `1px solid ${open ? C.accent : C.border}`,
          background: open ? C.accentBg : 'transparent',
          color: open ? C.accent : C.textFaint,
          fontSize: 11, fontWeight: 700, fontFamily: 'inherit', lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >i</button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', zIndex: 200,
          ...(align === 'right' ? { right: 0 } : { left: 0 }),
          width: steps ? 'min(520px, 88vw)' : 'min(440px, 86vw)',
          maxHeight: '70vh', overflowY: 'auto',
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: '0 8px 24px rgba(15,23,42,0.10)', padding: '14px 16px',
          textAlign: 'left', cursor: 'default',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <span style={{ ...metaLabel }}>{title}</span>
            <button onClick={() => setOpen(false)} aria-label="Lukk" style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: C.textFaint, fontSize: 16, lineHeight: 1, padding: 0, fontFamily: 'inherit',
            }}>×</button>
          </div>
          {paragraphs.map((p, i) => (
            <p key={i} style={{
              margin: i === 0 ? 0 : '10px 0 0', fontSize: 13, lineHeight: 1.55,
              color: C.textMute, fontWeight: 400,
            }}>{p}</p>
          ))}
          {steps && (
            <ol style={{
              margin: paragraphs.length ? '12px 0 0' : 0, paddingLeft: 20,
              fontSize: 13, lineHeight: 1.55, color: C.textMute,
            }}>
              {steps.map((s, i) => (
                <li key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>
                  <strong style={{ color: C.text, fontWeight: 600 }}>{s.label}</strong>
                  {' — '}{s.text}
                </li>
              ))}
            </ol>
          )}
          {footnote && (
            <div style={{
              marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}`,
              fontSize: 12, lineHeight: 1.5, color: C.textFaint,
            }}>{footnote}</div>
          )}
        </div>
      )}
    </span>
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

function ParamSlider({ label, min, max, step, value, onChange, format, info }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: C.textMute }}>
      <span style={{ minWidth: 110, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <label>{label}</label>
        {info && <InfoButton title={label} paragraphs={info} />}
      </span>
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

// Matching a finding's source back to the document it came from: the synthesis
// and the per-document pass are separate LLM calls, so spacing and casing can't
// be relied on.
// Applied to whatever must not be touched while a job runs. Inert rather than
// hidden: you can still read what's there, it just can't be clicked.
function lockedWhile(locked) {
  return locked ? { pointerEvents: 'none', opacity: 0.4, userSelect: 'none' } : null
}

function normTitle(s) {
  return (s || '').split(/\s+/).filter(Boolean).join(' ').toLowerCase()
}

// Passages from one document backing one finding. When the finding names pages,
// those win; otherwise everything the document contributed is shown, since
// narrowing further would be guesswork.
function chunksForPages(entry, pages) {
  const chunks = entry?.chunks || []
  if (!pages?.length) return chunks
  const want = new Set(pages.map(p => String(p).trim()))
  const hit = chunks.filter(c => want.has(String(c.page).trim()))
  return hit.length ? hit : chunks
}

// One document's contribution to one finding: what was pulled out of it, and
// the passages it was pulled from.
function FindingSource({ source, entry }) {
  const [open, setOpen] = useState(false)
  const isObj = source && typeof source === 'object'
  const tittel = isObj ? (source.tittel || '') : String(source)
  const pages = isObj ? (source.pages || []) : []

  if (!entry) {
    // The synthesis named a source the per-document pass didn't produce — say
    // so rather than drop the reference.
    return (
      <div style={{ fontSize: 12.5, color: C.textFaint, marginTop: 10, fontStyle: 'italic' }}>
        {tittel}{pages.length ? ` (s. ${pages.join(', ')})` : ''} — ingen utdrag tilgjengelig
      </div>
    )
  }

  const s = entry.structured || {}
  // Risk documents come back as a structured chain, everything else as a plain
  // list of findings — both answer «what did this document contribute».
  const extracted = s.kildefunn?.length ? s.kildefunn : (entry.findings || [])
  const chunks = chunksForPages(entry, pages)
  const parts = [entry.tittel || entry.filename]
  if (entry.publisert_av) parts.push(entry.publisert_av)
  if (entry.publisert_arstall) parts.push(String(entry.publisert_arstall))
  const heading = parts.filter(Boolean).join(' · ')
  const url = (entry.kilde_url || '').trim()

  return (
    <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: `3px solid ${C.accentSoft}` }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 4 }}>
        {url
          ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: 'none' }}>{heading} ↗</a>
          : heading}
      </div>
      {s.relevans && (
        <div style={{ fontSize: 12.5, color: C.textMute, marginBottom: 6, fontStyle: 'italic' }}>{s.relevans}</div>
      )}
      <LabeledList label="Trukket ut fra dokumentet" values={extracted} />
      {chunks.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <SectionToggle open={open} onToggle={() => setOpen(p => !p)} label={`Sitater (${chunks.length})`} />
          {open && chunks.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: C.textMute, marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${C.border}`, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {c.page != null && <span style={{ fontWeight: 600 }}>[Side {c.page}] </span>}«{c.excerpt}»
              {c.deep_link && <> <a href={c.deep_link} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, whiteSpace: 'nowrap' }}>↗ til sitatet</a></>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The evidence half of a result: every finding followed by the documents behind
// it. Shared by all analysis types — only the shape of what each document
// contributed differs, and FindingSource absorbs that.
function FindingsBreakdown({ items, perDoc }) {
  const byTitle = new Map()
  for (const e of perDoc) {
    const k = normTitle(e.tittel || e.filename)
    if (k && !byTitle.has(k)) byTitle.set(k, e)
  }
  const cited = new Set()
  for (const item of items) {
    for (const s of item.sources || []) {
      const k = normTitle(typeof s === 'object' ? s.tittel : s)
      if (byTitle.has(k)) cited.add(k)
    }
  }
  const leftovers = perDoc.filter(e => !cited.has(normTitle(e.tittel || e.filename)))
  const heading = { fontSize: 13, fontWeight: 700, color: C.text, margin: '4px 0 2px', textTransform: 'uppercase', letterSpacing: '.04em' }

  return (
    <>
      {/* A hard break: everything below is evidence for what's above. */}
      <div style={{ marginTop: 22, paddingTop: 18, borderTop: `3px solid ${C.borderHi}` }}>
        <div style={heading}>Analyse per funn</div>
        <div style={{ fontSize: 12.5, color: C.textMute, marginTop: 2, marginBottom: 2 }}>
          Hva som er trukket ut av hvert dokument bak det enkelte funnet.
        </div>
        {items.length === 0
          ? <div style={{ fontSize: 14, color: C.textFaint, padding: '0.5rem 0' }}>Ingen funn å bryte ned.</div>
          : items.map((item, i) => <FindingDetail key={i} item={item} byTitle={byTitle} />)}
      </div>
      {leftovers.length > 0 && (
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
          <div style={heading}>Dokumenter uten sitater i funnene over</div>
          {leftovers.map((entry, i) => (
            entry.structured
              ? <RiskDocAnalysis key={i} entry={entry} />
              : <FindingSource key={i} source={{ tittel: entry.tittel || entry.filename }} entry={entry} />
          ))}
        </div>
      )}
    </>
  )
}

// One finding with the documents behind it. Grouping by finding rather than by
// document puts a claim next to its evidence, instead of leaving the reader to
// reassemble it from every document section in turn.
function FindingDetail({ item, byTitle }) {
  const sources = item.sources || []
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: C.text }}>{item.label}</div>
      {(item.beskrivelse || item.description) && (
        <div style={{ fontSize: 14, color: C.textMute, lineHeight: 1.65, marginBottom: 4 }}>
          {item.beskrivelse || item.description}
        </div>
      )}
      {sources.length === 0
        ? <div style={{ fontSize: 12.5, color: C.textFaint, fontStyle: 'italic', marginTop: 8 }}>Ingen kilder er registrert for dette funnet.</div>
        : sources.map((s, i) => (
            <FindingSource key={i} source={s}
              entry={byTitle.get(normTitle(typeof s === 'object' ? s.tittel : s))} />
          ))}
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
            <div key={i} style={{ fontSize: 12, color: C.textMute, marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${C.border}`, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {c.page != null && <span style={{ fontWeight: 600 }}>[Side {c.page}] </span>}{c.excerpt}
              {c.deep_link && <> <a href={c.deep_link} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, whiteSpace: 'nowrap' }}>↗ til sitatet</a></>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The two «system» prompts carry the analytical instruction and are the point
// of this editor. The two others are templates that inject the document text
// and the collected findings — placeholders like {context} and {all_findings}
// are what make the analysis see anything at all, so a typo there silently
// produces an empty analysis. They are shown for transparency, not editing.
const PROMPT_FIELDS = [
  {
    key: 'extract_system', label: 'Instruksjon per dokument', editable: true,
    hint: 'Styrer hva som hentes ut av hvert enkelt dokument.',
  },
  {
    key: 'extract_prompt', label: 'Mal per dokument', editable: false,
    hint: 'Fast mal som sender dokumentets tekst inn i analysen.',
  },
  {
    key: 'aggregate_system', label: 'Instruksjon for oppsummeringen', editable: true,
    hint: 'Styrer hvordan funnene fra alle dokumentene settes sammen.',
  },
  {
    key: 'aggregate_prompt', label: 'Mal for oppsummeringen', editable: false,
    hint: 'Fast mal som sender de innsamlede funnene inn i oppsummeringen.',
  },
]

// A textarea that grows with its content, so a long instruction isn't read
// through a four-line slot.
function AutoTextarea({ value, onChange, readOnly, ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return <textarea ref={ref} value={value} onChange={onChange} readOnly={readOnly} {...rest} />
}

// Body only — the toggle lives in the toolbar next to Filtre and Analysedybde,
// so editing the instructions is its own choice rather than something buried
// under a settings drawer.
// Read-only view of what the selected analysetype is instructed to do.
// Editing lives in «Administrer analysemaler» — one editing surface for one set
// of fields, so a saved change can't leave a second view showing stale text.
function PromptsViewer({ queryType, defs }) {
  const cfg = defs[queryType]
  if (!cfg) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {PROMPT_FIELDS.map(({ key, label, hint, editable }) => (
        <div key={key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ ...metaLabel }}>{label}</span>
            {!editable && <Tag tone="neutral">FAST</Tag>}
          </div>
          {hint && <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 5 }}>{hint}</div>}
          <AutoTextarea
            value={cfg[key] || ''}
            readOnly
            spellCheck={false}
            style={{
              // Height is managed, so a manual resize would only clip text.
              width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
              padding: '8px 12px', borderRadius: 8, fontSize: 12,
              border: `1px solid ${C.border}`, fontFamily: 'monospace',
              lineHeight: 1.5, outline: 'none',
              background: C.bg, color: C.textMute, cursor: 'default',
            }}
          />
        </div>
      ))}
      <div style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>
        Instruksjonene endres i «Administrer analysemaler» — åpne panelet fra
        skinnen til venstre. Malene merket FAST kan ikke endres noe sted;
        plassholderne i dem ({'{context}'}, {'{all_findings}'}) er det som gir
        analysen noe å lese.
      </div>
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
  const qt = QUERY_TYPES.find(q => q.key === data.query_type)
    || { key: data.query_type, label: data.query_type || 'Analyse' }
  const items = data[outputKeyFor(data.query_type)] || []
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
            : (data.aggregated === false
                ? <span>analyse per dokument</span>
                : <span>{items.length} {qt.label.toLowerCase()}</span>)}
        </div>
      )}

      {!isLoading && isRisk && (
        <>
          {data.aggregated && (items.length > 0 || (data.monstre || []).length > 0) && (
            <div style={{ marginBottom: 18 }}>
              <div style={sectionHeading}>Syntese på tvers av dokumentene</div>
              <LabeledList label="Overordnede mønstre" values={data.monstre} />
              {items.map((item, i) => <RiskItem key={i} item={item} />)}
              <div style={{ marginTop: 12 }}>
                <LabeledList label="Usikkerhet og kunnskapshull" values={data.usikkerhet_kunnskapshull} />
                <LabeledList label="Spørsmål til ledergruppen" values={data.sporsmal_til_ledergruppen} />
              </div>
            </div>
          )}
          {data.aggregated
            ? <FindingsBreakdown items={items} perDoc={perDoc} />
            : (
              <>
                <div style={sectionHeading}>Analyse per dokument</div>
                {perDoc.length === 0
                  ? <div style={{ fontSize: 14, color: C.textFaint, padding: '0.5rem 0' }}>Ingen dokumenter ga funn.</div>
                  : perDoc.map((entry, i) => <RiskDocAnalysis key={i} entry={entry} />)}
              </>
            )}
        </>
      )}

      {!isLoading && !isRisk && (
        data.aggregated === false ? (
          // No synthesis ran, so there are no findings to group documents under.
          <>
            <div style={sectionHeading}>Analyse per dokument</div>
            {perDoc.length === 0
              ? <div style={{ fontSize: 14, color: C.textFaint, padding: '0.5rem 0' }}>Ingen dokumenter ga funn.</div>
              : perDoc.map((entry, i) => (
                  <FindingSource key={i} source={{ tittel: entry.tittel || entry.filename }} entry={entry} />
                ))}
          </>
        ) : (
          <>
            {items.length === 0
              ? <div style={{ fontSize: 14, color: C.textFaint, padding: '0.5rem 0' }}>Ingen funn ble aggregert.</div>
              : items.map((item, i) => <AggregateItem key={i} item={item} queryType={data.query_type} />)}
            {perDoc.length > 0 && <FindingsBreakdown items={items} perDoc={perDoc} />}
          </>
        )
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
  { key: 'kilde_url',         label: 'Kilde-URL (sitatlenke)', type: 'text' },
  { key: 'oppsummering',      label: 'Oppsummering',  type: 'textarea' },
]

function entryKey(entry) { return entry.url || entry.filnavn || '' }
function entrySource(entry) {
  if (entry.url) return entry.url
  if (entry.filnavn) return entry.filnavn.split(/[\\\/]/).pop()
  return '—'
}

// Documents the folder import will pick up; anything else in the folder is left
// alone. Matches what the single-document form accepts.
const IMPORTABLE_EXT = /\.(pdf|docx|pptx|ppt)$/i

function formatEta(seconds) {
  if (seconds < 45) return 'under ett minutt'
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `ca. ${mins} min`
  const h = Math.floor(mins / 60)
  return `ca. ${h} t ${mins % 60} min`
}

function formatBytes(n) {
  if (!n) return ''
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Readable working title from a filename, so an imported row is never blank
// even when metadata derivation is off or fails.
function titleFromFilename(name) {
  return name
    .replace(IMPORTABLE_EXT, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// CSV for a Microsoft Teams / Lists import: comma-separated with RFC 4180
// quoting, CRLF line endings, and a UTF-8 BOM so both Lists and Excel read the
// Norwegian characters correctly instead of mojibake.
const CSV_COLUMNS = [
  { header: 'Tittel',           value: e => e.tittel || '' },
  { header: 'Kilde',            value: e => entrySource(e) },
  { header: 'Kildetype',        value: e => (e.url ? 'Nettside' : 'Fil') },
  { header: 'Segment',          value: e => e.segment || '' },
  { header: 'Publisert av',     value: e => e.publisert_av || '' },
  { header: 'Årstall',          value: e => e.publisert_arstall ?? '' },
  { header: 'Type kilde',       value: e => e.type_kilde || '' },
  { header: 'Målgruppe',        value: e => e.malgruppe || '' },
  { header: 'Antall deltakere', value: e => e.antall_deltakere || '' },
  { header: 'Kilde-URL',        value: e => e.kilde_url || e.url || '' },
  { header: 'Oppsummering',     value: e => e.oppsummering || '' },
]

function csvCell(v) {
  const s = String(v ?? '')
  // A leading =, +, - or @ makes a spreadsheet read the text as a formula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function entriesToCsv(entries) {
  const rows = [CSV_COLUMNS.map(c => csvCell(c.header)).join(',')]
  for (const e of entries) rows.push(CSV_COLUMNS.map(c => csvCell(c.value(e))).join(','))
  return '\uFEFF' + rows.join('\r\n') + '\r\n'
}

function downloadEntriesCsv(entries, indexName) {
  const blob = new Blob([entriesToCsv(entries)], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${indexName || 'dokumentbank'}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

// Modal shell shared by the settings panel and the entry editor: a backdrop
// that closes on click, Escape to dismiss, and a scroll lock on the page behind
// so the overlay is the only thing that moves.
function Modal({ open, onClose, title, subtitle, width = 480, children }) {
  const dialogRef = useRef(null)
  const [expanded, setExpanded] = useState(false)

  // Each open starts at the default size — an expanded dialog left over from a
  // previous row is disorienting when a small one is expected. Adjusted during
  // render rather than in an effect, which would cost a second render pass.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setExpanded(false)
  }

  useEffect(() => {
    if (!open) return
    const onEsc = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      // Only a press that both starts and ends on the backdrop closes — dragging
      // a text selection out of the dialog shouldn't dismiss it.
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: expanded ? 16 : '8vh 16px 16px',
      }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          ...card,
          padding: '1.25rem 1.5rem', outline: 'none', textAlign: 'left',
          boxShadow: '0 18px 48px rgba(15,23,42,0.24)',
          // Expanded fills the viewport; otherwise the corner handle drags it to
          // any size the content needs. `resize` needs a non-visible overflow.
          overflow: 'auto',
          ...(expanded
            ? { width: '100%', maxWidth: 'none', height: '100%', maxHeight: 'none' }
            : {
                width: `min(${width}px, 100%)`, maxHeight: '84vh',
                resize: 'both', minWidth: 320, minHeight: 200,
              }),
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={subtitle}>{subtitle}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => setExpanded(v => !v)}
              aria-label={expanded ? 'Gjenopprett størrelse' : 'Utvid til hele vinduet'}
              title={expanded ? 'Gjenopprett størrelse' : 'Utvid til hele vinduet'}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: C.textFaint, padding: '2px 4px', lineHeight: 0, fontFamily: 'inherit',
              }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {expanded
                  ? <><path d="M2 6h4V2" /><path d="M14 10h-4v4" /></>
                  : <><path d="M6 2H2v4" /><path d="M10 14h4v-4" /></>}
              </svg>
            </button>
            <button onClick={onClose} aria-label="Lukk" title="Lukk" style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: C.textFaint, fontSize: 20, lineHeight: 1, padding: 0, fontFamily: 'inherit',
            }}>×</button>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function AdminEntryRow({ entry, server, indexName, onSaved, onDeleted, onChanged, editingKey, setEditingKey, unbuilt }) {
  const [draft, setDraft] = useState(entry)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deriving, setDeriving] = useState(false)
  const [err, setErr] = useState('')
  const replaceInputRef = useRef(null)

  const key = entryKey(entry)
  // Only one row edits at a time — driven by the parent's editingKey.
  const editing = editingKey === key

  const startEdit = () => { setDraft(entry); setEditingKey(key); setErr('') }
  const cancel    = () => { setEditingKey(null); setErr('') }

  // Derive metadata from the already-stored document (file or URL) and fill in
  // only the empty draft fields — never clobber what's already entered.
  const deriveMetadata = async () => {
    setDeriving(true); setErr('')
    try {
      const url = `${server.replace(/\/$/, '')}/admin/derive-metadata`
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index_name: indexName, key }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      const m = data.metadata || {}
      setDraft(prev => {
        const next = { ...prev }
        for (const f of ADMIN_FIELDS) {
          const v = m[f.key]
          const empty = next[f.key] == null || next[f.key] === ''
          if (v != null && v !== '' && empty) next[f.key] = v
        }
        return next
      })
    } catch (e) {
      setErr(`Kunne ikke avlede metadata: ${e.message}`)
    } finally {
      setDeriving(false)
    }
  }

  // Replace a URL entry (e.g. one the server can't fetch because of a 403) with
  // an uploaded local copy. The backend carries over metadata and keeps the
  // original URL as kilde_url so citation links still work.
  const replaceWithFile = async (selFile) => {
    if (!selFile) return
    if (!confirm(`Erstatt URL-oppføringen «${entry.tittel || entrySource(entry)}» med filen «${selFile.name}»?\nDen opprinnelige URL-en beholdes som kilde_url for sitatlenker.`)) return
    setBusy(true); setErr('')
    try {
      const url = `${server.replace(/\/$/, '')}/admin/entries?index_name=${encodeURIComponent(indexName)}`
      const fd = new FormData()
      fd.append('file', selFile)
      fd.append('replace_key', key)
      const res = await fetch(url, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      onChanged?.()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

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
      setEditingKey(null)
      onSaved(data.entry)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm(`Slette «${entry.tittel || entrySource(entry)}» fra listen?\n(Innholdet forsvinner fra dokumentbanken neste gang du oppdaterer den. Selve filen blir liggende på serveren.)`)) return
    setBusy(true); setDeleting(true); setErr('')
    try {
      const url = `${server.replace(/\/$/, '')}/admin/entries?index_name=${encodeURIComponent(indexName)}&key=${encodeURIComponent(key)}`
      const res = await fetch(url, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      onDeleted(key)   // row unmounts here
    } catch (e) { setErr(e.message); setBusy(false); setDeleting(false) }
  }

  return (
    <tr style={{
      borderTop: `1px solid ${C.border}`, verticalAlign: 'top',
      opacity: deleting ? 0.5 : 1,
      background: deleting ? C.dangerBg : 'transparent',
      transition: 'opacity .15s',
    }}>
      <td colSpan={5} style={{ padding: 0 }}>
        <div style={{ padding: '10px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.2fr 0.6fr auto', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {deleting && <span aria-hidden="true" title="Slettes…" style={{ fontSize: 14, flexShrink: 0 }}>🗑</span>}
                {unbuilt && !deleting && (
                  <span title="Ikke bygget inn i dokumentbanken ennå"><Tag tone="warn">IKKE BYGGET</Tag></span>
                )}
                <span style={{
                  fontSize: 13, fontWeight: 500, color: C.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  textDecoration: deleting ? 'line-through' : 'none',
                }}>
                  {entry.tittel || <span style={{ color: C.textFaint, fontStyle: 'italic' }}>uten tittel</span>}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entrySource(entry)}>
                {entry.url ? <Tag tone="accent">URL</Tag> : <Tag tone="neutral">FIL</Tag>}
                <span style={{ marginLeft: 6 }}>{entrySource(entry)}</span>
              </div>
              <div style={{ fontSize: 12, color: C.textMute }}>{entry.segment || '—'}</div>
              <div style={{ fontSize: 12, color: C.textMute }}>{entry.publisert_arstall ?? '—'}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                {deleting && (
                  <span style={{ fontSize: 12, color: C.danger, fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>
                    Sletter<LoadingDots />
                  </span>
                )}
                {!deleting && entry.url && (
                  <>
                    <button onClick={() => window.open(entry.url, '_blank', 'noopener')} disabled={busy} style={btn.ghost}
                      title="Åpne/last ned kilden i nettleseren">Last ned ↗</button>
                    <input ref={replaceInputRef} type="file" accept=".pdf,.docx,.pptx,.ppt" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; replaceWithFile(f) }} />
                    <button onClick={() => replaceInputRef.current?.click()} disabled={busy} style={btn.ghost}
                      title="Last opp en lokal kopi og erstatt denne URL-oppføringen (for kilder serveren ikke får hentet)">Erstatt med fil</button>
                  </>
                )}
                {!deleting && <button onClick={startEdit} disabled={busy} style={btn.ghost}>Rediger</button>}
                {!deleting && <button onClick={remove} disabled={busy} style={btn.danger} title="Slett fra listen">🗑 Slett</button>}
              </div>
            </div>

          <Modal
            open={editing}
            // Closing mid-save would leave the row showing stale values.
            onClose={() => { if (!busy && !deriving) cancel() }}
            title="Rediger dokument"
            subtitle={entrySource(entry)}
            width={720}>
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
              {deriving && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: C.accent }}>
                  <LoadingDots /> Avleder metadata med AI…
                </div>
              )}
              {err && <div style={{ fontSize: 12, color: C.danger, marginTop: 8 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={deriveMetadata} disabled={busy || deriving}
                  title="Les dokumentet og fyll ut tomme metadatafelt med AI"
                  style={{ ...btn.ghost, ...(busy || deriving ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
                  {deriving ? 'Avleder…' : 'Avled metadata'}
                </button>
                <button onClick={save}   disabled={busy || deriving} style={btn.primary}>{busy ? 'Lagrer…' : 'Lagre'}</button>
                <button onClick={cancel} disabled={busy} style={btn.ghost}>Avbryt</button>
              </div>
          </Modal>
        </div>
      </td>
    </tr>
  )
}

// Whatever the picker returns becomes one batch — a single document takes the
// same route as fifty, so the flow doesn't change shape with the file count.
function classifyPick(fileList) {
  const all = Array.from(fileList || [])
  const files = all.filter(f => IMPORTABLE_EXT.test(f.name))
  return {
    files,
    scanned: all.length,
    unsupported: all.length - files.length,
    err: all.length && !files.length ? 'Fant ingen PDF-, DOCX- eller PPTX-filer i valget.' : '',
  }
}

function AddEntryForm({ server, indexName, entries, initialFiles, onImported, onClose, onBusyChange }) {
  // The picker runs before the form opens, so the form only has to act on it.
  const [pick] = useState(() => classifyPick(initialFiles))

  return (
    <div style={{ ...card, padding: '1.25rem 1.5rem', marginBottom: 14, background: C.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Legg til dokument(er)</div>
        <button onClick={onClose} style={btn.ghost}>Lukk</button>
      </div>

      {pick.err && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{pick.err}</div>}

      {pick.files.length > 0 && (
        <BulkAddPanel
          server={server}
          indexName={indexName}
          entries={entries}
          files={pick.files}
          scanned={pick.scanned}
          unsupported={pick.unsupported}
          onImported={onImported}
          onClose={onClose}
          onBusyChange={onBusyChange}
        />
      )}
    </div>
  )
}

function ReindexPanel({ server, indexName, onDone, onBusyChange, toIngest = 0, toPrune = 0 }) {
  const [job, setJob] = useState(null)  // {status, events[]}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [docFilter, setDocFilter] = useState('all')   // 'all' | 'new' | 'skipped' | 'failed'
  const [interrupted, setInterrupted] = useState(false)
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
      `Dette sletter eksisterende dokumentbank for «${indexName}» og bygger den om fra bunnen. Fortsette?`
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
      setInterrupted(false)
      try { localStorage.setItem(storageKey, data.job_id) } catch { /* ignore */ }
      poll(data.job_id)
    } catch (e) { setErr(e.message); setBusy(false); setJob(null) }
  }

  const poll = async (jobId) => {
    try {
      const base = server.replace(/\/$/, '')
      const res = await fetch(`${base}/admin/reindex/${jobId}?last=${eventCountRef.current}`)
      if (res.status === 404) {
        // The server lost the job — almost always an instance restart. The work
        // isn't lost with it: the manifest is only written after each batch is
        // on disk, so a new run picks up exactly where this one stopped.
        try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
        setInterrupted(true)
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
        if (effectiveStatus === 'done') onDone?.()
      }
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])

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
  // Count only *completed* documents (terminal per-doc events), not started ones —
  // otherwise the bar jumps to 100% the moment the last/heaviest doc *begins*.
  const completedCount = events.filter(e =>
    e.event === 'doc_done' || e.event === 'doc_failed' ||
    e.event === 'doc_skipped' || e.event === 'skip'
  ).length
  const current = total > 0 ? Math.min(completedCount, total) : completedCount
  const remaining = Math.max(0, total - current)
  // A doc_start without a matching terminal event means that document is still
  // being processed right now.
  const lastStart = [...events].reverse().find(e => e.event === 'doc_start')
  const docInFlight = lastStart && completedCount <= (lastStart.index ?? 0)
  // Finalizing: every document is accounted for but the job hasn't emitted the
  // terminal 'done' yet (server is reloading the index + uploading to blob).
  const finalizing = job?.status === 'running' && total > 0 && current >= total

  // Time left, from how long the documents actually read so far have taken.
  // Entries already in the manifest emit an instant `skip`, so they are left
  // out of both the remaining count and the rate — including them would make
  // the estimate collapse toward zero on a mostly-unchanged dokumentbank.
  const ingestTotal = Math.max(0, total - (startEvt?.already_ingested ?? 0))
  const ingestDone = events.filter(e =>
    e.event === 'doc_done' || e.event === 'doc_failed' || e.event === 'doc_skipped'
  )
  const etaSeconds = (() => {
    if (finalizing || !ingestDone.length || ingestTotal <= ingestDone.length) return null
    const t0 = Date.parse(events.find(e => e.event === 'doc_start')?.ts || '')
    const t1 = Date.parse(ingestDone[ingestDone.length - 1]?.ts || '')
    if (!(t1 > t0)) return null
    const perDoc = (t1 - t0) / ingestDone.length
    return Math.round((perDoc * (ingestTotal - ingestDone.length)) / 1000)
  })()
  // Newest post-processing message to show during the finalizing tail.
  const finalizingMsg = [...events].reverse().find(e =>
    ['reload', 'blob_upload', 'synced', 'cleared'].includes(e.event) && e.message
  )?.message
  // Hold the bar just under full during finalizing so 100% means "truly done".
  // Nothing for an incremental run to do — a full rebuild is still allowed.
  const nothingToDo = toIngest === 0 && toPrune === 0

  const pct = total > 0
    ? (finalizing ? 99 : Math.round((current / total) * 100))
    : 0
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: C.textMute, lineHeight: 1.6, maxWidth: 460 }}>
          {nothingToDo ? (
            <span>Ingen endringer — dokumentbanken er i takt med listen.</span>
          ) : (
            <>
              <strong style={{ color: C.text, fontWeight: 600 }}>Oppdateringen vil:</strong>{' '}
              {[
                toIngest > 0 && `lese inn ${toIngest} ${toIngest === 1 ? 'dokument' : 'dokumenter'}`,
                toPrune > 0 && `fjerne ${toPrune} ${toPrune === 1 ? 'slettet dokument' : 'slettede dokumenter'}`,
              ].filter(Boolean).join(' og ')}.
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => start('incremental')} disabled={busy || nothingToDo}
            title={nothingToDo ? 'Ingenting å oppdatere' : 'Les inn nye og endrede dokumenter'}
            style={{ ...btn.primary, ...(busy || nothingToDo ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
            {busy ? <>Kjører<LoadingDots /></> : 'Oppdater dokumentbanken'}
          </button>
          <button onClick={() => start('full')} disabled={busy} style={btn.ghost}>
            Bygg dokumentbanken på nytt
          </button>
          <InfoButton title={REINDEX_INFO.title} paragraphs={REINDEX_INFO.paragraphs} align="right" />
        </div>
      </div>

      {err && <div style={{ fontSize: 12, color: C.danger, marginTop: 10 }}>{err}</div>}

      {interrupted && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          background: C.warnBg, border: `1px solid ${C.border}`,
          fontSize: 12.5, color: C.textMute, lineHeight: 1.6,
        }}>
          <strong style={{ color: C.text }}>Byggingen ble avbrutt</strong> — serveren startet
          sannsynligvis på nytt. {current > 0 ? `${current} av ${total} dokumenter rakk å bli bygget inn, og de er lagret.` : 'Det som rakk å bli bygget inn er lagret.'}{' '}
          Kjør «Oppdater dokumentbanken» på nytt, så fortsetter den der den slapp.
        </div>
      )}

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
                {etaSeconds != null && (
                  <div style={{ fontSize: 13, color: C.textFaint }}>· {formatEta(etaSeconds)} igjen</div>
                )}
                <div style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>
                  {pct}%
                </div>
              </div>

              <div style={{ height: 12, background: C.border, borderRadius: 99, overflow: 'hidden', marginBottom: 12 }}>
                <div
                  className={finalizing ? 'reindex-bar-indeterminate' : undefined}
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${C.accent}, #60A5FA)`,
                    borderRadius: 99,
                    transition: 'width .4s ease-out',
                    minWidth: pct > 0 ? 8 : 0,
                  }}
                />
              </div>

              {finalizing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: C.textMute }}>
                  <LoadingDots />
                  <span>Fullfører — lagrer og laster opp dokumentbank{finalizingMsg ? ` (${finalizingMsg})` : '…'}</span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, marginBottom: docInFlight && lastStart?.tittel ? 8 : 0 }}>
                    <span style={{ color: C.text }}>
                      <strong style={{ color: remaining > 0 ? C.accent : C.success }}>{remaining}</strong> gjenstår
                    </span>
                    {etaMs != null && remaining > 0 && (
                      <span style={{ color: C.textMute }}>{fmtDur(etaMs)} igjen</span>
                    )}
                  </div>

                  {docInFlight && lastStart?.tittel && (
                    <div style={{ fontSize: 12, color: C.textFaint, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <LoadingDots />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Behandler: {lastStart.tittel}
                      </span>
                    </div>
                  )}
                </>
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

function QueryTypePicker({ selected, onToggle }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.textMute }}>
          Analyser ({selected.size}/{QUERY_TYPES.length} valgt)
        </span>
      </div>
      <div style={{ padding: 6 }}>
        {QUERY_TYPES.map(qt => {
          const on = selected.has(qt.key)
          return (
            <label key={qt.key} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6,
              cursor: 'pointer', background: on ? C.accentBg : 'transparent',
            }}>
              <input type="checkbox" checked={on} onChange={() => onToggle(qt.key)} style={{ marginTop: 2 }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13, color: C.text }}>{qt.label}</span>
                {qt.description && (
                  <span style={{ display: 'block', fontSize: 11, color: C.textFaint }}>{qt.description}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function ReportPicker({ reports, selected, search, onSearch, onToggle, onSelectAll, onClear }) {
  const q = search.trim().toLowerCase()
  const filtered = (reports || []).filter(r =>
    !q || (r.tittel || '').toLowerCase().includes(q) || (r.key || '').toLowerCase().includes(q))

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.textMute }}>
          Rapporter{reports ? ` (${selected.size}/${reports.length} valgt)` : ''}
        </span>
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Søk i rapporter…"
          style={{
            flex: 1, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit',
            border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.text,
          }} />
        <button type="button" onClick={() => onSelectAll(filtered.map(r => r.key))} style={btn.ghost}>Velg alle</button>
        <button type="button" onClick={onClear} style={btn.ghost}>Fjern alle</button>
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', padding: 6 }}>
        {reports == null ? (
          <div style={{ fontSize: 12, color: C.textFaint, padding: '10px 6px' }}>Laster rapporter…</div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textFaint, padding: '10px 6px' }}>
            {reports.length === 0 ? 'Ingen eksisterende rapporter ennå.' : 'Ingen treff.'}
          </div>
        ) : filtered.map(r => {
          const on = selected.has(r.key)
          return (
            <label key={r.key} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6,
              cursor: 'pointer', background: on ? C.accentBg : 'transparent',
            }}>
              <input type="checkbox" checked={on} onChange={() => onToggle(r.key)} style={{ marginTop: 2 }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Tag tone={r.kind === 'url' ? 'accent' : 'neutral'}>{r.kind === 'url' ? 'URL' : 'FIL'}</Tag>
                  <span style={{ fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.tittel || r.key}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: C.textFaint }}>i: {(r.indexes || []).join(', ')}</span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// Bulk-add every document in a folder the user picks. Files already in the list
// are filtered out *before* anything is sent: the server writes an uploaded file
// to disk before it reports the duplicate, so posting a known filename would
// overwrite the stored copy even though the entry itself is kept.
// Adds many documents in one pass. It receives files already chosen in the add
// form and only decides what to do with them: anything already in the list is
// filtered out *before* upload, because the server writes an uploaded file to
// disk before it reports the duplicate — posting a known filename would
// overwrite the stored copy even though the entry itself is kept.
function BulkAddPanel({ server, indexName, entries, files, scanned, unsupported, onImported, onClose, onBusyChange }) {
  const [excluded, setExcluded] = useState(() => new Set())
  const [derive, setDerive]     = useState(true)
  const [running, setRunning]   = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const [result, setResult]     = useState(null)
  const cancelRef = useRef(false)

  useEffect(() => { onBusyChange?.(running) }, [running, onBusyChange])

  const existing = useMemo(() => {
    const set = new Set()
    for (const e of entries || []) {
      const src = entrySource(e)
      if (src && src !== '—') set.add(src.toLowerCase())
    }
    return set
  }, [entries])

  const fresh   = useMemo(() => files.filter(f => !existing.has(f.name.toLowerCase())), [files, existing])
  const skipped = useMemo(() => files.filter(f => existing.has(f.name.toLowerCase())).map(f => f.name), [files, existing])
  const selectedFiles = fresh.filter(f => !excluded.has(f.name))

  const toggleFile = (name) => setExcluded(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  // Derive first, then create the entry with the metadata attached — the same
  // order the single-document form uses, and one round trip less than creating
  // the entry and patching it afterwards.
  const deriveFields = async (base, file) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${base}/admin/derive-metadata`, { method: 'POST', body: fd })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || res.statusText)
    return data.metadata || {}
  }

  const run = async () => {
    const base = server.replace(/\/$/, '')
    const queue = selectedFiles
    cancelRef.current = false
    setRunning(true)
    setProgress({ done: 0, total: queue.length, current: '' })

    const added = []
    const failed = []
    for (let i = 0; i < queue.length; i++) {
      if (cancelRef.current) break
      const file = queue[i]
      setProgress({ done: i, total: queue.length, current: file.name })
      try {
        let meta = {}
        if (derive) {
          // Metadata is a bonus — a file the LLM can't read is still worth adding.
          try { meta = await deriveFields(base, file) } catch { meta = {} }
        }
        const fd = new FormData()
        fd.append('file', file)
        ADMIN_FIELDS.forEach(f => {
          const v = meta[f.key]
          if (v != null && v !== '') fd.append(f.key, String(v))
        })
        if (!meta.tittel) fd.set('tittel', titleFromFilename(file.name))
        // No overwrite flag: a duplicate that slipped past the pre-filter is
        // reported back as failed rather than silently replacing what's there.
        const res = await fetch(`${base}/admin/entries?index_name=${encodeURIComponent(indexName)}`,
          { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || res.statusText)
        if (data.entry) added.push(data.entry)
      } catch (e) {
        failed.push({ name: file.name, error: e.message })
      }
    }

    setProgress(p => ({ ...p, done: p.total, current: '' }))
    setRunning(false)
    setResult({ added: added.length, alreadyInList: skipped.length, failed, cancelled: cancelRef.current })
    if (added.length) onImported(added)
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  if (running) {
    return (
      <div style={{ padding: '12px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 6 }}>
          Legger til {Math.min(progress.done + 1, progress.total)} av {progress.total}
        </div>
        <div style={{ height: 6, borderRadius: 99, background: C.surface, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: C.accent, transition: 'width .2s' }} />
        </div>
        <div style={{ fontSize: 12, color: C.textMute, marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {progress.current}
        </div>
        <button onClick={() => { cancelRef.current = true }} style={btn.danger}>Avbryt</button>
      </div>
    )
  }

  if (result) {
    return (
      <div style={{ padding: '12px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 6 }}>
          {result.cancelled ? 'Avbrutt' : 'Ferdig'}
        </div>
        <div style={{ fontSize: 12.5, color: C.textMute, lineHeight: 1.6 }}>
          {result.added} lagt til
          {result.alreadyInList > 0 && ` · ${result.alreadyInList} fantes fra før`}
          {result.failed.length > 0 && ` · ${result.failed.length} feilet`}
        </div>
        {result.failed.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: C.danger, lineHeight: 1.6, maxHeight: 140, overflowY: 'auto' }}>
            {result.failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={onClose} style={btn.primary}>Lukk</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 8 }}>
        Valgte {scanned} {scanned === 1 ? 'fil' : 'filer'}
        {unsupported > 0 && ` · ${unsupported} av andre formater enn PDF/DOCX/PPTX`}
      </div>

      {fresh.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.textMute, lineHeight: 1.6, marginBottom: 10 }}>
          Ingen nye dokumenter å legge til.
          {skipped.length > 0 && ` Alle ${skipped.length} ligger allerede i listen.`}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: C.textMute, lineHeight: 1.6, marginBottom: 8 }}>
            <strong style={{ color: C.text }}>{selectedFiles.length}</strong> av {fresh.length} nye {fresh.length === 1 ? 'dokument' : 'dokumenter'} legges til.
            {skipped.length > 0 && ` ${skipped.length} ligger i listen fra før og hoppes over.`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ ...metaLabel }}>Dokumenter</span>
            <button onClick={() => setExcluded(new Set())} style={{ ...btn.ghost, padding: '2px 8px', fontSize: 11 }}>Velg alle</button>
            <button onClick={() => setExcluded(new Set(fresh.map(f => f.name)))} style={{ ...btn.ghost, padding: '2px 8px', fontSize: 11 }}>Ingen</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 10, border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface }}>
            {fresh.map(f => (
              <label key={f.name} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                fontSize: 12.5, color: C.text, cursor: 'pointer',
              }}>
                <input type="checkbox" checked={!excluded.has(f.name)} onChange={() => toggleFile(f.name)} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>{f.name}</span>
                <span style={{ fontSize: 11, color: C.textFaint, flexShrink: 0 }}>{formatBytes(f.size)}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {skipped.length > 0 && (
        <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 12, color: C.textFaint, cursor: 'pointer' }}>
            {skipped.length} ligger allerede i listen
          </summary>
          <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 6, fontSize: 12, color: C.textFaint, lineHeight: 1.7 }}>
            {skipped.map(n => <div key={n} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</div>)}
          </div>
        </details>
      )}

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: C.textMute, cursor: 'pointer', marginBottom: 12 }}>
        <input type="checkbox" checked={derive} onChange={e => setDerive(e.target.checked)} style={{ marginTop: 2 }} />
        <span>
          Avled metadata med AI — leser hvert dokument og fyller ut tittel, segment, årstall
          og resten. Metadata avledes per dokument, og kan rettes i listen etterpå.
          {selectedFiles.length > 0 && ` Det blir ${selectedFiles.length} AI-kall.`}
        </span>
      </label>

      {selectedFiles.length > 20 && (
        <div style={{
          padding: '9px 12px', marginBottom: 10, borderRadius: 8,
          background: C.warnBg, border: `1px solid ${C.border}`,
          fontSize: 12.5, color: C.textMute, lineHeight: 1.6,
        }}>
          Dette er en stor import. Dokumentene lastes opp ett om gangen, og hvert
          av dem er lagret så snart det er lagt til — avbryter du underveis, eller
          faller nettforbindelsen, beholder du det som er kommet inn. Kjør importen
          på nytt etterpå, så hoppes de over automatisk.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={run} disabled={!selectedFiles.length}
          style={{ ...btn.primary, ...(selectedFiles.length ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }}>
          {selectedFiles.length
            ? `Legg til ${selectedFiles.length} ${selectedFiles.length === 1 ? 'dokument' : 'dokumenter'}`
            : 'Ingen valgt'}
        </button>
        <button onClick={onClose} style={btn.ghost}>Avbryt</button>
      </div>
    </div>
  )
}

// The admin view is a two-phase flow: a document is first registered in the
// list, and only becomes searchable once the dokumentbank is rebuilt. The
// numbered sections — badge plus a connecting rail down the left — keep that
// order visible instead of leaving it to the help text.
// A wait long enough to look broken deserves an explanation. The elapsed
// counter shows something is still happening, and after a few seconds the
// likely reason is named rather than left to guesswork.
function ListLoading({ compact }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (compact) {
    return (
      <span style={{ color: C.accent, fontWeight: 500 }}>
        Henter liste<LoadingDots />{secs >= 3 ? ` ${secs}s` : ''}
      </span>
    )
  }
  return (
    <div style={{ padding: '1.75rem 1.5rem', textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: C.text, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>
        Henter dokumentlisten<LoadingDots />
      </div>
      {secs >= 3 && (
        <div style={{ fontSize: 12.5, color: C.textMute, marginTop: 8, lineHeight: 1.6, maxWidth: 460, margin: '8px auto 0' }}>
          {secs}s. Rett etter en bygging laster serveren fortsatt opp dokumentbanken,
          og listen må vente på tur. Den kommer så snart opplastingen er ferdig.
        </div>
      )}
    </div>
  )
}

function StepSection({ step, title, description, action, children, locked }) {
  return (
    <section style={{ marginBottom: 24 }} aria-busy={locked || undefined}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10, flexWrap: 'wrap', ...lockedWhile(locked) }}>
        <div style={{
          flexShrink: 0, width: 26, height: 26, borderRadius: 999,
          background: C.accent, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, marginTop: 1,
        }}>{step}</div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{title}</div>
          <div style={{ fontSize: 12.5, color: C.textMute, marginTop: 3, lineHeight: 1.5, maxWidth: 620 }}>{description}</div>
        </div>
        {action && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{action}</div>}
      </div>
      <div style={{ marginLeft: 12, paddingLeft: 24, borderLeft: `2px solid ${C.border}`, ...lockedWhile(locked) }}>
        {children}
      </div>
    </section>
  )
}

// Pull reports that already exist in other banks into this one. The catalogue
// entry carries the whole document_store record, so posting it as JSON reuses
// the file on disk — nothing is uploaded twice, and the same document can serve
// several banks.
function AddExistingReports({ server, indexName, entries, onAdded, onClose }) {
  const [reports, setReports]   = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [search, setSearch]     = useState('')
  const [busy, setBusy]         = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult]     = useState(null)

  useEffect(() => {
    let cancelled = false
    const base = server.replace(/\/$/, '')
    fetch(`${base}/admin/reports`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (!cancelled) setReports(d.reports || []) })
      .catch(() => { if (!cancelled) setReports([]) })
    return () => { cancelled = true }
  }, [server])

  // The catalogue keys on url-or-basename; match the bank's own entries the
  // same way so what's already here is filtered out rather than offered again.
  const already = useMemo(() => {
    const set = new Set()
    for (const e of entries || []) {
      const k = e.url || (e.filnavn || '').replace(/\\/g, '/').split('/').pop()
      if (k) set.add(k.toLowerCase())
    }
    return set
  }, [entries])

  const available = useMemo(
    () => (reports || []).filter(r => !already.has((r.key || '').toLowerCase())),
    [reports, already])

  const chosen = available.filter(r => selected.has(r.key))
  const urlCount = chosen.filter(r => r.kind === 'url').length

  const add = async () => {
    setBusy(true)
    setProgress({ done: 0, total: chosen.length })
    const base = server.replace(/\/$/, '')
    const added = []
    const failed = []
    let skipped = 0
    for (let i = 0; i < chosen.length; i++) {
      setProgress({ done: i, total: chosen.length })
      const r = chosen[i]
      try {
        const res = await fetch(`${base}/admin/entries?index_name=${encodeURIComponent(indexName)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(r.entry),
        })
        const data = await res.json().catch(() => ({}))
        if (res.status === 409) { skipped++; continue }
        if (!res.ok) throw new Error(data.error || res.statusText)
        if (data.entry) added.push(data.entry)
      } catch (e) {
        failed.push({ name: r.tittel || r.key, error: e.message })
      }
    }
    setProgress(p => ({ ...p, done: p.total }))
    setBusy(false)
    setResult({ added: added.length, skipped, failed })
    if (added.length) onAdded(added)
  }

  if (busy) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
    return (
      <div>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 8 }}>
          Legger til {Math.min(progress.done + 1, progress.total)} av {progress.total}
        </div>
        <div style={{ height: 6, borderRadius: 99, background: C.bg, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: C.accent, transition: 'width .2s' }} />
        </div>
      </div>
    )
  }

  if (result) {
    return (
      <div>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 6 }}>Ferdig</div>
        <div style={{ fontSize: 12.5, color: C.textMute, lineHeight: 1.6 }}>
          {result.added} lagt til
          {result.skipped > 0 && ` · ${result.skipped} fantes fra før`}
          {result.failed.length > 0 && ` · ${result.failed.length} feilet`}
        </div>
        {result.failed.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: C.danger, lineHeight: 1.6, maxHeight: 140, overflowY: 'auto' }}>
            {result.failed.map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={btn.primary}>Lukk</button>
        </div>
      </div>
    )
  }

  if (reports === null) {
    return <div style={{ fontSize: 13, color: C.textMute, display: 'inline-flex', alignItems: 'center' }}>Henter rapporter<LoadingDots /></div>
  }

  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.textMute, lineHeight: 1.6, marginBottom: 12 }}>
        Dokumenter som allerede finnes i andre dokumentbanker. De deler samme fil
        på serveren, så ingenting lastes opp på nytt.
        {available.length === 0 && ' Alle tilgjengelige rapporter ligger allerede i denne banken.'}
      </div>

      <ReportPicker
        reports={available}
        selected={selected}
        search={search}
        onSearch={setSearch}
        onToggle={(key) => setSelected(prev => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key); else next.add(key)
          return next
        })}
        onSelectAll={(keys) => setSelected(new Set(keys))}
        onClear={() => setSelected(new Set())}
      />

      {urlCount > 0 && (
        <div style={{
          marginTop: 10, padding: '9px 12px', borderRadius: 8,
          background: C.warnBg, border: `1px solid ${C.border}`,
          fontSize: 12.5, color: C.textMute, lineHeight: 1.6,
        }}>
          {urlCount} av valget er nettsider. De legges inn som lenker og hentes på
          nytt ved hver bygging — i motsetning til nye dokumentbanker, der slike
          kilder lastes ned til en fil med én gang.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={add} disabled={!chosen.length}
          style={{ ...btn.primary, ...(chosen.length ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }}>
          {chosen.length ? `Legg til ${chosen.length} ${chosen.length === 1 ? 'rapport' : 'rapporter'}` : 'Ingen valgt'}
        </button>
        <button onClick={onClose} style={btn.ghost}>Avbryt</button>
      </div>
    </div>
  )
}

function AdminView({ server, indexName, indexes, onSelectIndex, onBackToSearch, onIndexCreated, onIndexDeleted, onPendingChange, onBusyChange, registerRollback }) {
  const [entries, setEntries] = useState(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  // Key of the single row currently in edit mode (only one at a time).
  const [editingKey, setEditingKey] = useState(null)
  const [creatingIndex, setCreatingIndex] = useState(false)
  const [newIndexName, setNewIndexName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [materializeStatus, setMaterializeStatus] = useState('')  // progress of URL→PDF download
  // Existing reports the new index can be seeded from.
  const [allReports, setAllReports] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [reportSearch, setReportSearch] = useState('')
  // Which analysetyper (query types) the new index should expose. Defaults to the
  // always-available common types (no `indexes` restriction, i.e. «Fri analyse»).
  const [selectedQTs, setSelectedQTs] = useState(() => new Set(defaultQueryTypeKeys()))

  // Load the catalogue of existing reports when the create-index form opens.
  useEffect(() => {
    if (!creatingIndex) return
    let cancelled = false
    setAllReports(null); setSelectedKeys(new Set()); setReportSearch('')
    setSelectedQTs(new Set(defaultQueryTypeKeys()))
    const base = server.replace(/\/$/, '')
    fetch(`${base}/admin/reports`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (!cancelled) setAllReports(d.reports || []) })
      .catch(() => { if (!cancelled) setAllReports([]) })
    return () => { cancelled = true }
  }, [creatingIndex, server])

  // Poll a materialize (URL→PDF) background job until it finishes, streaming a
  // human-readable status line. Resolves with the final summary.
  const pollMaterialize = (jobId) => new Promise((resolve) => {
    const base = server.replace(/\/$/, '')
    let last = 0
    let final = { status: 'done', converted: 0, failed: 0 }
    const tick = async () => {
      try {
        const r = await fetch(`${base}/admin/reindex/${jobId}?last=${last}`)
        if (r.ok) {
          const d = await r.json()
          last = d.total ?? last
          for (const ev of (d.events || [])) {
            if (ev.event === 'start') setMaterializeStatus(`Laster ned ${ev.total} URL-kilde(r) som filer…`)
            else if (ev.event === 'entry_start') setMaterializeStatus(`Laster ned ${ev.index}/${ev.total}: ${ev.tittel || ev.url}`)
            else if (ev.event === 'entry_done') setMaterializeStatus(`Lastet ned ${ev.index}/${ev.total}: ${ev.tittel || ev.url}`)
            else if (ev.event === 'entry_failed') setMaterializeStatus(`Hoppet over ${ev.index}/${ev.total}: ${ev.tittel || ev.url}`)
            else if (ev.event === 'done') final = { status: 'done', converted: ev.converted || 0, failed: ev.failed || 0 }
            else if (ev.event === 'error') final = { status: 'error', message: ev.message }
          }
          if (d.status === 'done' || d.status === 'error') { resolve(final); return }
        }
      } catch { /* transient — keep polling */ }
      setTimeout(tick, 800)
    }
    tick()
  })

  const submitNewIndex = async (e) => {
    e?.preventDefault?.()
    const name = newIndexName.trim()
    if (!name) { setCreateErr('Navn må fylles ut'); return }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      setCreateErr('Ugyldig navn. Tillatte tegn: a-z, A-Z, 0-9, _ og -')
      return
    }
    setCreateBusy(true); setCreateErr(''); setMaterializeStatus('')
    try {
      const base = server.replace(/\/$/, '')
      const chosen = (allReports || []).filter(r => selectedKeys.has(r.key)).map(r => r.entry)
      const query_types = QUERY_TYPES.filter(qt => selectedQTs.has(qt.key)).map(qt => qt.key)
      const res  = await fetch(`${base}/admin/indexes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, entries: chosen, query_types }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)

      // Seeded URL sources are downloaded into data/<index>/ as PDFs in the
      // background. Show progress, then finalize. The index exists regardless.
      if (data.materialize_job_id) {
        setMaterializeStatus('Forbereder nedlasting av URL-kilder…')
        const summary = await pollMaterialize(data.materialize_job_id)
        onIndexCreated?.(name)
        if (summary.status === 'error') {
          setCreateErr(`Dokumentbanken ble opprettet, men nedlasting av URL-kilder feilet: ${summary.message}`)
          setMaterializeStatus('')
          return  // keep the dialog open so the message is visible
        }
        if (summary.failed > 0) {
          setMaterializeStatus(`Dokumentbanken ble opprettet. ${summary.converted} kilde(r) lastet ned, ${summary.failed} feilet (utilgjengelige for serveren — beholdes som URL). Bygg den med «Oppdater dokumentbanken».`)
          return  // keep the dialog open so the summary is visible
        }
      } else {
        onIndexCreated?.(name)
      }
      setCreatingIndex(false); setNewIndexName(''); setMaterializeStatus('')
    } catch (e) {
      setCreateErr(e.message)
    } finally {
      setCreateBusy(false)
    }
  }

  // What the next build would change, straight from the server's ingest
  // manifest. Session state would be a poorer answer: it can't see documents
  // left unbuilt in an earlier session, and would call a never-built bank
  // "unchanged".
  const [unbuiltKeys, setUnbuiltKeys] = useState(() => new Set())
  const [toPrune, setToPrune] = useState(0)
  const [listLoading, setListLoading] = useState(true)

  const [seedOpen, setSeedOpen] = useState(false)

  // Deleting a bank: open, the name typed to confirm, and the in-flight state.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteName, setDeleteName] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteErr, setDeleteErr]   = useState('')

  const deleteBank = async () => {
    setDeleteBusy(true); setDeleteErr('')
    try {
      const base = server.replace(/\/$/, '')
      const q = encodeURIComponent(indexName)
      // The endpoint wants the name twice — a mistargeted call fails instead of
      // wiping the wrong bank.
      const res = await fetch(`${base}/admin/indexes?index_name=${q}&confirm=${q}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || res.statusText)
      setDeleteOpen(false)
      setDeleteName('')
      // The bank is gone, so nothing about it is pending any more.
      onPendingChange?.(false)
      baselineRef.current = null
      onIndexDeleted?.(indexName, data.removed)
    } catch (e) {
      setDeleteErr(e.message)
    } finally {
      setDeleteBusy(false)
    }
  }

  const refreshPending = useCallback(async () => {
    if (!indexName) { setUnbuiltKeys(new Set()); setToPrune(0); return }
    try {
      const base = server.replace(/\/$/, '')
      const res = await fetch(`${base}/admin/reindex/pending?index_name=${encodeURIComponent(indexName)}`)
      if (!res.ok) return
      const data = await res.json()
      setUnbuiltKeys(new Set(data.to_ingest || []))
      setToPrune(data.to_prune || 0)
    } catch { /* the panel still works without the flags */ }
  }, [server, indexName])

  const load = useCallback(async () => {
    // No bank at all — after deleting the last one. Show an empty list rather
    // than leaving the previous bank's rows on screen.
    if (!indexName) { setEntries([]); setListLoading(false); setErr(''); return }
    setErr('')
    setListLoading(true)
    try {
      const base = server.replace(/\/$/, '')
      const res = await fetch(`${base}/admin/entries?index_name=${encodeURIComponent(indexName)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      const list = data.entries || []
      // The first list we see is the committed state. Closing without building
      // restores it, so the panel behaves like an edit session you can discard.
      if (baselineRef.current === null) baselineRef.current = list
      setEntries(list)
    } catch (e) { setErr(e.message); setEntries([]) }
    finally { setListLoading(false) }
  }, [server, indexName])

  // Switching bank starts a fresh session: the snapshot below belongs to one
  // list only, and reusing it across banks would restore the wrong documents.
  useEffect(() => {
    baselineRef.current = null
    setDirty(false)
  }, [indexName])

  useEffect(() => { load() }, [load])

  // Every mutation replaces the entries array, so this covers adds, edits and
  // deletes without each call site having to remember.
  useEffect(() => { refreshPending() }, [entries, refreshPending])

  // Undo every change made since the panel opened. Entries added since are
  // deleted, entries removed are put back (their files were never deleted from
  // the server, so a JSON re-add is enough), and edited metadata is written
  // back. Nothing has touched the dokumentbank yet, so this restores the whole
  // session without loss.
  const rollback = useCallback(async () => {
    const baseline = baselineRef.current
    if (!baseline) return
    const base = server.replace(/\/$/, '')
    const entryUrl = (key) =>
      `${base}/admin/entries?index_name=${encodeURIComponent(indexName)}`
      + (key ? `&key=${encodeURIComponent(key)}` : '')

    let current = []
    try {
      const res = await fetch(entryUrl())
      const data = await res.json()
      current = res.ok ? (data.entries || []) : []
    } catch { return }

    const baseMap = new Map(baseline.map(e => [entryKey(e), e]))
    const curMap  = new Map(current.map(e => [entryKey(e), e]))

    const jobs = []
    for (const key of curMap.keys()) {
      if (!baseMap.has(key)) jobs.push({ kind: 'del', key })
    }
    for (const [key, entry] of baseMap) {
      const cur = curMap.get(key)
      if (!cur) jobs.push({ kind: 'add', entry })
      else if (JSON.stringify(cur) !== JSON.stringify(entry)) jobs.push({ kind: 'put', key, entry })
    }
    if (!jobs.length) return

    setRestoring({ done: 0, total: jobs.length })
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]
      setRestoring({ done: i, total: jobs.length })
      try {
        if (job.kind === 'del') {
          await fetch(entryUrl(job.key), { method: 'DELETE' })
        } else if (job.kind === 'add') {
          await fetch(entryUrl(), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job.entry),
          })
        } else {
          await fetch(entryUrl(job.key), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job.entry),
          })
        }
      } catch { /* keep going — a partial restore beats stopping halfway */ }
    }
    setRestoring(null)
  }, [server, indexName])

  // App owns the close button and the confirm, so it needs a handle on this.
  useEffect(() => {
    if (!registerRollback) return
    registerRollback(rollback)
    return () => registerRollback(null)
  }, [registerRollback, rollback])

  // The file picker runs first, straight off the button click, and its result
  // seeds the form — so adding a document never starts on an empty screen.
  const addFilesRef = useRef(null)
  const [pendingFiles, setPendingFiles] = useState(null)
  // AddEntryForm reads its files once, on mount — a fresh pick has to remount it.
  const [pickSeq, setPickSeq] = useState(0)
  // The OS file dialog can take a moment to appear, and .click() returns long
  // before it does — without this the button looks like it ignored the press.
  const [picking, setPicking] = useState(false)

  // The dialog closing is the only reliable end signal across browsers:
  // `cancel` isn't fired everywhere, but the window always regains focus. The
  // delay lets a file selection's own change event settle first.
  useEffect(() => {
    if (!picking) return
    let timer = null
    const onFocus = () => { timer = setTimeout(() => setPicking(false), 500) }
    window.addEventListener('focus', onFocus)
    // If the dialog never opened, the window never lost focus and no focus
    // event is coming — release the button rather than leave it stuck.
    const failsafe = setTimeout(() => setPicking(false), 60000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearTimeout(failsafe)
      if (timer) clearTimeout(timer)
    }
  }, [picking])

  const selectIndex = (name) => {
    if (name === indexName) return
    if (dirty && !window.confirm(
      `Endringene i «${indexName}» er ikke bygget inn i dokumentbanken.\n\n`
      + 'Bytter du nå, blir de stående som de er — de kan ikke angres senere.\n\n'
      + 'Bytte dokumentbank likevel?'
    )) return
    onPendingChange?.(false)
    onSelectIndex?.(name)
  }

  // The committed list, captured on first load — see rollback() below.
  const baselineRef = useRef(null)
  // Which long job is running, if any: 'build' | 'import'. Everything outside
  // the running job is locked so the two can't be started against each other.
  const [runningJob, setRunningJob] = useState(null)
  const onBuildBusy  = useCallback(b => setRunningJob(b ? 'build' : null), [])
  const onImportBusy = useCallback(b => setRunningJob(b ? 'import' : null), [])
  useEffect(() => { onBusyChange?.(!!runningJob) }, [runningJob, onBusyChange])

  // Mirrors what we've told App: changes the build hasn't picked up yet.
  const [dirty, setDirty] = useState(false)
  const markDirty = () => { setDirty(true); onPendingChange?.(true) }
  const [restoring, setRestoring] = useState(null)   // { done, total }

  // Edited metadata is what /query filters on, and it only reaches the index on
  // the next build — so an edit counts as pending just like an added document.
  const handleSaved   = (updated) => {
    setEntries(es => es.map(e => entryKey(e) === entryKey(updated) ? updated : e))
    markDirty()
  }
  const handleDeleted = (key) => {
    setEntries(es => es.filter(e => entryKey(e) !== key))
    // The document leaves the dokumentbank on the next build, so until then
    // this is a pending change like any other.
    markDirty()
  }

  const markNew = () => markDirty()
  const handleImported = (added)  => { setEntries(es => [...(es || []), ...added]); markNew() }

  return (
    <div>
      {restoring && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(15,23,42,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ ...card, padding: '1.25rem 1.5rem', width: 'min(380px, 86vw)', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8 }}>
              Tilbakestiller listen<LoadingDots />
            </div>
            <div style={{ fontSize: 12.5, color: C.textMute }}>
              {restoring.done} av {restoring.total} endringer angret
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: C.text }}>Administrer dokumenter</div>
            <InfoButton
              title="Legge til et dokument"
              paragraphs={ADD_DOC_HELP.intro}
              steps={ADD_DOC_HELP.steps}
              footnote={ADD_DOC_HELP.footnote}
            />
          </div>
        </div>
        <button onClick={onBackToSearch} title="Skjul panel" disabled={!!runningJob} style={{
          border: `1px solid ${C.border}`, background: C.bg, color: C.textMute,
          borderRadius: 8, width: 28, height: 28, fontSize: 15, lineHeight: 1,
          flexShrink: 0, cursor: runningJob ? 'not-allowed' : 'pointer',
          opacity: runningJob ? 0.4 : 1,
        }}>«</button>
      </div>

      {/* Hidden while the new-bank form is up: picking a different bank there
          has no bearing on the one being created. */}
      {!creatingIndex && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16, ...lockedWhile(!!runningJob) }}>
        <label htmlFor="admin-index" style={{ fontSize: 13, color: C.textMute }}>Dokumentbank:</label>
        <select
          id="admin-index"
          value={indexName || ''}
          onChange={e => selectIndex(e.target.value)}
          disabled={!indexes?.length}
          style={{
            padding: '6px 10px', fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
            border: `1px solid ${C.border}`, borderRadius: 8,
            background: C.surface, color: C.text, cursor: 'pointer', maxWidth: 320,
          }}>
          {!indexName && <option value="">—</option>}
          {(indexes || []).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ fontSize: 13, color: C.textFaint }}>
          {listLoading ? <ListLoading compact /> : `${entries?.length ?? 0} oppføringer`}
        </span>
        <button onClick={() => { setCreatingIndex(true); setCreateErr(''); setNewIndexName('') }} style={btn.ghost}>+ Ny dokumentbank</button>
        <button
          onClick={() => { setDeleteOpen(true); setDeleteName(''); setDeleteErr('') }}
          disabled={!indexName}
          title={indexName ? `Slett «${indexName}» permanent` : 'Ingen dokumentbank valgt'}
          style={{ ...btn.danger, ...(indexName ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }}>
          Slett dokumentbank
        </button>
      </div>
      )}

      <Modal
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        title="Legg til eksisterende rapporter"
        subtitle={indexName}
        width={640}>
        {seedOpen && (
          <AddExistingReports
            server={server}
            indexName={indexName}
            entries={entries}
            onAdded={handleImported}
            onClose={() => setSeedOpen(false)}
          />
        )}
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => { if (!deleteBusy) setDeleteOpen(false) }}
        title="Slett dokumentbank"
        subtitle={indexName}
        width={520}>
        <div style={{
          padding: '10px 12px', borderRadius: 8, marginBottom: 14,
          background: C.dangerBg, border: `1px solid ${C.danger}`,
          fontSize: 13, color: C.text, lineHeight: 1.6,
        }}>
          <strong>Dette kan ikke angres.</strong> Alt som hører til «{indexName}» slettes permanent:
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            <li>{entries == null ? 'alle' : entries.length} oppføringer i dokumentlisten</li>
            <li>alle opplastede filer på serveren</li>
            <li>den bygde dokumentbanken (vektorindeksen) og kopiene i skylagringen</li>
          </ul>
        </div>

        <label htmlFor="delete-confirm" style={{ display: 'block', fontSize: 13, color: C.textMute, marginBottom: 6 }}>
          Skriv <strong style={{ color: C.text }}>{indexName}</strong> for å bekrefte:
        </label>
        <input
          id="delete-confirm"
          autoFocus
          value={deleteName}
          onChange={e => setDeleteName(e.target.value)}
          disabled={deleteBusy}
          spellCheck={false}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
            border: `1.5px solid ${C.borderHi}`, background: C.surface, color: C.text,
            fontSize: 14, fontFamily: 'monospace', outline: 'none',
          }}
        />

        {deleteErr && <div style={{ fontSize: 12, color: C.danger, marginTop: 10 }}>{deleteErr}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button
            onClick={deleteBank}
            disabled={deleteBusy || deleteName !== indexName}
            style={{
              ...btn.danger,
              ...(deleteBusy || deleteName !== indexName
                ? { opacity: 0.5, cursor: 'not-allowed' }
                : { background: C.danger, color: '#fff', borderColor: C.danger }),
            }}>
            {deleteBusy ? <>Sletter<LoadingDots /></> : 'Slett permanent'}
          </button>
          <button onClick={() => setDeleteOpen(false)} disabled={deleteBusy} style={btn.ghost}>Avbryt</button>
        </div>
      </Modal>

      {creatingIndex && (
        <form onSubmit={submitNewIndex} style={{ ...card, padding: '1rem 1.25rem', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 8 }}>Ny dokumentbank</div>
          <div style={{ fontSize: 12, color: C.textMute, marginBottom: 10 }}>
            Gi dokumentbanken et navn, velg hvilke analyser den skal tilby, og eventuelt
            rapporter den skal inneholde fra eksisterende rapporter. Bygg den med «Oppdater dokumentbanken» etterpå.
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
              marginBottom: 12,
            }}
          />

          {/* Pick which analysetyper this index should expose */}
          <QueryTypePicker
            selected={selectedQTs}
            onToggle={(key) => setSelectedQTs(prev => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key); else next.add(key)
              return next
            })}
          />

          {/* Pick existing reports to seed the index with */}
          <ReportPicker
            reports={allReports}
            selected={selectedKeys}
            search={reportSearch}
            onSearch={setReportSearch}
            onToggle={(key) => setSelectedKeys(prev => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key); else next.add(key)
              return next
            })}
            onSelectAll={(keys) => setSelectedKeys(new Set(keys))}
            onClear={() => setSelectedKeys(new Set())}
          />

          {createErr && <div style={{ fontSize: 12, color: C.danger, margin: '8px 0' }}>{createErr}</div>}
          {materializeStatus && <div style={{ fontSize: 12, color: C.textMute, margin: '8px 0' }}>{materializeStatus}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={createBusy} style={btn.primary}>
              {createBusy ? (materializeStatus ? 'Laster ned kilder…' : 'Oppretter…') : (selectedKeys.size ? `Opprett med ${selectedKeys.size} rapport(er)` : 'Opprett')}
            </button>
            <button type="button" onClick={() => { setCreatingIndex(false); setMaterializeStatus('') }} disabled={createBusy} style={btn.ghost}>
              {(!createBusy && (materializeStatus || createErr)) ? 'Lukk' : 'Avbryt'}
            </button>
          </div>
        </form>
      )}

      {/* Original-index editing — hidden while the new-index dialog is open so
          "Ny dokumentbank" shows only its own form. */}
      {!creatingIndex && (
        <>
          <StepSection
            locked={runningJob === 'build'}
            step={1}
            title="Registrer dokumentene"
            description="Legg til, rediger og slett oppføringer i listen. Her lagres dokumentet og metadataene om det — innholdet blir ikke søkbart før steg 2 er kjørt."
            action={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                <input
                  ref={addFilesRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.pptx,.ppt"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const picked = Array.from(e.target.files || [])
                    e.target.value = ''
                    setPicking(false)
                    if (picked.length) {
                      setPendingFiles(picked)
                      setPickSeq(n => n + 1)
                      setAdding(true)
                    }
                  }}
                  onCancel={() => setPicking(false)}
                />
                <button
                  onClick={() => { setPicking(true); addFilesRef.current?.click() }}
                  disabled={picking || !indexName}
                  style={{
                    ...btn.primary,
                    ...(picking ? { opacity: 0.7, cursor: 'wait' } : {}),
                    ...(!indexName ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                  }}>
                  {picking ? <>Åpner filvelger<LoadingDots /></> : '+ Legg til dokument(er)'}
                </button>
                <button
                  onClick={() => setSeedOpen(true)}
                  disabled={!indexName}
                  title="Hent inn dokumenter som allerede finnes i andre dokumentbanker"
                  style={{ ...btn.ghost, ...(indexName ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }}>
                  + Fra andre dokumentbanker
                </button>
              </div>
            }>
            {adding && (
              <AddEntryForm key={pickSeq} server={server} indexName={indexName} entries={entries}
                initialFiles={pendingFiles}
                onBusyChange={onImportBusy}
                onImported={handleImported}
                onClose={() => { setAdding(false); setPendingFiles(null) }} />
            )}

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
              {listLoading && entries != null && (
                <div style={{
                  padding: '8px 14px', borderBottom: `1px solid ${C.border}`,
                  background: C.accentBg, fontSize: 12.5, color: C.accent, fontWeight: 500,
                  display: 'flex', alignItems: 'center',
                }}>
                  Oppdaterer listen<LoadingDots />
                </div>
              )}
              {entries == null ? (
                <ListLoading />
              ) : entries.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: 13, color: C.textFaint }}>Ingen oppføringer ennå.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {entries.map((entry, i) => (
                      <AdminEntryRow key={entryKey(entry) || i}
                        entry={entry} server={server} indexName={indexName}
                        onSaved={handleSaved} onDeleted={handleDeleted} onChanged={load}
                        editingKey={editingKey} setEditingKey={setEditingKey}
                        unbuilt={unbuiltKeys.has(entryKey(entry))} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                onClick={() => downloadEntriesCsv(entries || [], indexName)}
                disabled={!entries || entries.length === 0}
                title="Last ned listen som CSV — klar for import som Teams-/Microsoft-liste"
                style={{ ...btn.ghost, ...(entries && entries.length ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }}>
                ⭳ Eksporter listen til CSV
              </button>
            </div>
          </StepSection>

          <StepSection
            locked={runningJob === 'import'}
            step={2}
            title="Bygg dokumentbanken"
            description="Her tas endringene i listen i bruk: nye dokumenter leses, deles opp i tekstbiter og bygges inn i vektorindeksen, og slettede dokumenter fjernes fra den. Først når dette er gjort gjelder listen for analysene."
          >
            <ReindexPanel server={server} indexName={indexName}
              onBusyChange={onBuildBusy}
              toIngest={unbuiltKeys.size} toPrune={toPrune}
              onDone={() => {
                setAdding(false)
                setPendingFiles(null)
                setDirty(false)
                onPendingChange?.(false)
                baselineRef.current = null   // the build commits this list
                load()
                refreshPending()
              }} />
          </StepSection>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, ...lockedWhile(!!runningJob) }}>
            <button onClick={onBackToSearch} style={btn.ghost} title="Skjul panel">« Tilbake til analyse</button>
          </div>
        </>
      )}
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

function EmptyState({ indexName, onPick }) {
  const examples = examplesFor(indexName)
  return (
    <div style={{ ...card, padding: '2rem 1.75rem', textAlign: 'center' }}>
      <div style={{ fontSize: 15, color: C.text, fontWeight: 600, marginBottom: 6 }}>
        Klar til å analysere på tvers av dokumentene
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

// Settings sit in a modal overlay on top of the app: dismissed with the close
// button, a click on the backdrop, or Escape. The page behind it can't scroll
// while it is open.
function SettingsModal({ open, onClose, server, onServerChange, themeName, onThemeChange }) {
  return (
    <Modal open={open} onClose={onClose} title="Innstillinger">
        <div style={{ ...metaLabel, marginBottom: 8 }}>Server-URL</div>
        <input value={server} onChange={e => onServerChange(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box', fontFamily: 'monospace', background: C.surface, color: C.text }} />

        <div style={{ ...metaLabel, marginTop: 20, marginBottom: 8 }}>Fargetema</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {THEME_LIST.map(t => {
            const selected = t.key === themeName
            return (
              <button key={t.key} onClick={() => onThemeChange(t.key)}
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={{
            padding: '8px 18px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.surface, color: C.text, cursor: 'pointer',
            fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          }}>Lukk</button>
        </div>
    </Modal>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
const SIDEBAR_TOP = 61  // height of the sticky top bar

// Sits next to ConversationSidebar and behaves the same way: a rail that
// expands into a working panel, so document admin opens alongside the analysis
// view instead of replacing it. Wider than the log — the document table needs
// the room.
// Create and edit analysetyper. Built-in types can have their instructions
// changed and reset; types made here can also be renamed and deleted.
//
// A new type runs on the free-analysis machinery and produces the generic
// {label, description, sources} finding shape — the structured chain that
// Strategisk risiko emits is drawn by dedicated components, so a new type
// cannot invent an output nothing knows how to render.
function AnalysisAdmin({ server, indexes, onBackToSearch, onChanged }) {
  const [types, setTypes]   = useState(null)
  const [err, setErr]       = useState('')
  const [busy, setBusy]     = useState(false)
  const [editing, setEditing] = useState(null)   // key being edited
  const [draft, setDraft]   = useState({})
  const [creating, setCreating] = useState(false)
  const [form, setForm]     = useState({
    key: '', label: '', description: '', copy_from: '',
    extract_system: '', aggregate_system: '', default_question: '',
  })
  const [suggesting, setSuggesting] = useState(false)

  // Copying supplies the instructions; starting blank means writing them, and
  // the description is the one thing the author has already put into words.
  const suggest = async () => {
    setSuggesting(true); setErr('')
    try {
      const res = await fetch(`${base}/admin/query-types/suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: form.label, description: form.description }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setForm(f => ({
        ...f,
        extract_system: data.extract_system || f.extract_system,
        aggregate_system: data.aggregate_system || f.aggregate_system,
        default_question: data.default_question || f.default_question,
      }))
    } catch (e) { setErr(e.message) } finally { setSuggesting(false) }
  }

  // Which templates each bank offers. An absent entry means the bank follows
  // each template's own default rule rather than an explicit list.
  const [bankMap, setBankMap] = useState(null)
  const [bank, setBank]       = useState('')
  const [bankPick, setBankPick] = useState(null)   // null until a bank is chosen
  const [bankMsg, setBankMsg] = useState('')

  const base = server.replace(/\/$/, '')

  const load = useCallback(async () => {
    setErr('')
    try {
      const res = await fetch(`${base}/admin/query-types`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setTypes(data.query_types || [])
    } catch (e) { setErr(e.message); setTypes([]) }
  }, [base])

  useEffect(() => { load() }, [load])

  const loadBankMap = useCallback(async () => {
    try {
      const res = await fetch(`${base}/admin/index-query-types`)
      setBankMap(res.ok ? (await res.json()) : {})
    } catch { setBankMap({}) }
  }, [base])

  useEffect(() => { loadBankMap() }, [loadBankMap])

  // Picking a bank seeds the checkboxes from what it offers today — either its
  // pinned list, or what the defaults would give it.
  const selectBank = (name) => {
    setBank(name)
    setBankMsg('')
    if (!name) { setBankPick(null); return }
    const pinned = bankMap?.[name]
    if (Array.isArray(pinned)) {
      setBankPick(new Set(pinned))
    } else {
      setBankPick(new Set(queryTypesForIndex(name, bankMap).map(qt => qt.key)))
    }
  }

  const saveBank = async () => {
    setBusy(true); setErr(''); setBankMsg('')
    try {
      const res = await fetch(`${base}/admin/index-query-types/${encodeURIComponent(bank)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query_types: [...(bankPick || [])] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setBankMsg(data.using_defaults
        ? 'Lagret. Banken bruker nå standardreglene for hver mal.'
        : `Lagret. Banken tilbyr ${data.query_types.length} ${data.query_types.length === 1 ? 'mal' : 'maler'}.`)
      await loadBankMap()
      await onChanged?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const after = async () => { await load(); await loadBankMap(); await onChanged?.() }

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`${base}/admin/query-types`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setCreating(false)
      setForm({
        key: '', label: '', description: '', copy_from: '',
        extract_system: '', aggregate_system: '', default_question: '',
      })
      await after()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`${base}/admin/query-types/${editing}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setEditing(null)
      await after()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const remove = async (row) => {
    const what = row.custom
      ? `Slette analysemalen «${row.label || row.key}»?\n\nDette kan ikke angres.`
      : `Tilbakestille «${row.label || row.key}» til standardinstruksjonene?`
    if (!window.confirm(what)) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`${base}/admin/query-types/${row.key}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      await after()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const startEdit = (row) => {
    setEditing(row.key)
    setDraft({
      label: row.label, description: row.description,
      default_question: row.default_question,
      extract_system: row.extract_system, aggregate_system: row.aggregate_system,
    })
  }

  const field = (k) => draft[k] ?? ''
  const setField = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const editRow = types?.find(r => r.key === editing)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: C.text }}>Administrer analysemaler</div>
        <button onClick={onBackToSearch} title="Skjul panel" style={{
          border: `1px solid ${C.border}`, background: C.bg, color: C.textMute,
          borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0,
        }}>«</button>
      </div>

      <div style={{ fontSize: 12.5, color: C.textMute, lineHeight: 1.6, marginBottom: 16, maxWidth: 620 }}>
        Analysemalene bestemmer hva en aggregert analyse ser etter. Innebygde maler
        kan få nye instruksjoner og tilbakestilles; egne maler kan i tillegg
        omdøpes og slettes.
      </div>

      {!creating && (
        <button onClick={() => { setCreating(true); setErr('') }} style={{ ...btn.primary, marginBottom: 16 }}>
          + Ny analysemal
        </button>
      )}

      {creating && (
        <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 10 }}>Ny analysemal</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 12 }}>
            <div>
              <div style={{ ...metaLabel, marginBottom: 4 }}>Navn</div>
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="f.eks. Tiltak og anbefalinger" style={inp.text} />
            </div>
            <div>
              <div style={{ ...metaLabel, marginBottom: 4 }}>Nøkkel</div>
              <input value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                placeholder="tiltak" spellCheck={false}
                style={{ ...inp.text, fontFamily: 'monospace' }} />
              <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3 }}>
                Små bokstaver, tall og understrek. Kan ikke endres senere.
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ ...metaLabel, marginBottom: 4 }}>Beskrivelse</div>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Vises under navnet når analysetypen velges" style={inp.text} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ ...metaLabel, marginBottom: 4 }}>Bygg på en eksisterende mal</div>
              <select value={form.copy_from} onChange={e => setForm(f => ({ ...f, copy_from: e.target.value }))}
                style={{ ...inp.text, cursor: 'pointer' }}>
                <option value="">Start tom</option>
                {(types || []).map(r => (
                  <option key={r.key} value={r.key}>{r.label || r.key}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3 }}>
                Kopierer instruksjonene fra malen du velger, så du kan justere dem
                i stedet for å skrive dem fra bunnen.
              </div>
            </div>
          </div>

          {!form.copy_from && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={suggest}
                  disabled={suggesting || !form.description.trim()}
                  title={form.description.trim()
                    ? 'La AI skrive et utkast ut fra beskrivelsen'
                    : 'Skriv en beskrivelse først — den er grunnlaget for forslaget'}
                  style={{ ...btn.ghost, ...(suggesting || !form.description.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
                  {suggesting ? <>Foreslår<LoadingDots /></> : '✨ Foreslå instruksjoner'}
                </button>
                <span style={{ fontSize: 11.5, color: C.textFaint }}>
                  Utkast basert på beskrivelsen. Les gjennom og juster før du oppretter.
                </span>
              </div>

              <div style={{ ...metaLabel, marginBottom: 3 }}>Instruksjon per dokument</div>
              <AutoTextarea value={form.extract_system}
                onChange={e => setForm(f => ({ ...f, extract_system: e.target.value }))}
                spellCheck={false} style={{
                  width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
                  minHeight: 70, padding: '8px 12px', borderRadius: 8, fontSize: 12,
                  background: C.surface, color: C.text, border: `1px solid ${C.border}`,
                  fontFamily: 'monospace', lineHeight: 1.5, outline: 'none', marginBottom: 10,
                }} />

              <div style={{ ...metaLabel, marginBottom: 3 }}>Instruksjon for oppsummeringen</div>
              <AutoTextarea value={form.aggregate_system}
                onChange={e => setForm(f => ({ ...f, aggregate_system: e.target.value }))}
                spellCheck={false} style={{
                  width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
                  minHeight: 70, padding: '8px 12px', borderRadius: 8, fontSize: 12,
                  background: C.surface, color: C.text, border: `1px solid ${C.border}`,
                  fontFamily: 'monospace', lineHeight: 1.5, outline: 'none',
                }} />
              <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4, lineHeight: 1.6 }}>
                Må be om JSON på formen {'{{"items": [{{"label": …, "description": …, "sources": […]}}]}}'} —
                med doble klammer, siden teksten kjøres gjennom en mal før den sendes til modellen.
              </div>
            </div>
          )}

          {err && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            {(() => {
              // Either copy the instructions from somewhere, or supply them.
              const ready = form.key.trim() && form.label.trim() &&
                (form.copy_from || (form.extract_system.trim() && form.aggregate_system.trim()))
              return (
                <button onClick={create} disabled={busy || !ready}
                  title={ready ? undefined : 'Fyll inn navn, nøkkel og enten en mal å bygge på eller begge instruksjonene'}
                  style={{ ...btn.primary, ...(busy || !ready ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
                  {busy ? 'Oppretter…' : 'Opprett'}
                </button>
              )
            })()}
            <button onClick={() => { setCreating(false); setErr('') }} disabled={busy} style={btn.ghost}>Avbryt</button>
          </div>
        </div>
      )}

      {(indexes || []).length > 0 && (
        <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
            Hvilke maler en dokumentbank tilbyr
          </div>
          <div style={{ fontSize: 12.5, color: C.textMute, lineHeight: 1.6, marginBottom: 12 }}>
            Velg en dokumentbank og kryss av malene den skal tilby i analysevisningen.
            Fjerner du alle kryssene, faller banken tilbake på standardregelen for hver mal.
          </div>

          <select
            value={bank}
            onChange={e => selectBank(e.target.value)}
            style={{
              padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
              border: `1px solid ${C.border}`, borderRadius: 8,
              background: C.surface, color: C.text, cursor: 'pointer', maxWidth: 340,
            }}>
            <option value="">Velg dokumentbank…</option>
            {(indexes || []).map(n => <option key={n} value={n}>{n}</option>)}
          </select>

          {bank && bankPick && (
            <>
              <div style={{ fontSize: 11, color: C.textFaint, margin: '10px 0 6px' }}>
                {Array.isArray(bankMap?.[bank])
                  ? 'Banken har en egen liste i dag.'
                  : 'Banken følger standardreglene i dag — lagrer du her, får den sin egen liste.'}
              </div>
              <div style={{
                border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg,
                maxHeight: 260, overflowY: 'auto', marginBottom: 10,
              }}>
                {(types || []).map(r => (
                  <label key={r.key} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px',
                    fontSize: 13, color: C.text, cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={bankPick.has(r.key)}
                      onChange={() => setBankPick(prev => {
                        const next = new Set(prev)
                        if (next.has(r.key)) next.delete(r.key); else next.add(r.key)
                        return next
                      })}
                      style={{ marginTop: 3 }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.label || r.key}
                        {r.custom && <Tag tone="success">EGEN</Tag>}
                      </span>
                      {r.description && (
                        <span style={{ display: 'block', fontSize: 11.5, color: C.textMute, lineHeight: 1.5 }}>
                          {r.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={saveBank} disabled={busy} style={btn.primary}>
                  {busy ? 'Lagrer…' : 'Lagre for denne banken'}
                </button>
                <button onClick={() => selectBank(bank)} disabled={busy} style={btn.ghost}>Forkast endringer</button>
                {bankMsg && <span style={{ fontSize: 12, color: C.success }}>{bankMsg}</span>}
              </div>
            </>
          )}
        </div>
      )}

      {err && !creating && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{err}</div>}

      {types === null ? (
        <div style={{ fontSize: 13, color: C.textMute, display: 'inline-flex', alignItems: 'center' }}>
          Henter analysemaler<LoadingDots />
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {types.map((row, i) => (
            <div key={row.key} style={{
              padding: '12px 14px',
              borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
              display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{row.label || row.key}</span>
                  <Tag tone={row.custom ? 'success' : 'neutral'}>{row.custom ? 'EGEN' : 'INNEBYGD'}</Tag>
                  <span style={{ fontSize: 11, color: C.textFaint, fontFamily: 'monospace' }}>{row.key}</span>
                </div>
                {row.description && (
                  <div style={{ fontSize: 12.5, color: C.textMute, lineHeight: 1.5 }}>{row.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => startEdit(row)} disabled={busy} style={btn.ghost}>Rediger</button>
                <button onClick={() => remove(row)} disabled={busy} style={btn.danger}>
                  {row.custom ? 'Slett' : 'Tilbakestill'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => { if (!busy) setEditing(null) }}
        title={editRow?.custom ? 'Rediger analysemal' : 'Rediger instruksjoner'}
        subtitle={editRow?.label || editing}
        width={720}>
        {editRow && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {editRow.custom && (
              <>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 4 }}>Navn</div>
                  <input value={field('label')} onChange={e => setField('label', e.target.value)} style={inp.text} />
                </div>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 4 }}>Beskrivelse</div>
                  <input value={field('description')} onChange={e => setField('description', e.target.value)} style={inp.text} />
                </div>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 4 }}>Standardspørsmål</div>
                  <input value={field('default_question')} onChange={e => setField('default_question', e.target.value)} style={inp.text} />
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3 }}>
                    Brukes når analysen kjøres uten at du skriver inn et spørsmål.
                  </div>
                </div>
              </>
            )}

            <div>
              <div style={{ ...metaLabel, marginBottom: 3 }}>Instruksjon per dokument</div>
              <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 5 }}>
                Styrer hva som hentes ut av hvert enkelt dokument.
              </div>
              <AutoTextarea value={field('extract_system')} onChange={e => setField('extract_system', e.target.value)}
                spellCheck={false} style={{
                  width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
                  padding: '8px 12px', borderRadius: 8, fontSize: 12, background: C.surface, color: C.text,
                  border: `1px solid ${C.border}`, fontFamily: 'monospace', lineHeight: 1.5, outline: 'none',
                }} />
            </div>

            <div>
              <div style={{ ...metaLabel, marginBottom: 3 }}>Instruksjon for oppsummeringen</div>
              <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 5 }}>
                Styrer hvordan funnene fra alle dokumentene settes sammen. Må be om
                JSON på formen {'{"items": [{"label": …, "description": …, "sources": […]}]}'} —
                det er den formen visningen tegner.
              </div>
              <AutoTextarea value={field('aggregate_system')} onChange={e => setField('aggregate_system', e.target.value)}
                spellCheck={false} style={{
                  width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
                  padding: '8px 12px', borderRadius: 8, fontSize: 12, background: C.surface, color: C.text,
                  border: `1px solid ${C.border}`, fontFamily: 'monospace', lineHeight: 1.5, outline: 'none',
                }} />
            </div>

            {err && <div style={{ fontSize: 12, color: C.danger }}>{err}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={save} disabled={busy} style={btn.primary}>{busy ? 'Lagrer…' : 'Lagre'}</button>
              <button onClick={() => setEditing(null)} disabled={busy} style={btn.ghost}>Avbryt</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function AdminDrawer({ open, onOpen, onClose, label, children }) {
  const railRef = useRef(null)
  // The overlay starts where the rails end, so the conversation log stays
  // visible (and usable) next to the expanded panel. Measured rather than
  // hard-coded, since the log has two widths of its own.
  const [railsRight, setRailsRight] = useState(80)
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const measure = () => {
      const right = Math.round(el.getBoundingClientRect().right)
      setRailsRight(prev => (prev === right ? prev : right))
    }
    // ResizeObserver reports an initial size on observe, so no manual first
    // measurement is needed. The rail keeps its width; it's the log beside it
    // that resizes and pushes the rail sideways.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.previousElementSibling) ro.observe(el.previousElementSibling)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const rail = {
    position: 'sticky', top: SIDEBAR_TOP, alignSelf: 'flex-start',
    height: `calc(100vh - ${SIDEBAR_TOP}px)`,
    borderRight: `1px solid ${C.border}`, background: C.surface,
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    width: 40, alignItems: 'center', padding: '10px 0',
  }

  return (
    <>
      {/* The rail keeps its place in the row so nothing shifts when the panel
          opens on top of the page. */}
      <div ref={railRef} style={rail}>
        {!open && (
          <>
            <button onClick={onOpen} title={label} style={{
              border: `1px solid ${C.border}`, background: C.bg, color: C.textMute,
              borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontSize: 15, lineHeight: 1,
            }}>»</button>
            <div style={{
              writingMode: 'vertical-rl', marginTop: 12, fontSize: 11, letterSpacing: '.08em',
              textTransform: 'uppercase', color: C.textFaint, userSelect: 'none',
            }}>{label}</div>
          </>
        )}
      </div>

      {open && (
        // Covers everything below the top bar: while documents are being
        // managed the analysis view is deliberately out of reach, so the two
        // can't be operated against each other mid-edit. The top bar stays
        // above it, so its toggle still closes the panel.
        <div
          onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
          style={{
            position: 'fixed', top: SIDEBAR_TOP, left: railsRight, right: 0, bottom: 0, zIndex: 300,
            background: 'rgba(15,23,42,0.38)', backdropFilter: 'blur(1px)',
          }}>
          <aside style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: `min(1100px, calc(100vw - ${railsRight}px - 40px))`, background: C.surface,
            borderRight: `1px solid ${C.border}`,
            boxShadow: '0 0 44px rgba(15,23,42,0.20)',
            overflowY: 'auto', padding: '1.25rem 1.5rem 2rem',
          }}>
            {children}
          </aside>
        </div>
      )}
    </>
  )
}

function ConversationSidebar({ open, onToggle, history, activeId, onSelect, onDelete, onClear, user }) {
  const frame = {
    position: 'sticky', top: SIDEBAR_TOP, alignSelf: 'flex-start',
    height: `calc(100vh - ${SIDEBAR_TOP}px)`,
    borderRight: `1px solid ${C.border}`, background: C.surface,
    display: 'flex', flexDirection: 'column', flexShrink: 0,
  }

  if (!open) {
    return (
      <div style={{ ...frame, width: 40, alignItems: 'center', padding: '10px 0' }}>
        <button onClick={onToggle} title="Vis samtalelogg" style={{
          border: `1px solid ${C.border}`, background: C.bg, color: C.textMute,
          borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontSize: 15, lineHeight: 1,
        }}>»</button>
        <div style={{
          writingMode: 'vertical-rl', marginTop: 12, fontSize: 11, letterSpacing: '.08em',
          textTransform: 'uppercase', color: C.textFaint, userSelect: 'none',
        }}>Samtalelogg{history.length ? ` · ${history.length}` : ''}</div>
      </div>
    )
  }

  return (
    <aside style={{ ...frame, width: 280, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Samtalelogg</div>
          <div style={{ fontSize: 11, color: C.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 210 }}
            title={user ? `Logget inn som ${user} — loggen følger deg på tvers av enheter` : 'Ikke innlogget — loggen lagres kun i denne nettleseren'}>
            {user ? `👤 ${user}` : 'Kun denne nettleseren'}
          </div>
        </div>
        <button onClick={onToggle} title="Skjul panel" style={{
          border: `1px solid ${C.border}`, background: C.bg, color: C.textMute,
          borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontSize: 15, lineHeight: 1,
        }}>«</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textFaint, padding: '12px 8px', lineHeight: 1.5 }}>
            Ingen samtaler ennå. Søk eller kjør en analyse, så dukker den opp her.
          </div>
        ) : history.map(entry => {
          const active = entry.id === activeId
          return (
            <div key={entry.id} onClick={() => onSelect(entry)} title={conversationTitle(entry)}
              style={{
                position: 'relative', padding: '8px 26px 8px 10px', marginBottom: 4,
                borderRadius: 8, cursor: 'pointer',
                background: active ? C.accentBg : 'transparent',
                border: `1px solid ${active ? C.accent : 'transparent'}`,
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.bg }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
              <div style={{
                fontSize: 13, color: active ? C.accent : C.text, fontWeight: active ? 600 : 500,
                lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>{conversationTitle(entry)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 11, color: C.textFaint }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 99, background: C.bg, border: `1px solid ${C.border}`,
                  maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{entry.index || '—'}</span>
                <span>{relTime(entry.ts)}</span>
              </div>
              <button onClick={e => { e.stopPropagation(); onDelete(entry.id) }} title="Slett samtale"
                style={{
                  position: 'absolute', top: 6, right: 6, width: 18, height: 18, padding: 0,
                  border: 'none', background: 'transparent', color: C.textFaint,
                  cursor: 'pointer', fontSize: 15, lineHeight: 1, borderRadius: 4,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = C.danger }}
                onMouseLeave={e => { e.currentTarget.style.color = C.textFaint }}>×</button>
            </div>
          )
        })}
      </div>

      {history.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '8px 12px' }}>
          <button onClick={onClear} style={{
            width: '100%', padding: '7px 10px', borderRadius: 8,
            border: `1px solid ${C.border}`, background: C.bg, color: C.danger,
            cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
          }}>Tøm hele loggen</button>
        </div>
      )}
    </aside>
  )
}

export default function App() {
  const [server, setServer]             = useState(webserverEndPoint)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // Set while the document list holds changes step 2 hasn't built in yet. Lives
  // here rather than in AdminView so it survives switching to search and back.
  const [adminPending, setAdminPending] = useState(false)
  // A build or import is running in the panel. Leaving would discard the list
  // changes the job is in the middle of committing.
  const [adminBusy, setAdminBusy] = useState(false)
  // The analyses panel. Kept separate from `view` so the documents panel's own
  // guards and rollback stay untouched; they overlay the same area, so opening
  // one closes the other.
  const [analysesOpen, setAnalysesOpen] = useState(false)
  // AdminView hands us its undo function so the confirm below can discard the
  // session's changes before the panel goes away.
  const adminRollbackRef = useRef(null)
  const registerRollback = useCallback((fn) => { adminRollbackRef.current = fn }, [])
  const leaveAdmin = useCallback(async () => {
    if (adminBusy) return
    if (adminPending) {
      if (!window.confirm(
        'Dokumentlisten er endret uten at dokumentbanken er oppdatert.\n\n'
        + 'Lukker du nå, forkastes endringene og listen settes tilbake slik den var '
        + 'da du åpnet panelet. Vil du beholde dem, kjør steg 2 «Bygg dokumentbanken» først.\n\n'
        + 'Lukke og forkaste endringene?'
      )) return
      try { await adminRollbackRef.current?.() } catch { /* leave anyway */ }
      setAdminPending(false)
    }
    setView('search')
  }, [adminPending, adminBusy])
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
  // Conversation log (left panel). Identity comes from App Service Easy Auth via
  // /me; when present the log is mirrored server-side (/history) so it follows the
  // user across devices. Without identity it stays per-browser in localStorage.
  const [currentUser, setCurrentUser]   = useState(null)
  const userRef                         = useRef(null)
  userRef.current = currentUser
  const serverSyncRef                   = useRef(false)  // true only when the API sees our identity
  const [history, setHistory]           = useState(() => loadHistory(null))
  const [activeConvId, setActiveConvId] = useState(null)
  const [sidebarOpen, setSidebarOpen]   = useState(() => {
    try { return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '0' } catch { return true }
  })
  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarOpen ? '1' : '0') } catch { /* ignore */ }
  }, [sidebarOpen])

  // Resolve identity, then load that user's log (server first, local cache fallback).
  // Two possible identity sources:
  //   1. API /me  — works when the App Service receives the principal (same origin
  //      or a Static Web Apps linked backend). Enables cross-device server sync.
  //   2. Static Web Apps /.auth/me — same origin as this SPA; gives the signed-in
  //      user even when the API can't see it, but only for per-browser namespacing.
  useEffect(() => {
    const base = server.replace(/\/$/, '')
    let cancelled = false
    ;(async () => {
      let user = null
      let serverBacked = false
      try {
        const r = await fetch(`${base}/me`, { cache: 'no-store' })
        if (r.ok) { const u = (await r.json()).user; if (u) { user = u; serverBacked = true } }
      } catch { /* auth off or unreachable */ }
      if (!user) {
        try {
          const r = await fetch('/.auth/me', { cache: 'no-store' })
          if (r.ok) { const cp = (await r.json()).clientPrincipal; if (cp?.userDetails) user = cp.userDetails }
        } catch { /* no SWA auth */ }
      }
      if (cancelled) return
      userRef.current = user
      serverSyncRef.current = serverBacked
      setCurrentUser(user)
      let list = loadHistory(user)
      if (serverBacked) {
        try {
          const r = await fetch(`${base}/history`, { cache: 'no-store' })
          if (r.ok) {
            const srv = (await r.json()).history
            if (Array.isArray(srv)) { list = srv; persistHistory(srv, user) }
          }
        } catch { /* keep local cache */ }
      }
      if (!cancelled) setHistory(list)
    })()
    return () => { cancelled = true }
  }, [server])

  // Mirror the full log to the server (fire-and-forget) — only when the API can
  // actually attribute it to this user; otherwise it stays per-browser.
  const syncServer = useCallback((list) => {
    if (!serverSyncRef.current) return
    const base = server.replace(/\/$/, '')
    fetch(`${base}/history`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: list }),
    }).catch(() => {})
  }, [server])

  const saveConversation = useCallback((entry) => {
    setHistory(prev => {
      const next = persistHistory([entry, ...prev.filter(c => c.id !== entry.id)], userRef.current)
      syncServer(next)
      return next
    })
    setActiveConvId(entry.id)
  }, [syncServer])
  const deleteConversation = useCallback((id) => {
    setHistory(prev => {
      const next = persistHistory(prev.filter(c => c.id !== id), userRef.current)
      syncServer(next)
      return next
    })
    setActiveConvId(cur => (cur === id ? null : cur))
  }, [syncServer])
  const clearHistory = useCallback(() => {
    if (!window.confirm('Slette hele samtaleloggen?')) return
    setHistory(() => { const next = persistHistory([], userRef.current); syncServer(next); return next })
    setActiveConvId(null)
  }, [syncServer])
  const openConversation = useCallback((entry) => {
    setView('search')
    setResults(entry.result ? [entry.result] : [])
    setActiveConvId(entry.id)
    setQuestion(entry.question || '')
    if (entry.queryType) setQueryType(entry.queryType)
    setStatus('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
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
  const [indexQueryTypes, setIndexQueryTypes] = useState({})  // { indexName: [keys] }
  const [selectedIndex, setSelectedIndex] = useState('')
  const selectedIndexRef                = useRef('')
  const [options, setOptions]           = useState({})
  const [entries, setEntries]           = useState([])
  const [optionsErr, setOptionsErr]     = useState('')
  const [queryTypeDefs, setQueryTypeDefs] = useState({})
  const [filtersOpen, setFiltersOpen]   = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [promptsOpen, setPromptsOpen]   = useState(false)
  const [queryType, setQueryType]       = useState('free')
  // Frozen snapshot of the last-used report type, read once at mount. We can't
  // init queryType from it directly: until the saved index loads, that report
  // type may not be "available" yet and the reset effect below would wipe it.
  // Instead we restore it in the /indexes handler once the index is known.
  const [savedQueryType] = useState(() => {
    try { return window.localStorage.getItem(QUERYTYPE_STORAGE_KEY) || '' } catch { return '' }
  })

  // Per-index query type filtering: only show analysis types that apply to
  // the currently selected index. Common types (no `indexes` list) are
  // available everywhere.
  const availableQueryTypes = useMemo(
    () => queryTypesForIndex(selectedIndex, indexQueryTypes),
    [selectedIndex, indexQueryTypes]
  )

  // If the active query type isn't available for the new index, fall back to
  // the first available type (typically 'free').
  useEffect(() => {
    if (!availableQueryTypes.some(qt => qt.key === queryType)) {
      setQueryType(availableQueryTypes[0]?.key || 'free')
    }
  }, [availableQueryTypes, queryType])

  // Persist report type so the app resumes where the user left off.
  useEffect(() => {
    try { window.localStorage.setItem(QUERYTYPE_STORAGE_KEY, queryType) } catch {}
  }, [queryType])
  const [nPersonas, setNPersonas]       = useState(3)
  const [chunksPerDoc, setChunksPerDoc] = useState(8)
  const [includeAggregate, setIncludeAggregate] = useState(true)

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
      .then(defs => { registerQueryTypes(defs); setQueryTypeDefs(defs) })
      .catch(() => {})
  }, [server])

  // Per-index analysetype overrides ({ indexName: [keys] }); needed before we
  // can decide which types a (newly created) index actually exposes.
  const refreshIndexQueryTypes = useCallback(() => {
    const base = server.replace(/\/$/, '')
    return fetch(`${base}/admin/index-query-types`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(map => { const m = map && typeof map === 'object' ? map : {}; setIndexQueryTypes(m); return m })
      .catch(() => ({}))
  }, [server])

  useEffect(() => {
    const base = server.replace(/\/$/, '')
    Promise.all([
      fetch(`${base}/indexes`).then(r => r.ok ? r.json() : Promise.reject()),
      refreshIndexQueryTypes(),
    ])
      .then(([list, qtMap]) => {
        setIndexes(list)
        if (list.length && !selectedIndexRef.current) {
          // Restore the last-used index when it still exists, else default to first.
          let saved = ''
          try { saved = window.localStorage.getItem(INDEX_STORAGE_KEY) || '' } catch {}
          const initial = list.includes(saved) ? saved : list[0]
          selectedIndexRef.current = initial
          setSelectedIndex(initial)
          // Restore the last-used report type if it's valid for this index.
          if (savedQueryType && queryTypesForIndex(initial, qtMap).some(qt => qt.key === savedQueryType)) {
            setQueryType(savedQueryType)
          }
        }
      })
      .catch(() => {})
    refreshQueryTypes()
  }, [server, refreshQueryTypes, refreshIndexQueryTypes])

  // Remember the selected index across sessions (mirrors theme persistence).
  useEffect(() => {
    if (selectedIndex) {
      try { window.localStorage.setItem(INDEX_STORAGE_KEY, selectedIndex) } catch {}
    }
  }, [selectedIndex])

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
    // No early return on an empty question: the analysis then runs driven by
    // the query type's system prompt alone.
    // Block until the server has loaded all indexes — avoids querying the wrong
    // (or no) index while loading is still in progress.
    if (healthRef.current.state !== 'ready') {
      setStatusErr(true)
      setStatus(healthRef.current.message || 'Serveren er ikke klar ennå — vent til dokumentbankene er lastet.')
      return
    }
    if (overrideQuestion) setQuestion(overrideQuestion)
    setLoading(true)
    setStatus('Analyserer dokumenter — dette tar 1–3 min…')
    setStatusErr(false)

    const convId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

    const controller = new AbortController()
    cancelRef.current = { controller, jobId: null, cancelled: false }

    const filters = activeFiltersRef.current
    const filtersToSend = Object.keys(filters).length
      ? Object.fromEntries(Object.entries(filters).map(([k, vals]) => [k, vals.join(';')]))
      : undefined

    try {
      const body = {
        question: q, query_type: queryType, n_personas: nPersonas,
        chunks_per_doc: chunksPerDoc, index_name: selectedIndexRef.current,
        include_aggregate: includeAggregate,
      }
      if (filtersToSend) body.filters = filtersToSend

      const placeholderId = Date.now()
      setResults(prev => [{
        _type: 'aggregate', _id: placeholderId, _loading: true,
        question: q, query_type: queryType, index_name: selectedIndexRef.current,
        documents_visited: 0, documents_with_findings: 0,
      }, ...prev])

      const res = await fetch(`${server.replace(/\/$/, '')}/aggregate/stream`, {
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
            const items = evt[outputKeyFor(queryType)] || []
            // With the synthesis skipped the item list is empty by design, and
            // reporting "0 resultater" made a successful run look like a failure.
            setStatus(evt.aggregated === false
              ? `${evt.documents_visited} dokumenter · ${evt.documents_with_findings} med funn · analysert per dokument`
              : `${evt.documents_visited} dokumenter · ${evt.documents_with_findings} med funn · ${items.length} resultater`)
            patch({ ...evt, _loading: false, _type: 'aggregate' })
            saveConversation({
              id: convId, ts: Date.now(), mode: 'aggregate', queryType,
              index: selectedIndexRef.current, question: q,
              result: {
                _type: 'aggregate', _id: placeholderId, _loading: false,
                question: q, query_type: queryType, index_name: selectedIndexRef.current, ...evt,
              },
            })
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

  const placeholder = (QUERY_TYPES.find(q => q.key === queryType)?.description || 'Skriv et spørsmål…')
    + ' (valgfritt — la stå tomt for å bruke analysetypens egen instruks)'

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: C.text, lineHeight: 1.2 }}>DokumentLab</div>
                <InfoButton title={AGGREGATE_INFO.title} paragraphs={AGGREGATE_INFO.paragraphs} />
              </div>
              <div style={{ fontSize: 12, color: C.textFaint, lineHeight: 1.2 }}>Analyser dokumenter med AI</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {indexes.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...lockedWhile(loading) }}>
                <span style={{ fontSize: 12, color: C.textFaint }}>Dokumentbank:</span>
                <select
                  value={selectedIndex}
                  onChange={e => {
                    selectedIndexRef.current = e.target.value
                    setSelectedIndex(e.target.value)
                    // Switching index always proposes "Fri analyse" first.
                    setQueryType('free')
                  }}
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
              onClick={() => setSettingsOpen(true)}
              title="Innstillinger"
              aria-haspopup="dialog"
              style={{
                padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: settingsOpen ? C.accentBg : C.surface, cursor: 'pointer', fontSize: 15,
                color: settingsOpen ? C.accent : C.textMute, lineHeight: 1,
              }}
            >⚙</button>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <ConversationSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(o => !o)}
          history={history}
          activeId={activeConvId}
          onSelect={openConversation}
          onDelete={deleteConversation}
          onClear={clearHistory}
          user={currentUser}
        />
        <AdminDrawer
          open={view === 'admin'}
          label="Administrer dokumenter"
          onOpen={() => { setSidebarOpen(false); setAnalysesOpen(false); setView('admin') }}
          onClose={leaveAdmin}>
          <AdminView
            server={server}
            indexName={selectedIndex}
            indexes={indexes}
            onSelectIndex={(name) => {
              selectedIndexRef.current = name
              setSelectedIndex(name)
              setQueryType('free')
            }}
            onBackToSearch={leaveAdmin}
            onPendingChange={setAdminPending}
            onBusyChange={setAdminBusy}
            registerRollback={registerRollback}
            onIndexCreated={(name) => {
              setIndexes(prev => prev.includes(name) ? prev : [...prev, name].sort())
              selectedIndexRef.current = name
              setSelectedIndex(name)
              // A fresh index always defaults to "Fri analyse" — the only type
              // guaranteed to apply before any per-index types are pinned.
              setQueryType('free')
              // Pick up the analysetyper just pinned to the new index.
              refreshIndexQueryTypes()
            }}
            onIndexDeleted={(name) => {
              const next = indexes.filter(n => n !== name)
              setIndexes(next)
              // Fall back to whatever bank is left, or none at all.
              const fallback = next[0] || ''
              selectedIndexRef.current = fallback
              setSelectedIndex(fallback)
              setQueryType('free')
              setResults([])
              refreshIndexQueryTypes()
            }}
          />
        </AdminDrawer>

        <AdminDrawer
          open={analysesOpen}
          label="Administrer analysemaler"
          onOpen={() => { setSidebarOpen(false); leaveAdmin(); setAnalysesOpen(true) }}
          onClose={() => setAnalysesOpen(false)}>
          <AnalysisAdmin
            server={server}
            indexes={indexes}
            onBackToSearch={() => setAnalysesOpen(false)}
            onChanged={async () => { await refreshQueryTypes(); await refreshIndexQueryTypes() }}
          />
        </AdminDrawer>
        <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1.75rem 1.5rem 3rem' }}>

        {/* Index-load readiness banner — querying is blocked until ready */}
        {health.state !== 'ready' && (
          <div style={{
            ...card, padding: '0.9rem 1.25rem', marginBottom: 16,
            border: `1px solid ${health.state === 'error' ? C.danger : C.borderHi}`,
            background: health.state === 'error' ? C.dangerBg : C.accentBg,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4,
              color: health.state === 'error' ? C.danger : C.text }}>
              {health.state === 'error' ? 'Serveren er ikke klar' : 'Laster inn dokumentbanker…'}
            </div>
            <div style={{ fontSize: 13, color: C.textMute }}>
              {health.message || (health.state === 'error'
                ? 'Kunne ikke laste alle dokumentbankene.'
                : 'Venter på at alle dokumentbanker er lastet inn før analyse kan kjøres.')}
            </div>
            {health.expected.length > 0 && (
              <div style={{ fontSize: 12, color: C.textFaint, marginTop: 6 }}>
                {health.loaded.length}/{health.expected.length} dokumentbanker lastet
                {Object.keys(health.failed || {}).length > 0 &&
                  ` · feilet: ${Object.keys(health.failed).join(', ')}`}
              </div>
            )}
          </div>
        )}
        {/* Analysetype */}
        <div style={{ marginBottom: 16, ...lockedWhile(loading) }}>
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
                    background: QUERY_TYPE_TINT[qt.key] || C.accentBg,
                    border: `1px solid ${C.border}`,
                  }} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? C.accent : C.text, marginBottom: 3 }}>{qt.label}</div>
                  <div style={{ fontSize: 12, color: C.textMute, lineHeight: 1.4 }}>{qt.description}</div>
                </button>
              )
            })}
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeAggregate} onChange={e => setIncludeAggregate(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ fontSize: 13, color: C.text }}>Slå sammen funn til én liste på tvers av dokumentene</span>
              <span style={{ display: 'block', fontSize: 12, color: C.textMute, lineHeight: 1.5 }}>
                Funn som går igjen i flere dokumenter slås sammen til en samlet liste.
                Uten dette får du kun analysen av hvert dokument for seg — det går raskere.
              </span>
            </span>
          </label>
        </div>

        {/* Search input — large, prominent */}
        <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: 14 }}>
          <label htmlFor="analysis-question" style={{ ...metaLabel, display: 'block', marginBottom: 6, ...lockedWhile(loading) }}>
            Spørsmål til dokumentene
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, position: 'relative', display: 'flex', ...lockedWhile(loading) }}>
              <span aria-hidden="true" style={{
                position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                fontSize: 14, color: C.textFaint, pointerEvents: 'none', lineHeight: 1,
              }}>✎</span>
              <input
                id="analysis-question"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && runQuery()}
                placeholder={placeholder}
                style={{
                  flex: 1, padding: '12px 14px 12px 36px', borderRadius: 10,
                  border: `1.5px solid ${C.borderHi}`, background: C.surface,
                  fontSize: 16, outline: 'none', fontFamily: 'inherit', color: C.text,
                  boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.04)',
                  transition: 'border-color .12s, box-shadow .12s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = C.accent
                  e.target.style.boxShadow = `0 0 0 3px ${C.accentSoft}`
                }}
                onBlur={e => {
                  e.target.style.borderColor = C.borderHi
                  e.target.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.04)'
                }}
              />
            </div>
            <button onClick={() => runQuery()} disabled={loading || health.state !== 'ready'} style={{
              padding: '12px 24px', borderRadius: 10, border: 'none',
              background: loading || health.state !== 'ready' ? '#93C5FD' : C.accent,
              color: '#fff', cursor: loading || health.state !== 'ready' ? 'not-allowed' : 'pointer',
              fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'inherit',
              minWidth: 110,
            }}>
              {loading ? <LoadingDots /> : 'Analyser'}
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
          <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap', ...lockedWhile(loading) }}>
            <SectionToggle open={filtersOpen} onToggle={() => setFiltersOpen(p => !p)} label="Filtre" badge={activeCount} />
            <SectionToggle open={advancedOpen} onToggle={() => setAdvancedOpen(p => !p)} label="Analysedybde" />
            <SectionToggle open={promptsOpen} onToggle={() => setPromptsOpen(p => !p)} label="Se instruksjonene" />
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

          {/* Analysedybde drawer */}
          {advancedOpen && (
            <div style={{ marginTop: 14, padding: '14px 16px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
                {queryType === 'personas' && (
                  <ParamSlider label="Antall personas" min={1} max={8} step={1} value={nPersonas} onChange={setNPersonas} format={v => v} />
                )}
                <ParamSlider label="Chunks per doc" min={1} max={16} step={1} value={chunksPerDoc} onChange={setChunksPerDoc} format={v => v} info={PARAM_INFO.chunks_per_doc} />
              </div>
            </div>
          )}

          {/* Instructions drawer — sits below, as its own thing */}
          {promptsOpen && (
            <div style={{ marginTop: 14, padding: '14px 16px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <PromptsViewer queryType={queryType} defs={queryTypeDefs} />
            </div>
          )}
        </div>

        {/* Results */}
        {results.length === 0 && !loading && (
          <EmptyState indexName={selectedIndex} onPick={q => runQuery(q)} />
        )}
        {results.map((data, i) =>
          data._type === 'aggregate'
            ? <AggregateResultCard key={i} data={data} />
            : <QueryResultCard key={i} data={data} />
        )}

      </div>
        </div>

      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={closeSettings}
        server={server}
        onServerChange={setServer}
        themeName={themeName}
        onThemeChange={setThemeName}
      />
    </div>
  )
}
