import { useEffect, useState } from 'react'
import { db } from '../../firebase/firebase'
import { collection, onSnapshot, query, where, updateDoc, doc, getDocs } from 'firebase/firestore'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

/* ─── Helpers ─────────────────────────────────────────── */
function formatCheckinTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
}

function useCountdown(isoTimestamp, waitMinutes) {
  const [remaining, setRemaining] = useState(null)
  useEffect(() => {
    if (!isoTimestamp || waitMinutes == null) return
    const expectedDone = new Date(isoTimestamp).getTime() + waitMinutes * 60000
    const tick = () => {
      const diff = Math.max(0, Math.floor((expectedDone - Date.now()) / 1000))
      const m = Math.floor(diff / 60)
      const s = diff % 60
      setRemaining(`${m}m ${s.toString().padStart(2, '0')}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isoTimestamp, waitMinutes])
  return remaining
}

/* ─── Currently at Clinic Card ──────────────────────── */
function ClinicCard({ appt, nowServing, onCancel }) {
  const countdown = useCountdown(appt.arrivedAt, appt.waitingTime)
  const before = appt.patientsBefore ?? 0
  const after = appt.patientsAfter ?? 0
  const qp = appt.queuePosition ?? null
  const delay = appt.delayMinutes ?? 0
  const isNext = before === 0
  const wait = appt.waitingTime != null ? appt.waitingTime : null
  const total = before + 1 + after   // total in queue

  // Build visible token strip (max 11 bubbles, with ellipsis)
  const buildStrip = () => {
    const items = []
    const myPos = qp ? qp - 1 : before  // 0-indexed
    const startPos = (nowServing != null ? nowServing - 1 : 0)
    const allPositions = Array.from({ length: total }, (_, i) => i)
    // show up to 4 before me, me, up to 4 after me (max 9)
    const windowStart = Math.max(startPos, myPos - 4)
    const windowEnd = Math.min(total - 1, myPos + 4)
    if (windowStart > startPos) items.push({ type: 'ellipsis', key: 'el-start' })
    for (let i = windowStart; i <= windowEnd; i++) {
      const tokenNum = i + 1
      const isDone = nowServing != null && tokenNum < nowServing
      const isServing = nowServing != null && tokenNum === nowServing
      const isMe = tokenNum === qp
      items.push({ type: 'token', tokenNum, isDone, isServing, isMe, key: `t-${i}` })
    }
    if (windowEnd < total - 1) items.push({ type: 'ellipsis', key: 'el-end' })
    return items
  }
  const strip = qp ? buildStrip() : []

  return (
    <div style={{
      background: 'linear-gradient(135deg, #052e16, #166534)',
      borderRadius: '20px',
      padding: '1.5rem',
      color: '#fff',
      boxShadow: '0 8px 32px rgba(22,101,52,0.35)',
      position: 'relative',
      overflow: 'hidden',
      marginBottom: '1.5rem',
    }}>
      {/* Background glow */}
      <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '140px', height: '140px', borderRadius: '50%', background: 'rgba(74,222,128,0.1)' }} />

      {/* Check-in badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ background: '#22c55e', borderRadius: '50%', width: '10px', height: '10px', display: 'inline-block', boxShadow: '0 0 8px #22c55e', animation: 'pulse-green 2s infinite' }} />
          <span style={{ fontWeight: 800, fontSize: '0.82rem', letterSpacing: '0.05em', color: '#86efac' }}>CURRENTLY AT CLINIC</span>
        </div>
        <span style={{ background: 'rgba(255,255,255,0.12)', padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', color: '#bbf7d0', fontWeight: 600 }}>
          ✅ Checked in at {formatCheckinTime(appt.arrivedAt)}
        </span>
      </div>

      {/* Doctor + appointment */}
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#f0fdf4' }}>
          👨‍⚕️ {appt.doctorName}
        </h2>
        <p style={{ margin: '2px 0 0', color: '#86efac', fontSize: '0.82rem' }}>
          {appt.department} · {appt.date} · {appt.timeSlot}
        </p>
      </div>

      {/* ─── Visual Token Queue Strip ─────────────────── */}
      {strip.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 8px', fontSize: '0.62rem', color: '#86efac', fontWeight: 700, letterSpacing: '0.08em' }}>
            QUEUE POSITION
          </p>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {strip.map(item =>
              item.type === 'ellipsis' ? (
                <span key={item.key} style={{ color: '#86efac', fontSize: '0.8rem', opacity: 0.6 }}>•••</span>
              ) : (
                <div key={item.key} style={{
                  width: item.isMe ? '48px' : '34px',
                  height: item.isMe ? '48px' : '34px',
                  borderRadius: item.isMe ? '12px' : '8px',
                  background: item.isMe ? '#22c55e'
                    : item.isServing ? '#facc15'
                      : item.isDone ? 'rgba(255,255,255,0.12)'
                        : 'rgba(255,255,255,0.06)',
                  border: item.isMe ? '2px solid #4ade80'
                    : item.isServing ? '2px solid #fde047'
                      : '1.5px solid rgba(255,255,255,0.1)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.3s',
                  boxShadow: item.isMe ? '0 0 14px rgba(34,197,94,0.5)' : 'none',
                }}>
                  <span style={{
                    fontSize: item.isMe ? '0.72rem' : '0.62rem',
                    fontWeight: 800,
                    color: item.isMe ? '#fff'
                      : item.isServing ? '#1a1a1a'
                        : item.isDone ? 'rgba(255,255,255,0.35)'
                          : 'rgba(255,255,255,0.55)',
                    lineHeight: 1,
                  }}>#{item.tokenNum}</span>
                  {item.isMe && (
                    <span style={{ fontSize: '0.5rem', color: '#bbf7d0', fontWeight: 700, letterSpacing: '0.03em' }}>YOU</span>
                  )}
                  {item.isServing && !item.isMe && (
                    <span style={{ fontSize: '0.45rem', color: '#713f12', fontWeight: 700 }}>NOW</span>
                  )}
                </div>
              )
            )}
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
            {[
              { dot: '#facc15', label: 'Now Serving' },
              { dot: '#22c55e', label: 'You' },
              { dot: 'rgba(255,255,255,0.5)', label: 'Waiting behind' },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '3px', background: l.dot, flexShrink: 0 }} />
                <span style={{ fontSize: '0.65rem', color: '#86efac', opacity: 0.8 }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 4-stat row ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '1rem' }}>
        {[
          { label: 'NOW SERVING', value: nowServing != null ? `#${nowServing}` : '—', color: '#fbbf24', highlight: false },
          { label: 'YOUR TOKEN', value: qp != null ? `#${qp}` : '—', color: isNext ? '#22c55e' : '#fff', highlight: isNext },
          { label: 'BEFORE YOU', value: before, color: '#f87171', highlight: false },
          { label: 'BEHIND YOU', value: after, color: '#60a5fa', highlight: false },
        ].map(s => (
          <div key={s.label} style={{
            background: s.highlight ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.07)',
            border: s.highlight ? '1.5px solid #22c55e' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px', padding: '10px 8px', textAlign: 'center',
          }}>
            <p style={{ margin: 0, fontSize: '0.55rem', color: '#86efac', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '4px' }}>{s.label}</p>
            <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: s.color }}>{s.value}</p>
            {s.highlight && <p style={{ margin: 0, fontSize: '0.55rem', color: '#22c55e', fontWeight: 700 }}>🎉 NEXT!</p>}
          </div>
        ))}
      </div>

      {/* ─── Big waiting time box ──────────────────────── */}
      <div style={{
        background: 'rgba(0,0,0,0.3)',
        border: '1px solid rgba(34,197,94,0.3)',
        borderRadius: '14px',
        padding: '16px',
        textAlign: 'center',
        marginBottom: '1rem',
      }}>
        <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', color: '#86efac' }}>
          ⏱️ YOUR ESTIMATED WAITING TIME
        </p>
        <div style={{ fontSize: '2.8rem', fontWeight: 900, color: '#fff', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
          {wait != null ? `~${wait} min` : 'Calculating...'}
        </div>
        {countdown && wait > 0 && (
          <p style={{ margin: '4px 0 0', color: '#86efac', fontSize: '0.78rem' }}>
            ⏳ Countdown: {countdown} remaining
          </p>
        )}
        {delay > 0 && (
          <div style={{ marginTop: '8px', background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: '8px', padding: '6px 12px', display: 'inline-block' }}>
            <span style={{ color: '#fb923c', fontSize: '0.75rem', fontWeight: 700 }}>⚠️ Includes {delay} min doctor delay</span>
          </div>
        )}
      </div>

      {/* Formula explanation */}
      <p style={{ margin: '0 0 1rem', fontSize: '0.68rem', color: '#6ee7b7', textAlign: 'center' }}>
        Wait = {delay} min delay + {before} patient{before !== 1 ? 's' : ''} × {appt.consultationDuration ?? 20} min = <strong style={{ color: '#fff' }}>{wait ?? '—'} min</strong>
      </p>

      {/* Cancel button */}
      <button
        onClick={() => onCancel(appt.id)}
        style={{
          width: '100%', background: 'rgba(239,68,68,0.15)',
          color: '#fca5a5', border: '1.5px solid rgba(239,68,68,0.35)',
          borderRadius: '10px', padding: '12px',
          cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.target.style.background = 'rgba(239,68,68,0.3)' }}
        onMouseLeave={e => { e.target.style.background = 'rgba(239,68,68,0.15)' }}
      >
        ✕ Cancel Appointment
      </button>

      <style>{`@keyframes pulse-green { 0%,100%{box-shadow:0 0 4px #22c55e}50%{box-shadow:0 0 12px #22c55e}}`}</style>
    </div>
  )
}

