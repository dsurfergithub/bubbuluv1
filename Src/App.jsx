import { useState, useEffect, useRef, useMemo } from ‘react’

// ─── Config ───────────────────────────────────────────────────────────────────
const GROQ_KEY    = ‘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’
const GROQ_MODEL  = ‘llama3-8b-8192’
const STORAGE_KEY = ‘bubbulu_v2’
const PRESS_MS    = 1500

// ─── Palette ──────────────────────────────────────────────────────────────────
const COLORS = {
blue:   { fill: ‘rgba(99,179,237,0.15)’,  border: ‘rgba(99,179,237,0.7)’,  glow: ‘#63b3ed’, label: ‘Azul’     },
yellow: { fill: ‘rgba(251,191,36,0.15)’,  border: ‘rgba(251,191,36,0.7)’,  glow: ‘#fbbf24’, label: ‘Amarillo’ },
red:    { fill: ‘rgba(248,113,113,0.15)’, border: ‘rgba(248,113,113,0.7)’, glow: ‘#f87171’, label: ‘Rojo’     },
green:  { fill: ‘rgba(52,211,153,0.15)’,  border: ‘rgba(52,211,153,0.7)’,  glow: ‘#34d399’, label: ‘Verde’    },
}

const MOODS = [
{ id: ‘calm’,    emoji: ‘🪴’, label: ‘Calmado’           },
{ id: ‘future’,  emoji: ‘🌳’, label: ‘Mirando al futuro’ },
{ id: ‘present’, emoji: ‘🪨’, label: ‘Presente’          },
{ id: ‘worried’, emoji: ‘🌤️’, label: ‘Algo preocupado’  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid        = () => Math.random().toString(36).slice(2, 9)
const fmtDate    = iso => new Date(iso).toLocaleDateString(‘es-ES’, { day: ‘numeric’, month: ‘short’ })
const daysSince  = iso => Math.floor((Date.now() - new Date(iso)) / 86400000)
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000)
const persist    = arr => localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
const restore    = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || ‘[]’) } catch { return [] } }

// ─── Groq ─────────────────────────────────────────────────────────────────────
async function callGroq(system, user) {
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), 10000)
try {
const res = await fetch(‘https://api.groq.com/openai/v1/chat/completions’, {
method: ‘POST’,
signal: ctrl.signal,
headers: { ‘Content-Type’: ‘application/json’, ‘Authorization’: `Bearer ${GROQ_KEY}` },
body: JSON.stringify({
model: GROQ_MODEL,
messages: [{ role: ‘system’, content: system }, { role: ‘user’, content: user }],
temperature: 0.5,
max_tokens: 512,
}),
})
clearTimeout(timer)
if (res.status === 429) throw new Error(‘RATE_LIMIT’)
if (!res.ok)            throw new Error(‘API_ERROR’)
const data = await res.json()
const raw  = data.choices?.[0]?.message?.content || ‘{}’
return JSON.parse(raw.replace(/`json|`/g, ‘’).trim())
} catch (e) {
clearTimeout(timer)
if (e.name === ‘AbortError’) throw new Error(‘TIMEOUT’)
throw e
}
}

function errMsg(e) {
if (e.message === ‘RATE_LIMIT’) return ‘Límite alcanzado. Espera un momento e inténtalo de nuevo.’
if (e.message === ‘TIMEOUT’)    return ‘La IA tardó demasiado. Comprueba tu conexión.’
return ‘Error al conectar con la IA. Inténtalo de nuevo.’
}

// ─── Physics ──────────────────────────────────────────────────────────────────
function bSize(text) {
const l = text.length
if (l < 30) return 88; if (l < 70) return 112
if (l < 120) return 136; return 158
}

