import { useState, useEffect, useRef, useCallback, useMemo } from ‘react’

const GROQ_KEY = ‘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’
const STORAGE_KEY = ‘bubbulu_v2’

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10) }
function fmtDate(iso) {
return new Date(iso).toLocaleDateString(‘es-ES’, { day: ‘numeric’, month: ‘short’ })
}
function daysBetween(a, b) {
return Math.floor((new Date(b) - new Date(a)) / 86400000)
}
function loadThoughts() {
try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || ‘[]’) } catch { return [] }
}
function saveThoughts(arr) { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)) }

// ─── Design tokens ────────────────────────────────────────────────────────────
const BUBBLE_PALETTE = [
{ id: ‘blue’,   fill: ‘rgba(99,179,237,0.18)’,  border: ‘rgba(99,179,237,0.75)’,  glow: ‘#63b3ed’ },
{ id: ‘violet’, fill: ‘rgba(154,117,234,0.18)’, border: ‘rgba(154,117,234,0.75)’, glow: ‘#9a75ea’ },
{ id: ‘teal’,   fill: ‘rgba(72,199,190,0.18)’,  border: ‘rgba(72,199,190,0.75)’,  glow: ‘#48c7be’ },
{ id: ‘rose’,   fill: ‘rgba(246,135,135,0.18)’, border: ‘rgba(246,135,135,0.75)’, glow: ‘#f68787’ },
]

const MOODS = [
{ id: ‘calm’,    emoji: ‘🪴’, label: ‘Calmado’ },
{ id: ‘future’,  emoji: ‘🌳’, label: ‘Mirando al futuro’ },
{ id: ‘present’, emoji: ‘🪨’, label: ‘Presente’ },
{ id: ‘worried’, emoji: ‘🌤️’, label: ‘Algo preocupado’ },
]

// ─── Physics helpers ──────────────────────────────────────────────────────────
function getBubbleSize(text) {
const l = text.length
if (l < 30) return 86
if (l < 70) return 110
if (l < 120) return 134
return 156
}

function colorFor(t) {
return BUBBLE_PALETTE.find(p => p.id === t.color) || BUBBLE_PALETTE[0]
}

function mkBubble(thought, W, H) {
const size = getBubbleSize(thought.texto)
const m = size / 2 + 14
return {
…thought,
x: m + Math.random() * Math.max(10, W - m * 2),
y: m + Math.random() * Math.max(10, H - m * 2),
vx: (Math.random() - 0.5) * 0.5,
vy: (Math.random() - 0.5) * 0.5,
phase: Math.random() * Math.PI * 2,
phaseSpeed: 0.003 + Math.random() * 0.004,
size,
}
}

// ─── Gemini ───────────────────────────────────────────────────────────────────
let groqLock = false

async function callGemini(prompt) {
if (groqLock) throw new Error(‘BUSY’)
groqLock = true
try {
const res = await fetch(
‘https://api.groq.com/openai/v1/chat/completions’,
{
method: ‘POST’,
headers: {
‘Content-Type’: ‘application/json’,
‘Authorization’: `Bearer ${GROQ_KEY}`,
},
body: JSON.stringify({
model: ‘llama-3.3-70b-versatile’,
messages: [{ role: ‘user’, content: prompt }],
temperature: 0.7,
max_tokens: 1024,
}),
}
)
if (res.status === 429) throw new Error(‘RATE_LIMIT’)
if (!res.ok) throw new Error(‘API_ERROR’)
const data = await res.json()
const raw = data.choices?.[0]?.message?.content || ‘{}’
return raw.replace(/`json|`/g, ‘’).trim()
} finally {
groqLock = false
}
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
const [thoughts, setThoughts]   = useState(loadThoughts)
const [bubbles, setBubbles]     = useState([])
const [view, setView]           = useState(‘canvas’)

// Input state
const [showInput, setShowInput]     = useState(false)
const [inputText, setInputText]     = useState(’’)
const [inputColor, setInputColor]   = useState(‘blue’)
const [inputMood, setInputMood]     = useState(‘calm’)
const [listening, setListening]     = useState(false)

// Detail / interaction
const [selected, setSelected]       = useState(null)
const [pressing, setPressing]       = useState(null)
const [pressProgress, setPressProgress] = useState(0)
const [exploding, setExploding]     = useState(null)
const [particles, setParticles]     = useState([])

// AI
const [aiLoading, setAiLoading]     = useState(false)
const [aiError, setAiError]         = useState(null)
const [statsData, setStatsData]     = useState(null)
const [statsLoading, setStatsLoading] = useState(false)

// Canvas measurement
const [canvasW, setCanvasW] = useState(390)
const [canvasH, setCanvasH] = useState(700)

const canvasRef  = useRef(null)
const pressRef   = useRef(null)
const pressStart = useRef(null)
const inputRef   = useRef(null)
const recogRef   = useRef(null)

// ── Persist ────────────────────────────────────────────────────────────────
useEffect(() => { saveThoughts(thoughts) }, [thoughts])

// ── Measure canvas ─────────────────────────────────────────────────────────
useEffect(() => {
const measure = () => {
if (!canvasRef.current) return
setCanvasW(canvasRef.current.clientWidth)
setCanvasH(canvasRef.current.clientHeight)
}
measure()
const ro = new ResizeObserver(measure)
if (canvasRef.current) ro.observe(canvasRef.current)
return () => ro.disconnect()
}, [])

// ── Dynamic canvas height (expands with many bubbles) ─────────────────────
const dynamicH = useMemo(() => {
const active = thoughts.filter(t => !t.eliminado && !t.completado).length
const base = canvasH || window.innerHeight - 80
const cols = canvasW < 480 ? 3 : 4
const needed = Math.ceil(active / cols) * 200
return Math.max(base, needed + 80)
}, [thoughts, canvasH, canvasW])

// ── Sync bubbles with thoughts ─────────────────────────────────────────────
useEffect(() => {
const W = canvasW || 390
const H = dynamicH
setBubbles(prev => {
const existIds = new Set(prev.map(b => b.id))
const active   = thoughts.filter(t => !t.completado && !t.eliminado)
const newOnes  = active
.filter(t => !existIds.has(t.id))
.map(t => mkBubble(t, W, H))
const activeIds = new Set(active.map(t => t.id))
const kept = prev
.filter(b => activeIds.has(b.id))
.map(b => {
const t = active.find(t => t.id === b.id)
return t ? { …b, nodos: t.nodos, texto: t.texto, color: t.color, mood: t.mood } : b
})
return […kept, …newOnes]
})
}, [thoughts, dynamicH, canvasW])

// ── Physics loop ───────────────────────────────────────────────────────────
useEffect(() => {
if (view !== ‘canvas’) return
let raf
const tick = () => {
const W = canvasRef.current?.clientWidth || 390
const H = dynamicH
setBubbles(prev => prev.map(b => {
if (b.id === exploding) return b
let { x, y, vx, vy, phase, phaseSpeed, size } = b
phase += phaseSpeed
x += vx + Math.cos(phase * 0.7) * 0.18
y += vy + Math.sin(phase) * 0.35
const r = size / 2
if (x - r < 0)  { x = r;     vx =  Math.abs(vx) }
if (x + r > W)  { x = W - r; vx = -Math.abs(vx) }
if (y - r < 0)  { y = r;     vy =  Math.abs(vy) }
if (y + r > H)  { y = H - r; vy = -Math.abs(vy) }
return { …b, x, y, vx, vy, phase }
}))
raf = requestAnimationFrame(tick)
}
raf = requestAnimationFrame(tick)
return () => cancelAnimationFrame(raf)
}, [view, exploding, dynamicH])

// ── Press-hold ─────────────────────────────────────────────────────────────
const startPress = useCallback((id, e) => {
e.preventDefault()
if (selected) return
pressStart.current = Date.now()
setPressing(id)
setPressProgress(0)
pressRef.current = setInterval(() => {
const p = Math.min((Date.now() - pressStart.current) / 1500, 1)
setPressProgress(p)
if (p >= 1) { clearInterval(pressRef.current); triggerBoom(id) }
}, 16)
}, [selected, bubbles])

const cancelPress = useCallback(() => {
clearInterval(pressRef.current)
setPressing(null)
setPressProgress(0)
}, [])

const triggerBoom = useCallback((id) => {
clearInterval(pressRef.current)
setPressing(null); setPressProgress(0); setExploding(id)
setBubbles(cur => {
const b = cur.find(b => b.id === id)
if (b) {
const col = colorFor(b)
setParticles(Array.from({ length: 22 }, (_, i) => ({
id: i, x: b.x, y: b.y,
angle: (i / 22) * Math.PI * 2 + Math.random() * 0.3,
speed: 2.5 + Math.random() * 5,
size:  4   + Math.random() * 7,
color: col.glow, life: 1,
})))
}
return cur
})
setTimeout(() => {
setThoughts(prev => prev.map(t =>
t.id === id ? { …t, completado: true, completadoEn: new Date().toISOString() } : t
))
setBubbles(prev => prev.filter(b => b.id !== id))
setExploding(null); setParticles([])
}, 680)
}, [])

// ── Particles ──────────────────────────────────────────────────────────────
useEffect(() => {
if (!particles.length) return
let raf
const tick = () => {
setParticles(prev => {
const next = prev.map(p => ({
…p,
x: p.x + Math.cos(p.angle) * p.speed,
y: p.y + Math.sin(p.angle) * p.speed,
life:  p.life  - 0.042,
speed: p.speed * 0.91,
})).filter(p => p.life > 0)
if (next.length) raf = requestAnimationFrame(tick)
return next
})
}
raf = requestAnimationFrame(tick)
return () => cancelAnimationFrame(raf)
}, [particles.length > 0])

// ── Add thought ────────────────────────────────────────────────────────────
const addThought = () => {
if (!inputText.trim()) return
const t = {
id: uid(), texto: inputText.trim(),
fecha: new Date().toISOString(),
color: inputColor, mood: inputMood,
completado: false, eliminado: false, nodos: [],
}
setThoughts(prev => […prev, t])
setInputText(’’); setShowInput(false)
setInputColor(‘blue’); setInputMood(‘calm’)
}

// ── Delete thought ─────────────────────────────────────────────────────────
const deleteThought = (id) => {
setThoughts(prev => prev.map(t =>
t.id === id ? { …t, eliminado: true, eliminadoEn: new Date().toISOString() } : t
))
setBubbles(prev => prev.filter(b => b.id !== id))
setSelected(null)
}

// ── AI: decompose ──────────────────────────────────────────────────────────
const decomposeAI = async () => {
if (!selected || aiLoading) return
setAiLoading(true)
setAiError(null)
try {
const moodLabel = MOODS.find(m => m.id === selected.mood)?.label || ‘’
const raw = await callGemini(
`Descompón este pensamiento en pasos accionables concretos en español.\n` +
`Pensamiento: "${selected.texto}"\n` +
`Estado de ánimo: ${moodLabel}\n` +
`Devuelve SOLO JSON sin markdown: {"pasos":["paso 1","paso 2"]}\n` +
`Máximo 6 pasos, mínimo 2. Concretos y accionables.`
)
const nodos = (JSON.parse(raw).pasos || []).map(p => ({ id: uid(), texto: p, completado: false }))
setThoughts(prev => prev.map(t => t.id === selected.id ? { …t, nodos } : t))
setSelected(prev => ({ …prev, nodos }))
} catch (e) {
if (e.message === ‘RATE_LIMIT’) setAiError(‘Límite de la IA alcanzado. Espera un momento e inténtalo de nuevo.’)
else if (e.message === ‘BUSY’) setAiError(‘Ya hay una petición en curso. Espera un momento.’)
else setAiError(‘Error al conectar con la IA.’)
}
setAiLoading(false)
}

// ── AI: dormant review ─────────────────────────────────────────────────────
const reviewDormant = async (id) => {
const t = thoughts.find(t => t.id === id)
if (!t || aiLoading) return
setAiLoading(true)
setAiError(null)
try {
const dias = daysBetween(t.fecha, new Date().toISOString())
const raw = await callGemini(
`Este pensamiento lleva ${dias} días sin actividad.\n` +
`Pensamiento: "${t.texto}"\n` +
`En 1 frase breve y empática en español, pregunta si sigue siendo relevante o sugiere qué hacer.\n` +
`Devuelve SOLO JSON: {"mensaje":"..."}`
)
const msg = JSON.parse(raw).mensaje || ‘¿Sigue siendo relevante este pensamiento?’
setSelected(prev => prev ? { …prev, dormantMsg: msg } : prev)
} catch (e) {
if (e.message === ‘RATE_LIMIT’) setAiError(‘Límite de la IA alcanzado. Espera un momento.’)
else setAiError(‘Error al conectar con la IA.’)
}
setAiLoading(false)
}

// ── Toggle nodo ────────────────────────────────────────────────────────────
const toggleNodo = (nodoId) => {
const updated = thoughts.map(t => {
if (t.id !== selected.id) return t
return { …t, nodos: t.nodos.map(n => n.id === nodoId ? { …n, completado: !n.completado } : n) }
})
setThoughts(updated)
setSelected(updated.find(t => t.id === selected.id))
}

// ── Open detail ────────────────────────────────────────────────────────────
const openDetail = (id) => {
const t = thoughts.find(t => t.id === id)
if (t) { setSelected(t); setAiError(null) }
}

// ── Stats: AI classification ───────────────────────────────────────────────
const loadStats = async () => {
const completed = thoughts.filter(t => t.completado)
if (!completed.length) { setStatsData({ categorias: [], noData: true }); return }
setStatsLoading(true)
try {
const lista = completed.map(t => ({
texto: t.texto, mood: t.mood,
dias: t.completadoEn ? daysBetween(t.fecha, t.completadoEn) : null,
}))
const raw = await callGemini(
`Clasifica estos pensamientos completados en categorías temáticas en español.\n` +
`Datos: ${JSON.stringify(lista)}\n` +
`Devuelve SOLO JSON sin markdown:\n` +
`{"categorias":[{"nombre":"Nombre","emoji":"🎯","pensamientos":[{"texto":"...","dias":0,"mood":"..."}]}]}\n` +
`Máximo 5 categorías. Agrupa por tema real.`
)
setStatsData(JSON.parse(raw))
} catch (e) {
if (e.message === ‘RATE_LIMIT’) setStatsData({ categorias: [], rateLimit: true })
else setStatsData({ categorias: [], error: true })
}
setStatsLoading(false)
}

// ── Voice input ────────────────────────────────────────────────────────────
const toggleVoice = () => {
const SR = window.SpeechRecognition || window.webkitSpeechRecognition
if (!SR) { alert(‘Tu navegador no soporta reconocimiento de voz’); return }
if (listening) { recogRef.current?.stop(); setListening(false); return }
const r = new SR()
r.lang = ‘es-ES’; r.continuous = false; r.interimResults = false
r.onresult = e => setInputText(prev => (prev + ’ ’ + e.results[0][0].transcript).trim())
r.onend = () => setListening(false)
recogRef.current = r; r.start(); setListening(true)
}

// ── Derived ────────────────────────────────────────────────────────────────
const activeThoughts    = useMemo(() => thoughts.filter(t => !t.completado && !t.eliminado), [thoughts])
const completedThoughts = useMemo(() => thoughts.filter(t => t.completado), [thoughts])
const eliminatedThoughts = useMemo(() => thoughts.filter(t => t.eliminado), [thoughts])
const isDormant  = t => daysBetween(t.fecha, new Date().toISOString()) >= 7
const isReadyPop = t => t.nodos.length > 0 && t.nodos.every(n => n.completado)

// ══════════════════════════════════════════════════════════════════════════
return (
<div style={{
width: ‘100%’, height: ‘100dvh’,
background: ‘#050a1a’,
display: ‘flex’, flexDirection: ‘column’,
overflow: ‘hidden’, position: ‘relative’,
}}>

```
  {/* ── Header ── */}
  <div style={{
    flexShrink: 0,
    padding: 'max(env(safe-area-inset-top), 14px) 18px 10px',
    background: 'linear-gradient(to bottom, rgba(5,10,26,1) 60%, transparent)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 20,
  }}>
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
        Bubbulú
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
        {activeThoughts.length} flotando · {completedThoughts.length} cumplidos
      </div>
    </div>
    <button
      onClick={() => setView(v => v === 'canvas' ? 'stats' : 'canvas')}
      style={{
        background: 'rgba(255,255,255,0.07)',
        border: `1px solid ${view === 'stats' ? 'rgba(99,179,237,0.4)' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: 20, padding: '7px 14px',
        color: view === 'stats' ? '#63b3ed' : 'rgba(255,255,255,0.5)',
        fontSize: 12, fontWeight: 700,
      }}>
      {view === 'stats' ? '🫧 Burbujas' : '📊 Stats'}
    </button>
  </div>

  {/* ══ CANVAS ══ */}
  {view === 'canvas' && (
    <div
      ref={canvasRef}
      style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative', WebkitOverflowScrolling: 'touch' }}
    >
      <div style={{ position: 'relative', width: '100%', height: dynamicH }}>

        {/* Starfield */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {Array.from({ length: 70 }, (_, i) => (
            <circle key={i}
              cx={`${(i * 137.5) % 100}%`} cy={`${(i * 97.3) % 100}%`}
              r={i % 6 === 0 ? 1.4 : 0.7}
              fill={`rgba(255,255,255,${0.06 + (i % 4) * 0.06})`}
            />
          ))}
        </svg>

        {/* Empty state */}
        {bubbles.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8, pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 52, opacity: 0.1 }}>🫧</div>
            <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 700 }}>
              Sin pensamientos flotando
            </div>
            <div style={{ color: 'rgba(255,255,255,0.12)', fontSize: 12 }}>
              Pulsa + para soltar uno
            </div>
          </div>
        )}

        {/* Bubbles */}
        {bubbles.map(b => {
          const col     = colorFor(b)
          const thought = thoughts.find(t => t.id === b.id)
          const dormant = thought && isDormant(thought)
          const ready   = thought && isReadyPop(thought)
          const isExp   = exploding === b.id
          const isPress = pressing === b.id
          const scale   = isExp ? 1.45 : isPress ? 1 + pressProgress * 0.28 : 1

          return (
            <div
              key={b.id}
              onMouseDown={e => startPress(b.id, e)}
              onMouseUp={() => { if (pressProgress < 0.25) openDetail(b.id); cancelPress() }}
              onMouseLeave={cancelPress}
              onTouchStart={e => startPress(b.id, e)}
              onTouchEnd={() => { if (pressProgress < 0.25) openDetail(b.id); cancelPress() }}
              style={{
                position: 'absolute',
                left: b.x - b.size / 2, top: b.y - b.size / 2,
                width: b.size, height: b.size, borderRadius: '50%',
                background: col.fill,
                border: `1.5px solid ${col.border}`,
                boxShadow: `0 0 ${isPress ? 30 : ready ? 22 : 14}px ${col.glow}${isPress ? '77' : ready ? '66' : '44'}, inset 0 1px 0 rgba(255,255,255,0.18)`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: 10, textAlign: 'center', cursor: 'pointer',
                transform: `scale(${scale})`,
                opacity: isExp ? 0 : dormant ? 0.42 : 1,
                transition: isExp ? 'transform 0.3s ease-out, opacity 0.28s ease-out' : 'transform 0.1s',
                backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
                animation: ready && !isPress
                  ? 'pulse 2.2s ease-in-out infinite'
                  : !isExp ? 'popIn 0.42s cubic-bezier(.34,1.56,.64,1) both' : 'none',
                zIndex: isPress ? 5 : 2,
              }}
            >
              {/* Press ring */}
              {isPress && (
                <svg style={{ position: 'absolute', inset: -3, width: b.size + 6, height: b.size + 6, transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
                  <circle
                    cx={(b.size + 6) / 2} cy={(b.size + 6) / 2} r={(b.size + 6) / 2 - 3}
                    fill="none" stroke={col.glow} strokeWidth={3}
                    strokeDasharray={Math.PI * (b.size + 6)}
                    strokeDashoffset={Math.PI * (b.size + 6) * (1 - pressProgress)}
                    strokeLinecap="round"
                  />
                </svg>
              )}

              {dormant && <div style={{ position: 'absolute', top: 6, right: 7, fontSize: 9 }}>💤</div>}
              {ready && !dormant && <div style={{ position: 'absolute', top: 5, right: 6, fontSize: 9 }}>✨</div>}

              <div style={{
                fontSize: b.size > 130 ? 11 : 10,
                color: 'rgba(255,255,255,0.92)', fontWeight: 600, lineHeight: 1.3,
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: b.size > 130 ? 4 : 3, WebkitBoxOrient: 'vertical',
              }}>
                {b.texto}
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
                {fmtDate(b.fecha)}
              </div>
              {b.nodos?.length > 0 && (
                <div style={{ fontSize: 9, color: col.glow, marginTop: 2, fontWeight: 700 }}>
                  {b.nodos.filter(n => n.completado).length}/{b.nodos.length}
                </div>
              )}
            </div>
          )
        })}

        {/* Particles */}
        {particles.map(p => (
          <div key={p.id} style={{
            position: 'absolute',
            left: p.x - p.size / 2, top: p.y - p.size / 2,
            width: p.size, height: p.size, borderRadius: '50%',
            background: p.color, opacity: p.life,
            boxShadow: `0 0 6px ${p.color}`,
            pointerEvents: 'none', zIndex: 20,
          }} />
        ))}
      </div>

      {/* Hint */}
      {bubbles.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
          left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', zIndex: 5,
        }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.14)' }}>
            Mantén para explotar · Toca para ver detalle
          </div>
        </div>
      )}
    </div>
  )}

  {/* ══ STATS ══ */}
  {view === 'stats' && (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '4px 18px',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)',
      animation: 'fadeUp 0.3s ease both',
      WebkitOverflowScrolling: 'touch',
    }}>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'Completados', val: completedThoughts.length,  color: '#68d391' },
          { label: 'Eliminados',  val: eliminatedThoughts.length, color: '#f68787' },
          { label: 'Flotando',    val: activeThoughts.length,     color: '#63b3ed' },
        ].map(s => (
          <div key={s.label} style={{
            flex: 1, background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${s.color}30`, borderRadius: 14,
            padding: '12px 8px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.38)', fontWeight: 600, marginTop: 2 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Mood breakdown */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
          Estado de ánimo
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {MOODS.map(m => {
            const count = thoughts.filter(t => t.mood === m.id).length
            return (
              <div key={m.id} style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: '8px 12px',
                display: 'flex', alignItems: 'center', gap: 7,
                minWidth: 80,
              }}>
                <span style={{ fontSize: 17 }}>{m.emoji}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{count}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.33)' }}>{m.label}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* AI categories */}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
        Categorías — análisis IA
      </div>

      {/* Stats load button - manual trigger only */}
      {!statsData && !statsLoading && (
        <button onClick={loadStats} style={{ width: '100%', padding: '13px 0', borderRadius: 12, background: 'linear-gradient(135deg, rgba(99,179,237,0.16), rgba(154,117,234,0.16))', border: '1px solid rgba(99,179,237,0.32)', color: '#63b3ed', fontSize: 13, fontWeight: 700, marginBottom: 16 }}>
          ✨ Analizar con IA
        </button>
      )}
      {statsLoading && (
        <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 13, textAlign: 'center', padding: '36px 0' }}>
          ✨ Analizando tus pensamientos...
        </div>
      )}
      {statsData?.noData && (
        <div style={{ color: 'rgba(255,255,255,0.18)', fontSize: 13, textAlign: 'center', padding: 28 }}>
          Aún no hay pensamientos completados para analizar.
        </div>
      )}
      {statsData?.rateLimit && (
        <div style={{ color: '#fbbf5a', fontSize: 13, textAlign: 'center', padding: 24 }}>
          ⚠️ Límite de peticiones alcanzado. Espera un minuto e inténtalo de nuevo.
        </div>
      )}
      {statsData?.error && (
        <div style={{ color: '#f68787', fontSize: 13, textAlign: 'center', padding: 24 }}>
          Error al conectar con la IA. Intenta de nuevo.
        </div>
      )}

      {statsData?.categorias?.map((cat, i) => (
        <div key={i} style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: '14px 15px', marginBottom: 10,
          animation: `fadeUp 0.35s ease ${i * 0.07}s both`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 20 }}>{cat.emoji}</span>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{cat.nombre}</div>
            <div style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.28)', fontWeight: 600 }}>
              {cat.pensamientos?.length}
            </div>
          </div>
          {cat.pensamientos?.map((p, j) => (
            <div key={j} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0',
              borderTop: j > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            }}>
              <span style={{ fontSize: 12, marginTop: 1, flexShrink: 0 }}>
                {MOODS.find(m => m.id === p.mood)?.emoji || '💭'}
              </span>
              <div style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.35 }}>
                {p.texto}
              </div>
              {p.dias != null && (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {p.dias === 0 ? 'mismo día' : `${p.dias}d`}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {statsData && !statsLoading && !statsData.noData && (
        <button
          onClick={() => setStatsData(null)}
          style={{
            width: '100%', padding: '11px 0', borderRadius: 12,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.09)',
            color: 'rgba(255,255,255,0.28)', fontSize: 12, fontWeight: 600,
          }}>
          ↺ Reclasificar con IA
        </button>
      )}
    </div>
  )}

  {/* ── FAB ── */}
  {view === 'canvas' && !showInput && !selected && (
    <button
      onClick={() => { setShowInput(true); setTimeout(() => inputRef.current?.focus(), 120) }}
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        right: 22, width: 56, height: 56, borderRadius: '50%',
        background: 'linear-gradient(135deg, #63b3ed, #9a75ea)',
        color: '#fff', fontSize: 28,
        boxShadow: '0 4px 24px rgba(99,179,237,0.45)',
        zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform 0.15s',
      }}
      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.92)'}
      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(0.92)'}
      onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      +
    </button>
  )}

  {/* ── Input overlay ── */}
  {showInput && (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(5,10,26,0.88)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={e => e.target === e.currentTarget && setShowInput(false)}
    >
      <div style={{
        width: '100%', maxWidth: 520,
        background: 'rgba(20,28,50,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '22px 22px 0 0',
        padding: '20px 20px',
        paddingBottom: 'max(env(safe-area-inset-bottom), 28px)',
        animation: 'slideUp 0.28s cubic-bezier(.34,1.1,.64,1) both',
      }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
          Nuevo pensamiento
        </div>

        {/* Textarea + mic */}
        <div style={{ position: 'relative' }}>
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), addThought())}
            placeholder="¿Qué está flotando en tu mente?"
            rows={3}
            style={{ width: '100%', color: '#fff', fontSize: 16, lineHeight: 1.5, fontWeight: 400, paddingRight: 38 }}
          />
          <button
            onClick={toggleVoice}
            style={{ position: 'absolute', top: 2, right: 0, background: 'none', fontSize: 20, opacity: listening ? 1 : 0.38, color: listening ? '#f68787' : '#fff' }}
          >
            🎙
          </button>
        </div>

        {/* Color picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginRight: 2 }}>
            Color
          </div>
          {BUBBLE_PALETTE.map(col => (
            <button
              key={col.id}
              onClick={() => setInputColor(col.id)}
              style={{
                width: 30, height: 30, borderRadius: '50%',
                background: col.fill,
                border: `2.5px solid ${inputColor === col.id ? col.glow : 'rgba(255,255,255,0.12)'}`,
                boxShadow: inputColor === col.id ? `0 0 10px ${col.glow}88` : 'none',
                transition: 'all 0.15s', flexShrink: 0,
              }}
            />
          ))}
        </div>

        {/* Mood picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginRight: 2 }}>
            Mood
          </div>
          {MOODS.map(m => (
            <button
              key={m.id}
              onClick={() => setInputMood(m.id)}
              title={m.label}
              style={{
                width: 40, height: 40, borderRadius: 10, fontSize: 18,
                background: inputMood === m.id ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)',
                border: `1.5px solid ${inputMood === m.id ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.07)'}`,
                transition: 'all 0.15s',
              }}
            >
              {m.emoji}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            onClick={() => setShowInput(false)}
            style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: 600 }}
          >
            Cancelar
          </button>
          <button
            onClick={addThought}
            style={{ flex: 2, padding: '13px 0', borderRadius: 12, background: 'linear-gradient(135deg, #63b3ed, #9a75ea)', color: '#fff', fontSize: 14, fontWeight: 700, opacity: inputText.trim() ? 1 : 0.32, transition: 'opacity 0.15s' }}
          >
            Soltar burbuja 🫧
          </button>
        </div>
      </div>
    </div>
  )}

  {/* ── Detail panel ── */}
  {selected && (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(5,10,26,0.9)',
      backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 60,
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: 'rgba(20,28,50,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '22px 22px 0 0',
        padding: '20px 20px',
        paddingBottom: 'max(env(safe-area-inset-bottom), 32px)',
        maxHeight: '82dvh', overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        animation: 'slideUp 0.28s cubic-bezier(.34,1.1,.64,1) both',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 18 }}>{MOODS.find(m => m.id === selected.mood)?.emoji}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>
              {MOODS.find(m => m.id === selected.mood)?.label} · {fmtDate(selected.fecha)}
            </span>
            {isDormant(selected) && (
              <span style={{ fontSize: 10, color: '#fbbf5a', fontWeight: 700 }}>· 💤 Dormida</span>
            )}
          </div>
          <button
            onClick={() => setSelected(null)}
            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', width: 32, height: 32, borderRadius: '50%', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, lineHeight: 1.4, marginBottom: 18 }}>
          {selected.texto}
        </div>

        {/* Dormant review */}
        {isDormant(selected) && (
          <div style={{ marginBottom: 14 }}>
            {selected.dormantMsg ? (
              <div style={{ background: 'rgba(251,191,90,0.09)', border: '1px solid rgba(251,191,90,0.22)', borderRadius: 12, padding: '11px 14px', fontSize: 13, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4 }}>
                💡 {selected.dormantMsg}
              </div>
            ) : (
              <button
                onClick={() => reviewDormant(selected.id)}
                disabled={aiLoading}
                style={{ width: '100%', padding: '10px 0', borderRadius: 11, background: 'rgba(251,191,90,0.07)', border: '1px solid rgba(251,191,90,0.28)', color: '#fbbf5a', fontSize: 12, fontWeight: 700 }}
              >
                {aiLoading ? 'Revisando...' : '💤 Revisar con IA — lleva tiempo flotando'}
              </button>
            )}
          </div>
        )}

        {/* Decompose */}
        {selected.nodos.length === 0 && (
          <button
            onClick={decomposeAI}
            disabled={aiLoading}
            style={{ width: '100%', padding: '13px 0', borderRadius: 12, background: aiLoading ? 'rgba(255,255,255,0.03)' : 'linear-gradient(135deg, rgba(99,179,237,0.16), rgba(154,117,234,0.16))', border: '1px solid rgba(99,179,237,0.32)', color: aiLoading ? 'rgba(255,255,255,0.22)' : '#63b3ed', fontSize: 13, fontWeight: 700, marginBottom: 14 }}
          >
            {aiLoading ? '✨ Pensando...' : '✨ Descomponer con IA'}
          </button>
        )}

        {/* AI Error */}
        {aiError && (
          <div style={{ background: 'rgba(246,135,135,0.08)', border: '1px solid rgba(246,135,135,0.25)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#f68787', lineHeight: 1.4 }}>
            ⚠️ {aiError}
          </div>
        )}

        {/* Nodes */}
        {selected.nodos.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
              {selected.nodos.filter(n => n.completado).length}/{selected.nodos.length} pasos
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {selected.nodos.map(n => (
                <div
                  key={n.id}
                  onClick={() => toggleNodo(n.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 13px', borderRadius: 12, background: n.completado ? 'rgba(104,211,145,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${n.completado ? 'rgba(104,211,145,0.25)' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', minHeight: 44 }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: `2px solid ${n.completado ? '#68d391' : 'rgba(255,255,255,0.18)'}`, background: n.completado ? '#68d391' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {n.completado && <span style={{ fontSize: 10, color: '#050a1a', fontWeight: 800 }}>✓</span>}
                  </div>
                  <div style={{ fontSize: 13, color: n.completado ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.82)', fontWeight: 500, lineHeight: 1.35, textDecoration: n.completado ? 'line-through' : 'none' }}>
                    {n.texto}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={decomposeAI}
              disabled={aiLoading}
              style={{ marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.26)', fontSize: 11, fontWeight: 600 }}
            >
              {aiLoading ? 'Regenerando...' : '↺ Regenerar pasos'}
            </button>
          </div>
        )}

        {/* Delete */}
        <button
          onClick={() => deleteThought(selected.id)}
          style={{ width: '100%', padding: '12px 0', borderRadius: 12, background: 'rgba(246,135,135,0.06)', border: '1px solid rgba(246,135,135,0.2)', color: '#f68787', fontSize: 13, fontWeight: 700 }}
        >
          🗑 Eliminar pensamiento
        </button>
      </div>
    </div>
  )}
</div>
```

)
}