/* ─── Past appointment card ──────────────────────────── */
function PastCard({ appt }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '14px', padding: '1.1rem 1.4rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      borderLeft: '4px solid #e2e8f0',
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap'
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>👨‍⚕️ {appt.doctorName}</span>
          <span style={{ background: '#dcfce7', color: '#16a34a', padding: '2px 8px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 700 }}>✅ Completed</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', color: '#64748b', fontSize: '0.82rem' }}>
          <span>📅 {appt.date}</span>
          <span>⏰ {appt.timeSlot}</span>
          <span>🏥 {appt.department}</span>
        </div>
        {appt.reason && (
          <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '0.78rem' }}>📝 {appt.reason}</p>
        )}
      </div>
      <div style={{ textAlign: 'right', minWidth: '80px' }}>
        <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '8px 12px' }}>
          <p style={{ margin: 0, fontSize: '0.6rem', color: '#94a3b8', fontWeight: 700 }}>RECEIPT</p>
          <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>#{appt.id?.slice(-4).toUpperCase()}</p>
        </div>
      </div>
    </div>
  )
}

/* ─── Scheduled / upcoming card ─────────────────────── */
function UpcomingCard({ appt }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '14px', padding: '1.1rem 1.4rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      borderLeft: '4px solid #2563eb',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>👨‍⚕️ {appt.doctorName}</span>
          <span style={{ background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 700 }}>📅 Scheduled</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', color: '#64748b', fontSize: '0.82rem', flexWrap: 'wrap' }}>
          <span>📅 {appt.date}</span>
          <span>⏰ {appt.timeSlot}</span>
          <span>🏥 {appt.department}</span>
        </div>
      </div>
    </div>
  )
}