function spawn(t, W, H) {
const size = bSize(t.texto), m = size / 2 + 12
return {
id: t.id, color: t.color, mood: t.mood, texto: t.texto,
fecha: t.fecha, nodos: t.nodos,
x: m + Math.random() * Math.max(20, W - m * 2),
y: m + Math.random() * Math.max(20, H - m * 2),
vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
phase: Math.random() * Math.PI * 2, spd: 0.003 + Math.random() * 0.003, size,
}
}

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
// Data
const [thoughts, setThoughts] = useState(restore)
const save = fn => setThoughts(prev => { const next = fn(prev); persist(next); return next })

// Views
const [view, setView] = useState(‘canvas’)

// Canvas
const [bubbles, setBubbles]           = useState([])
const [exploding, setExploding]       = useState(null)
const [particles, setParticles]       = useState([])
const [pressing, setPressing]         = useState(null)
const [pressProgress, setPressProgress] = useState(0)
const canvasRef  = useRef(null)
const pressRef   = useRef(null)
const pressStart = useRef(null)
const [cW, setCW] = useState(390)
const [cH, setCH] = useState(700)

// Input
const [showInput, setShowInput]   = useState(false)
const [draftText, setDraftText]   = useState(’’)
const [draftColor, setDraftColor] = useState(‘blue’)
const [draftMood, setDraftMood]   = useState(‘calm’)
const [listening, setListening]   = useState(false)
const inputRef = useRef(null)
const recogRef = useRef(null)

// Detail
const [selected, setSelected]   = useState(null)
const [aiLoading, setAiLoading] = useState(false)
const [aiError, setAiError]     = useState(null)

// Stats
const [statsData, setStatsData]       = useState(null)
const [statsLoading, setStatsLoading] = useState(false)
const [statsError, setStatsError]     = useState(null)

// Derived
const active     = useMemo(() => thoughts.filter(t => !t.completado && !t.eliminado), [thoughts])
const completed  = useMemo(() => thoughts.filter(t => t.completado), [thoughts])
const eliminated = useMemo(() => thoughts.filter(t => t.eliminado), [thoughts])
const dynamicH   = useMemo(() => {
const cols   = cW < 480 ? 3 : 4
const needed = Math.ceil(active.length / cols) * 210
return Math.max(cH || 600, needed + 80)
}, [active.length, cH, cW])

// Measure
useEffect(() => {
const m = () => { if (!canvasRef.current) return; setCW(canvasRef.current.clientWidth); setCH(canvasRef.current.clientHeight) }
m()
const ro = new ResizeObserver(m)
if (canvasRef.current) ro.observe(canvasRef.current)
return () => ro.disconnect()
}, [])

// Sync bubbles
useEffect(() => {
setBubbles(prev => {
const eIds = new Set(prev.map(b => b.id))
const aIds = new Set(active.map(t => t.id))
const kept = prev.filter(b => aIds.has(b.id)).map(b => {
const t = active.find(t => t.id === b.id)
return t ? { …b, color: t.color, mood: t.mood, texto: t.texto, nodos: t.nodos } : b
})
const added = active.filter(t => !eIds.has(t.id)).map(t => spawn(t, cW || 390, dynamicH))
return […kept, …added]
})
}, [active, dynamicH, cW])

// Physics
useEffect(() => {
if (view !== ‘canvas’) return
let raf
const tick = () => {
const W = canvasRef.current?.clientWidth || 390
setBubbles(prev => prev.map(b => {
if (b.id === exploding) return b
let { x, y, vx, vy, phase, spd, size } = b
phase += spd
x += vx + Math.cos(phase * 0.7) * 0.18
y += vy + Math.sin(phase) * 0.35
const r = size / 2
if (x - r < 0)       { x = r;         vx =  Math.abs(vx) }
if (x + r > W)       { x = W - r;      vx = -Math.abs(vx) }
if (y - r < 0)       { y = r;          vy =  Math.abs(vy) }
if (y + r > dynamicH) { y = dynamicH - r; vy = -Math.abs(vy) }
return { …b, x, y, vx, vy, phase }
}))
raf = requestAnimationFrame(tick)
}
raf = requestAnimationFrame(tick)
return () => cancelAnimationFrame(raf)
}, [view, exploding, dynamicH])

// Particles
useEffect(() => {
if (!particles.length) return
let raf
const tick = () => {
setParticles(prev => {
const next = prev.map(p => ({ …p, x: p.x + Math.cos(p.angle) * p.spd, y: p.y + Math.sin(p.angle) * p.spd, life: p.life - 0.04, spd: p.spd * 0.92 })).filter(p => p.life > 0)
if (next.length) raf = requestAnimationFrame(tick)
return next
})
}
raf = requestAnimationFrame(tick)
return () => cancelAnimationFrame(raf)
}, [particles.length > 0])

// Press
const startPress = (id, e) => {
e.preventDefault()
if (selected) return
pressStart.current = Date.now()
setPressing(id); setPressProgress(0)
pressRef.current = setInterval(() => {
const p = Math.min((Date.now() - pressStart.current) / PRESS_MS, 1)
setPressProgress(p)
if (p >= 1) { clearInterval(pressRef.current); pop(id) }
}, 16)
}
const endPress = (id) => {
if (pressProgress < 0.2) openDetail(id)
clearInterval(pressRef.current); setPressing(null); setPressProgress(0)
}
const cancelPress = () => { clearInterval(pressRef.current); setPressing(null); setPressProgress(0) }

const pop = (id) => {
clearInterval(pressRef.current); setPressing(null); setPressProgress(0); setExploding(id)
setBubbles(cur => {
const b = cur.find(b => b.id === id)
if (b) {
const col = COLORS[b.color] || COLORS.blue
setParticles(Array.from({ length: 24 }, (_, i) => ({ id: i, x: b.x, y: b.y, angle: (i / 24) * Math.PI * 2 + Math.random() * 0.2, spd: 2 + Math.random() * 5, size: 3 + Math.random() * 8, color: col.glow, life: 1 })))
}
return cur
})
setTimeout(() => {
save(prev => prev.map(t => t.id === id ? { …t, completado: true, completadoEn: new Date().toISOString() } : t))
setBubbles(prev => prev.filter(b => b.id !== id))
setExploding(null); setParticles([])
}, 700)
}

// CRUD
const addThought = () => {
if (!draftText.trim()) return
save(prev => […prev, { id: uid(), texto: draftText.trim(), fecha: new Date().toISOString(), color: draftColor, mood: draftMood, completado: false, eliminado: false, nodos: [] }])
setDraftText(’’); setDraftColor(‘blue’); setDraftMood(‘calm’); setShowInput(false)
}

const deleteThought = (id) => {
save(prev => prev.map(t => t.id === id ? { …t, eliminado: true, eliminadoEn: new Date().toISOString() } : t))
setBubbles(prev => prev.filter(b => b.id !== id)); setSelected(null)
}

const openDetail = (id) => { const t = thoughts.find(t => t.id === id); if (t) { setSelected(t); setAiError(null) } }

const toggleNodo = (nodoId) => {
save(prev => prev.map(t => t.id !== selected.id ? t : { …t, nodos: t.nodos.map(n => n.id === nodoId ? { …n, completado: !n.completado } : n) }))
setSelected(prev => ({ …prev, nodos: prev.nodos.map(n => n.id === nodoId ? { …n, completado: !n.completado } : n) }))
}

// AI
const decomposeAI = async () => {
if (!selected || aiLoading) return
setAiLoading(true); setAiError(null)
try {
const mood = MOODS.find(m => m.id === selected.mood)?.label || ‘’
const res = await callGroq(
‘Descompones pensamientos en pasos accionables. Responde SOLO JSON válido sin markdown.’,
`Pensamiento: "${selected.texto}"\nMood: ${mood}\nFormato: {"pasos":["paso 1","paso 2"]}\nMáximo 5 pasos, breves y concretos en español.`
)
const nodos = (res.pasos || []).map(p => ({ id: uid(), texto: p, completado: false }))
if (!nodos.length) throw new Error(‘EMPTY’)
save(prev => prev.map(t => t.id === selected.id ? { …t, nodos } : t))
setSelected(prev => ({ …prev, nodos }))
} catch (e) {
setAiError(e.message === ‘EMPTY’ ? ‘La IA no generó pasos. Inténtalo de nuevo.’ : errMsg(e))
}
setAiLoading(false)
}