/* ─── Main page ──────────────────────────────────────── */
function PatientAppointments() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [appointments, setAppointments] = useState([])
  const [nowServingMap, setNowServingMap] = useState({})  // doctorId → current queuePosition serving
  const [loading, setLoading] = useState(true)
  const today = new Date().toISOString().split('T')[0]

  // Real-time: patient's own appointments
  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'appointments'), where('patientId', '==', user.uid))
    return onSnapshot(q, snap => {
      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.date + a.timeSlot) > (b.date + b.timeSlot) ? -1 : 1)
      setAppointments(data)
      setLoading(false)
    })
  }, [user])

  // Real-time: "Now Serving" — fetch In Consultation for each doctor
  useEffect(() => {
    const q = query(
      collection(db, 'appointments'),
      where('date', '==', today),
      where('status', '==', 'In Consultation')
    )
    return onSnapshot(q, snap => {
      const m = {}
      snap.docs.forEach(d => {
        const data = d.data()
        m[data.doctorId] = data.queuePosition
      })
      setNowServingMap(m)
    })
  }, [today])

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this appointment?')) return
    await updateDoc(doc(db, 'appointments', id), { status: 'Cancelled' })
  }

  // Categorise
  const activeToday = appointments.filter(a => a.date === today && a.status === 'Waiting')
  const inConsultation = appointments.filter(a => a.date === today && a.status === 'In Consultation')
  const upcoming = appointments.filter(a => a.status === 'Scheduled' && a.date >= today)
  const past = appointments.filter(a => a.status === 'Completed')
  const cancelled = appointments.filter(a => a.status === 'Cancelled')

  const atClinic = [...inConsultation, ...activeToday]

  return (
    <div style={{ padding: '0', maxWidth: '640px', margin: '0 auto', minHeight: '100vh', background: '#f8fafc' }}>

      {/* ── Header ──────────────────────────────────────── */}
      <div style={{
        background: '#fff', padding: '1rem 1.25rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 1px 4px rgba(0,0,0,0.07)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => navigate('/patient/dashboard')}
            style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#1e293b' }}>My Appointments</h1>
        </div>
        <div style={{ width: '36px', height: '36px', background: '#2563eb', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '0.9rem' }}>
          {user?.email?.[0]?.toUpperCase() ?? '?'}
        </div>
      </div>

      <div style={{ padding: '1.25rem' }}>

        {loading ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', paddingTop: '3rem' }}>Loading...</p>
        ) : (
          <>
            {/* ── Currently at Clinic (Waiting / In Consultation) ── */}
            {atClinic.length > 0 && (
              <section style={{ marginBottom: '1.5rem' }}>
                {atClinic.map(appt => (
                  <div key={appt.id}>
                    {appt.status === 'In Consultation' ? (
                      <div style={{
                        background: 'linear-gradient(135deg, #0c4a6e, #0369a1)',
                        borderRadius: '20px', padding: '1.5rem', color: '#fff',
                        boxShadow: '0 8px 32px rgba(3,105,161,0.35)', marginBottom: '1rem'
                      }}>
                        <span style={{ background: '#0ea5e9', padding: '4px 12px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.05em' }}>
                          🩺 IN CONSULTATION
                        </span>
                        <h2 style={{ margin: '10px 0 4px', fontWeight: 800, fontSize: '1.2rem' }}>👨‍⚕️ {appt.doctorName}</h2>
                        <p style={{ margin: 0, color: '#7dd3fc', fontSize: '0.85rem' }}>You are currently with the doctor</p>
                      </div>
                    ) : (
                      <ClinicCard
                        appt={appt}
                        nowServing={nowServingMap[appt.doctorId]}
                        onCancel={handleCancel}
                      />
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* ── Upcoming Scheduled ───────────────────────── */}
            {upcoming.length > 0 && (
              <section style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ margin: '0 0 10px', fontSize: '0.85rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em' }}>📅 UPCOMING</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {upcoming.map(a => <UpcomingCard key={a.id} appt={a} />)}
                </div>
              </section>
            )}

            {/* ── Past Appointments ─────────────────────────── */}
            {past.length > 0 && (
              <section style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ margin: '0 0 10px', fontSize: '0.85rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em' }}>🗓️ PAST APPOINTMENTS</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {past.map(a => <PastCard key={a.id} appt={a} />)}
                </div>
              </section>
            )}

            {/* ── Cancelled ─────────────────────────────────── */}
            {cancelled.length > 0 && (
              <section style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ margin: '0 0 10px', fontSize: '0.85rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>✕ CANCELLED</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {cancelled.map(a => (
                    <div key={a.id} style={{ background: '#fff', borderRadius: '14px', padding: '1rem 1.4rem', borderLeft: '4px solid #dc2626', opacity: 0.65, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                      <p style={{ margin: 0, fontWeight: 700, color: '#dc2626' }}>✕ {a.doctorName}</p>
                      <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '0.8rem' }}>{a.date} · {a.timeSlot}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Empty ─────────────────────────────────────── */}
            {appointments.length === 0 && (
              <div style={{ textAlign: 'center', paddingTop: '4rem', color: '#94a3b8' }}>
                <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>📭</div>
                <h2 style={{ color: '#475569' }}>No appointments yet</h2>
                <button onClick={() => navigate('/patient/book')}
                  style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '10px', padding: '12px 28px', cursor: 'pointer', fontWeight: 700, marginTop: '1rem', fontSize: '0.95rem' }}>
                  ➕ Book Appointment
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default PatientAppointments