const reviewDormant = async () => {
if (!selected || aiLoading) return
setAiLoading(true); setAiError(null)
try {
const res = await callGroq(
‘Eres empático y conciso. Responde SOLO JSON válido.’,
`Pensamiento de hace ${daysSince(selected.fecha)} días: "${selected.texto}"\nFormato: {"mensaje":"una frase breve en español preguntando si sigue siendo relevante"}`
)
setSelected(prev => ({ …prev, dormantMsg: res.mensaje || ‘¿Sigue siendo relevante este pensamiento?’ }))
} catch (e) { setAiError(errMsg(e)) }
setAiLoading(false)
}

const analyzeStats = async () => {
if (!completed.length) { setStatsData({ noData: true }); return }
setStatsLoading(true); setStatsError(null)
try {
const lista = completed.map(t => ({ texto: t.texto, mood: t.mood, dias: t.completadoEn ? daysBetween(t.fecha, t.completadoEn) : 0 }))
const res = await callGroq(
‘Clasificas pensamientos en categorías temáticas. Responde SOLO JSON válido.’,
`Pensamientos: ${JSON.stringify(lista)}\nFormato: {"categorias":[{"nombre":"...","emoji":"🎯","pensamientos":[{"texto":"...","dias":0,"mood":"..."}]}]}\nMáximo 4 categorías.`
)
setStatsData(res)
} catch (e) { setStatsError(errMsg(e)) }
setStatsLoading(false)
}

const toggleVoice = () => {
const SR = window.SpeechRecognition || window.webkitSpeechRecognition
if (!SR) { alert(‘Tu navegador no soporta voz’); return }
if (listening) { recogRef.current?.stop(); setListening(false); return }
const r = new SR(); r.lang = ‘es-ES’; r.continuous = false; r.interimResults = false
r.onresult = e => setDraftText(p => (p + ’ ’ + e.results[0][0].transcript).trim())
r.onend = () => setListening(false)
recogRef.current = r; r.start(); setListening(true)
}

const isDormant = t => daysSince(t.fecha) >= 7
const isReady   = t => t.nodos?.length > 0 && t.nodos.every(n => n.completado)

// ═══════════════════════════════════════════════════════════════════════════
return (
<div style={{ width: ‘100%’, height: ‘100dvh’, background: ‘#05091a’, display: ‘flex’, flexDirection: ‘column’, overflow: ‘hidden’, fontFamily: “‘Nunito’, sans-serif” }}>
<style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap'); *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;} input,textarea{user-select:text!important;-webkit-user-select:text!important;font-size:16px;} textarea{resize:none;outline:none;border:none;background:transparent;font-family:inherit;} textarea::placeholder{color:rgba(255,255,255,0.22);} button{font-family:inherit;cursor:pointer;border:none;outline:none;} ::-webkit-scrollbar{width:2px;}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;} @keyframes popIn{from{opacity:0;transform:scale(0.2);}to{opacity:1;transform:scale(1);}} @keyframes pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.034);}} @keyframes slideUp{from{transform:translateY(100%);opacity:0;}to{transform:translateY(0);opacity:1;}} @keyframes fadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}`}</style>

```
  {/* Header */}
  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'max(env(safe-area-inset-top),14px) 18px 10px', background: 'linear-gradient(to bottom,#05091a 65%,transparent)', zIndex: 20 }}>
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>Bubbulú</div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', marginTop: 1 }}>
        {active.length} flotando · {completed.length} cumplidos · {eliminated.length} eliminados
      </div>
    </div>
    <button onClick={() => { setView(v => v === 'canvas' ? 'stats' : 'canvas'); setStatsData(null); setStatsError(null) }}
      style={{ background: 'rgba(255,255,255,0.07)', border: `1px solid ${view === 'stats' ? 'rgba(99,179,237,0.5)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 20, padding: '7px 15px', color: view === 'stats' ? '#63b3ed' : 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: 700 }}>
      {view === 'stats' ? '🫧 Burbujas' : '📊 Stats'}
    </button>
  </div>

  {/* ══ CANVAS ══ */}
  {view === 'canvas' && (
    <div ref={canvasRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ position: 'relative', width: '100%', height: dynamicH }}>

        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {Array.from({ length: 60 }, (_, i) => (
            <circle key={i} cx={`${(i * 137.5) % 100}%`} cy={`${(i * 97.3) % 100}%`} r={i % 7 === 0 ? 1.2 : 0.6} fill={`rgba(255,255,255,${0.04 + (i % 4) * 0.05})`} />
          ))}
        </svg>

        {bubbles.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
            <div style={{ fontSize: 56, opacity: 0.08 }}>🫧</div>
            <div style={{ color: 'rgba(255,255,255,0.16)', fontSize: 14, fontWeight: 700 }}>Sin pensamientos flotando</div>
            <div style={{ color: 'rgba(255,255,255,0.09)', fontSize: 12 }}>Pulsa + para soltar uno</div>
          </div>
        )}

        {bubbles.map(b => {
          const col     = COLORS[b.color] || COLORS.blue
          const thought = active.find(t => t.id === b.id)
          const dormant = thought && isDormant(thought)
          const ready   = thought && isReady(thought)
          const isExp   = exploding === b.id
          const isPress = pressing === b.id

          return (
            <div key={b.id}
              onMouseDown={e => startPress(b.id, e)} onMouseUp={() => endPress(b.id)} onMouseLeave={cancelPress}
              onTouchStart={e => startPress(b.id, e)} onTouchEnd={() => endPress(b.id)}
              style={{
                position: 'absolute', left: b.x - b.size / 2, top: b.y - b.size / 2,
                width: b.size, height: b.size, borderRadius: '50%',
                background: col.fill, border: `1.5px solid ${col.border}`,
                boxShadow: `0 0 ${isPress ? 30 : ready ? 22 : 12}px ${col.glow}${isPress ? '88' : ready ? '66' : '33'}, inset 0 1px 0 rgba(255,255,255,0.14)`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: 10, textAlign: 'center', cursor: 'pointer',
                transform: `scale(${isExp ? 1.5 : isPress ? 1 + pressProgress * 0.3 : 1})`,
                opacity: isExp ? 0 : dormant ? 0.38 : 1,
                transition: isExp ? 'transform 0.35s ease-out,opacity 0.3s ease-out' : 'transform 0.1s',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                animation: ready && !isPress ? 'pulse 2.5s ease-in-out infinite' : (!isExp ? 'popIn 0.4s cubic-bezier(.34,1.56,.64,1) both' : 'none'),
                zIndex: isPress ? 5 : 2,
              }}>
              {isPress && (
                <svg style={{ position: 'absolute', inset: -4, width: b.size + 8, height: b.size + 8, transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
                  <circle cx={(b.size + 8) / 2} cy={(b.size + 8) / 2} r={(b.size + 8) / 2 - 4}
                    fill="none" stroke={col.glow} strokeWidth={3}
                    strokeDasharray={Math.PI * (b.size + 8)} strokeDashoffset={Math.PI * (b.size + 8) * (1 - pressProgress)} strokeLinecap="round" />
                </svg>
              )}
              {dormant && !isPress && <div style={{ position: 'absolute', top: 6, right: 7, fontSize: 9 }}>💤</div>}
              {ready && !dormant && !isPress && <div style={{ position: 'absolute', top: 5, right: 6, fontSize: 9 }}>✨</div>}
              <div style={{ fontSize: b.size > 130 ? 11 : 10, color: 'rgba(255,255,255,0.92)', fontWeight: 600, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: b.size > 130 ? 4 : 3, WebkitBoxOrient: 'vertical' }}>{b.texto}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.26)', marginTop: 4 }}>{fmtDate(b.fecha)}</div>
              {b.nodos?.length > 0 && <div style={{ fontSize: 9, color: col.glow, marginTop: 2, fontWeight: 700 }}>{b.nodos.filter(n => n.completado).length}/{b.nodos.length}</div>}
            </div>
          )
        })}

        {particles.map(p => (
          <div key={p.id} style={{ position: 'absolute', left: p.x - p.size / 2, top: p.y - p.size / 2, width: p.size, height: p.size, borderRadius: '50%', background: p.color, opacity: p.life, boxShadow: `0 0 8px ${p.color}`, pointerEvents: 'none', zIndex: 30 }} />
        ))}
      </div>

      {bubbles.length > 0 && (
        <div style={{ position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom,0px) + 82px)', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', zIndex: 5 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.1)' }}>Mantén para explotar · Toca para ver detalle</div>
        </div>
      )}
    </div>
  )}

  {/* ══ STATS ══ */}
  {view === 'stats' && (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 32px)', WebkitOverflowScrolling: 'touch', animation: 'fadeIn 0.25s ease both' }}>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[{ label: 'Flotando', val: active.length, color: '#63b3ed' }, { label: 'Cumplidos', val: completed.length, color: '#34d399' }, { label: 'Eliminados', val: eliminated.length, color: '#f87171' }].map(s => (
          <div key={s.label} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: `1px solid ${s.color}22`, borderRadius: 14, padding: '12px 6px', textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.32)', fontWeight: 600, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Estado de ánimo</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {MOODS.map(m => {
            const count = thoughts.filter(t => t.mood === m.id).length
            return (
              <div key={m.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 18 }}>{m.emoji}</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{count}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)' }}>{m.label}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Análisis IA</div>

      {!statsData && !statsLoading && (
        <button onClick={analyzeStats} style={{ width: '100%', padding: '13px 0', borderRadius: 12, background: 'linear-gradient(135deg,rgba(99,179,237,0.14),rgba(154,117,234,0.14))', border: '1px solid rgba(99,179,237,0.28)', color: '#63b3ed', fontSize: 13, fontWeight: 700, marginBottom: 16 }}>
          ✨ Analizar pensamientos con IA
        </button>
      )}
      {statsLoading && <div style={{ color: 'rgba(255,255,255,0.22)', fontSize: 13, textAlign: 'center', padding: '32px 0' }}>✨ Analizando...</div>}
      {statsError && <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 12, padding: '12px 14px', color: '#f87171', fontSize: 12, marginBottom: 12 }}>⚠️ {statsError}</div>}
      {statsData?.noData && <div style={{ color: 'rgba(255,255,255,0.16)', fontSize: 13, textAlign: 'center', padding: 24 }}>Completa algún pensamiento para analizar.</div>}

      {statsData?.categorias?.map((cat, i) => (
        <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '13px 14px', marginBottom: 10, animation: `fadeIn 0.3s ease ${i * 0.06}s both` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 20 }}>{cat.emoji}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{cat.nombre}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.22)' }}>{cat.pensamientos?.length}</span>
          </div>
          {cat.pensamientos?.map((p, j) => (
            <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderTop: j > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
              <span style={{ fontSize: 12, marginTop: 1, flexShrink: 0 }}>{MOODS.find(m => m.id === p.mood)?.emoji || '💭'}</span>
              <div style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>{p.texto}</div>
              {p.dias != null && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', fontWeight: 700, whiteSpace: 'nowrap' }}>{p.dias === 0 ? 'mismo día' : `${p.dias}d`}</div>}
            </div>
          ))}
        </div>
      ))}

      {statsData && !statsLoading && (
        <button onClick={() => { setStatsData(null); setStatsError(null) }} style={{ width: '100%', padding: '10px 0', borderRadius: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.22)', fontSize: 11, fontWeight: 600, marginTop: 4 }}>
          ↺ Reclasificar
        </button>
      )}
    </div>
  )}

  {/* FAB */}
  {view === 'canvas' && !showInput && !selected && (
    <button onClick={() => { setShowInput(true); setTimeout(() => inputRef.current?.focus(), 120) }}
      style={{ position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom,0px) + 22px)', right: 20, width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,#63b3ed,#9a75ea)', color: '#fff', fontSize: 28, boxShadow: '0 4px 20px rgba(99,179,237,0.38)', zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.15s' }}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(0.9)'} onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}>
      +
    </button>
  )}

  {/* Input overlay */}
  {showInput && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,9,26,0.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}
      onClick={e => e.target === e.currentTarget && setShowInput(false)}>
      <div style={{ width: '100%', maxWidth: 520, background: 'rgba(12,18,38,0.99)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '24px 24px 0 0', padding: '22px 20px', paddingBottom: 'max(env(safe-area-inset-bottom),28px)', animation: 'slideUp 0.28s cubic-bezier(.34,1.1,.64,1) both' }}>

        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>Nuevo pensamiento</div>

        <div style={{ position: 'relative' }}>
          <textarea ref={inputRef} value={draftText} onChange={e => setDraftText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), addThought())}
            placeholder="¿Qué está flotando en tu mente?" rows={3}
            style={{ width: '100%', color: '#fff', lineHeight: 1.5, fontWeight: 400, paddingRight: 36 }} />
          <button onClick={toggleVoice} style={{ position: 'absolute', top: 0, right: 0, background: 'none', fontSize: 20, opacity: listening ? 1 : 0.28, color: listening ? '#f87171' : '#fff', padding: 4 }}>🎙</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Color</span>
          {Object.entries(COLORS).map(([id, col]) => (
            <button key={id} onClick={() => setDraftColor(id)} title={col.label}
              style={{ width: 30, height: 30, borderRadius: '50%', background: col.fill, border: `2.5px solid ${draftColor === id ? col.glow : 'rgba(255,255,255,0.1)'}`, boxShadow: draftColor === id ? `0 0 12px ${col.glow}66` : 'none', transition: 'all 0.15s', flexShrink: 0 }} />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Mood</span>
          {MOODS.map(m => (
            <button key={m.id} onClick={() => setDraftMood(m.id)} title={m.label}
              style={{ width: 40, height: 40, borderRadius: 10, fontSize: 18, background: draftMood === m.id ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)', border: `1.5px solid ${draftMood === m.id ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.07)'}`, transition: 'all 0.15s' }}>
              {m.emoji}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={() => setShowInput(false)} style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.42)', fontSize: 14, fontWeight: 600 }}>Cancelar</button>
          <button onClick={addThought} style={{ flex: 2, padding: '13px 0', borderRadius: 12, background: 'linear-gradient(135deg,#63b3ed,#9a75ea)', color: '#fff', fontSize: 14, fontWeight: 700, opacity: draftText.trim() ? 1 : 0.28, transition: 'opacity 0.15s' }}>
            Soltar burbuja 🫧
          </button>
        </div>
      </div>
    </div>
  )}

  {/* Detail panel */}
  {selected && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,9,26,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 60 }}>
      <div style={{ width: '100%', maxWidth: 520, background: 'rgba(12,18,38,0.99)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '24px 24px 0 0', padding: '20px 20px', paddingBottom: 'max(env(safe-area-inset-bottom),34px)', maxHeight: '84dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', animation: 'slideUp 0.28s cubic-bezier(.34,1.1,.64,1) both' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 18 }}>{MOODS.find(m => m.id === selected.mood)?.emoji}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
              {MOODS.find(m => m.id === selected.mood)?.label} · {fmtDate(selected.fecha)}
            </span>
            {isDormant(selected) && <span style={{ fontSize: 10, color: '#fbbf24', fontWeight: 700 }}>· 💤 Dormida</span>}
          </div>
          <button onClick={() => setSelected(null)} style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.42)', width: 32, height: 32, borderRadius: '50%', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, lineHeight: 1.4, marginBottom: 20 }}>{selected.texto}</div>

        {isDormant(selected) && (
          <div style={{ marginBottom: 14 }}>
            {selected.dormantMsg
              ? <div style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.45 }}>💡 {selected.dormantMsg}</div>
              : <button onClick={reviewDormant} disabled={aiLoading} style={{ width: '100%', padding: '11px 0', borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)', color: '#fbbf24', fontSize: 12, fontWeight: 700, opacity: aiLoading ? 0.5 : 1 }}>
                  {aiLoading ? 'Revisando...' : '💤 Revisar con IA — lleva tiempo flotando'}
                </button>
            }
          </div>
        )}

        {selected.nodos.length === 0 && (
          <button onClick={decomposeAI} disabled={aiLoading}
            style={{ width: '100%', padding: '13px 0', borderRadius: 12, background: aiLoading ? 'rgba(255,255,255,0.03)' : 'linear-gradient(135deg,rgba(99,179,237,0.14),rgba(154,117,234,0.14))', border: '1px solid rgba(99,179,237,0.28)', color: aiLoading ? 'rgba(255,255,255,0.18)' : '#63b3ed', fontSize: 13, fontWeight: 700, marginBottom: 14, transition: 'all 0.2s' }}>
            {aiLoading ? '✨ Pensando...' : '✨ Descomponer con IA'}
          </button>
        )}

        {aiError && (
          <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 12, padding: '11px 14px', marginBottom: 14, fontSize: 12, color: '#f87171', lineHeight: 1.4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <span>⚠️ {aiError}</span>
            <button onClick={() => setAiError(null)} style={{ background: 'none', color: '#f87171', fontSize: 14, opacity: 0.6, padding: 0, flexShrink: 0 }}>×</button>
          </div>
        )}

        {selected.nodos.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
              {selected.nodos.filter(n => n.completado).length} / {selected.nodos.length} pasos
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {selected.nodos.map(n => (
                <div key={n.id} onClick={() => toggleNodo(n.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 13px', borderRadius: 12, background: n.completado ? 'rgba(52,211,153,0.07)' : 'rgba(255,255,255,0.04)', border: `1px solid ${n.completado ? 'rgba(52,211,153,0.22)' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', minHeight: 46, transition: 'all 0.2s' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, border: `2px solid ${n.completado ? '#34d399' : 'rgba(255,255,255,0.15)'}`, background: n.completado ? '#34d399' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                    {n.completado && <span style={{ fontSize: 11, color: '#05091a', fontWeight: 800 }}>✓</span>}
                  </div>
                  <div style={{ fontSize: 13, color: n.completado ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.85)', fontWeight: 500, lineHeight: 1.35, textDecoration: n.completado ? 'line-through' : 'none', transition: 'all 0.2s' }}>
                    {n.texto}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={decomposeAI} disabled={aiLoading} style={{ marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 600 }}>
              {aiLoading ? 'Regenerando...' : '↺ Regenerar pasos'}
            </button>
          </div>
        )}

        <button onClick={() => deleteThought(selected.id)} style={{ width: '100%', padding: '12px 0', borderRadius: 12, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.16)', color: '#f87171', fontSize: 13, fontWeight: 700 }}>
          🗑 Eliminar pensamiento
        </button>
      </div>
    </div>
  )}
</div>
```

)
}
