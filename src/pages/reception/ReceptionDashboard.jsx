import { useEffect, useState, useRef } from 'react'
import { db } from '../../firebase/firebase'
import {
  collection, onSnapshot, query, where,
  updateDoc, doc, addDoc, getDocs, writeBatch
} from 'firebase/firestore'
import { useNavigate, Link } from 'react-router-dom'
import { getDoctorTracker } from '../../utils/queueEngine'

/* ─── Inline recalculation (same as ReceptionAppointments) ── */
async function recalculateInMemory(doctorId, date, allAppointments, newlyArrivedId, delayMinutes, consultDuration) {
  const nowWaiting = allAppointments
    .filter(a =>
      a.doctorId === doctorId &&
      a.date === date &&
      (a.status === 'Waiting' || a.id === newlyArrivedId)
    )
    .sort((a, b) => {
      const ta = a.id === newlyArrivedId ? Date.now() : (a.arrivedAt ? new Date(a.arrivedAt).getTime() : 0)
      const tb = b.id === newlyArrivedId ? Date.now() : (b.arrivedAt ? new Date(b.arrivedAt).getTime() : 0)
      return ta - tb
    })

  if (nowWaiting.length === 0) return
  const total = nowWaiting.length
  const batch = writeBatch(db)
  nowWaiting.forEach((patient, index) => {
    batch.update(doc(db, 'appointments', patient.id), {
      status: patient.id === newlyArrivedId ? 'Waiting' : patient.status,
      arrivedAt: patient.id === newlyArrivedId ? new Date().toISOString() : patient.arrivedAt,
      queuePosition: index + 1,
      patientsBefore: index,
      patientsAfter: total - index - 1,
      waitingTime: delayMinutes + (index * consultDuration),
      delayMinutes,
      consultationDuration: consultDuration,
    })
  })
  await batch.commit()
}

/* ─── Status pill ─────────────────────────────────────────── */
const STATUS = {
  Scheduled: { bg: '#eff6ff', color: '#2563eb', label: 'Scheduled' },
  Waiting: { bg: '#f3e8ff', color: '#7c3aed', label: 'Waiting' },
  'In Consultation': { bg: '#e0f2fe', color: '#0891b2', label: 'In Consult' },
  Completed: { bg: '#dcfce7', color: '#16a34a', label: 'Completed' },
  Cancelled: { bg: '#fee2e2', color: '#dc2626', label: 'Cancelled' },
}

function StatusPill({ status }) {
  const s = STATUS[status] || { bg: '#f1f5f9', color: '#64748b', label: status }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

/* ─── Main Dashboard ──────────────────────────────────────── */
function ReceptionDashboard() {
  const navigate = useNavigate()
  const [todayAppts, setTodayAppts] = useState([])
  const [doctors, setDoctors] = useState({})
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(null)  // id being checked in
  const [recentCheckIns, setRecentCheckIns] = useState([])  // from local session
  const today = new Date().toISOString().split('T')[0]

  /* ── Real-time: today's appointments ── */
  useEffect(() => {
    const q = query(collection(db, 'appointments'), where('date', '==', today))
    return onSnapshot(q, snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.timeSlot > b.timeSlot ? 1 : -1)
      setTodayAppts(list)
      setLoading(false)
    })
  }, [today])

  /* ── Real-time: doctors map ── */
  useEffect(() => {
    return onSnapshot(collection(db, 'doctors'), snap => {
      const m = {}
      snap.docs.forEach(d => { m[d.id] = d.data() })
      setDoctors(m)
    })
  }, [])

  /* ── Check-in: receptionist ticks the arrived checkbox ── */
  const handleCheckIn = async (appt) => {
    if (appt.status !== 'Scheduled') return
    setChecking(appt.id)
    try {
      const consultDur = doctors[appt.doctorId]?.consultationDuration || 20
      const tracker = await getDoctorTracker(appt.doctorId, today)
      const delayMinutes = tracker?.delayMinutes ?? 0

      await recalculateInMemory(appt.doctorId, today, todayAppts, appt.id, delayMinutes, consultDur)

      if (!tracker) {
        const waitingNow = todayAppts.filter(
          a => a.doctorId === appt.doctorId && a.status === 'Waiting'
        ).length + 1
        await addDoc(collection(db, 'doctorDelayTrackers'), {
          doctorId: appt.doctorId,
          doctorName: appt.doctorName,
          date: today,
          arrivalConfirmedAt: new Date().toISOString(),
          doctorStatus: 'Pending',
          lastNotifiedAt: null,
          active: true,
          delayMinutes: 0,
          waitingPatients: waitingNow,
        })
      }

      // Add to local recent check-ins session list
      const queuePos = todayAppts.filter(
        a => a.doctorId === appt.doctorId && a.status === 'Waiting'
      ).length + 1

      setRecentCheckIns(prev => [{
        id: appt.id,
        name: appt.patientName,
        token: queuePos,
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        doctorName: appt.doctorName,
      }, ...prev].slice(0, 5))
    } finally {
      setChecking(null)
    }
  }

  // ── Derived queue data ──────────────────────────────────
  const inConsultation = todayAppts.filter(a => a.status === 'In Consultation')
  const waitingList = todayAppts
    .filter(a => a.status === 'Waiting')
    .sort((a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999))
  const nowServing = inConsultation[0] || null
  const nextPatient = waitingList[0] || null

  // Stats strip
  const stats = [
    { icon: '📅', label: 'Total', val: todayAppts.length, color: '#2563eb', bg: '#eff6ff' },
    { icon: '🕐', label: 'Scheduled', val: todayAppts.filter(a => a.status === 'Scheduled').length, color: '#64748b', bg: '#f8fafc' },
    { icon: '⏳', label: 'Waiting', val: waitingList.length, color: '#7c3aed', bg: '#f3e8ff' },
    { icon: '🩺', label: 'In Consult', val: inConsultation.length, color: '#0891b2', bg: '#e0f2fe' },
    { icon: '✅', label: 'Completed', val: todayAppts.filter(a => a.status === 'Completed').length, color: '#16a34a', bg: '#dcfce7' },
  ]

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto', fontFamily: "'Segoe UI', sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <span style={{ fontSize: '1.5rem' }}>🏥</span>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, color: '#1e293b' }}>MEDCARE CLINIC</h1>
            </div>
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem', fontWeight: 600 }}>
              Reception Dashboard — 📅 {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link to="/reception/doctor-delay"
              style={{ background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 14px', textDecoration: 'none', fontSize: '0.82rem', fontWeight: 700 }}>
              ⏰ Delay Manager
            </Link>
            <Link to="/reception/appointments"
              style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 14px', textDecoration: 'none', fontSize: '0.82rem', fontWeight: 700 }}>
              📋 All Appointments
            </Link>
          </div>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: '#fff', borderRadius: '10px', padding: '10px 16px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', borderTop: `3px solid ${s.color}`, flex: 1, minWidth: '90px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.2rem', marginBottom: '2px' }}>{s.icon}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: s.color, lineHeight: 1 }}>{loading ? '—' : s.val}</div>
            <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700, marginTop: '2px', letterSpacing: '0.04em' }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.5rem', alignItems: 'start' }}>

        {/* ═══════════════════════════════════════
            LEFT: Today's Appointment Table
        ═══════════════════════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 2px 12px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(90deg, #1e3a8a, #2563eb)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, color: '#fff', fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                📅 TODAY'S APPOINTMENTS
              </h2>
              <span style={{ color: '#93c5fd', fontSize: '0.75rem', fontWeight: 600 }}>
                {todayAppts.length} total
              </span>
            </div>

            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            ) : todayAppts.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                No appointments scheduled for today.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['TIME', 'PATIENT NAME', 'DOCTOR', 'TOKEN', 'STATUS', 'ARRIVED ✓'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: h === 'ARRIVED ✓' ? 'center' : 'left', borderBottom: '2px solid #e2e8f0', fontSize: '0.68rem', color: '#64748b', fontWeight: 800, letterSpacing: '0.05em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {todayAppts.map((a, i) => {
                      const isCheckedIn = a.status !== 'Scheduled' && a.status !== 'Cancelled'
                      const isLoading = checking === a.id
                      const rowBg = a.status === 'In Consultation' ? '#f0faff'
                        : a.status === 'Waiting' ? '#fdf4ff'
                          : a.status === 'Completed' ? '#f0fdf4'
                            : '#fff'
                      return (
                        <tr key={a.id}
                          style={{ borderBottom: '1px solid #f1f5f9', background: rowBg, transition: 'background 0.2s' }}
                        >
                          {/* Time */}
                          <td style={{ padding: '11px 14px', fontWeight: 700, color: '#1e293b', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                            {a.timeSlot}
                          </td>
                          {/* Patient */}
                          <td style={{ padding: '11px 14px' }}>
                            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem' }}>{a.patientName}</div>
                            {a.reason && <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '1px' }}>{a.reason}</div>}
                          </td>
                          {/* Doctor */}
                          <td style={{ padding: '11px 14px', color: '#475569', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                            {a.doctorName}
                          </td>
                          {/* Token */}
                          <td style={{ padding: '11px 14px' }}>
                            {a.queuePosition != null ? (
                              <span style={{ background: '#f3e8ff', color: '#7c3aed', padding: '3px 10px', borderRadius: '20px', fontWeight: 800, fontSize: '0.8rem' }}>
                                #{a.queuePosition}
                              </span>
                            ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                          </td>
                          {/* Status */}
                          <td style={{ padding: '11px 14px' }}>
                            <StatusPill status={a.status} />
                            {a.status === 'Waiting' && a.waitingTime != null && (
                              <div style={{ fontSize: '0.65rem', color: '#7c3aed', marginTop: '3px', fontWeight: 700 }}>
                                ⏳ ~{a.waitingTime} min wait
                              </div>
                            )}
                          </td>
                          {/* Arrived checkbox */}
                          <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                            {a.status === 'Cancelled' ? (
                              <span style={{ color: '#dc2626', fontSize: '0.8rem' }}>—</span>
                            ) : isLoading ? (
                              <span style={{ fontSize: '0.75rem', color: '#7c3aed' }}>…</span>
                            ) : (
                              <button
                                onClick={() => !isCheckedIn && handleCheckIn(a)}
                                disabled={isCheckedIn}
                                title={isCheckedIn ? `Checked in as ${a.status}` : 'Mark patient as arrived'}
                                style={{
                                  width: '28px', height: '28px',
                                  borderRadius: '6px',
                                  border: isCheckedIn ? 'none' : '2px solid #d1d5db',
                                  background: isCheckedIn ? '#22c55e' : '#fff',
                                  cursor: isCheckedIn ? 'default' : 'pointer',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '0.85rem',
                                  margin: '0 auto',
                                  transition: 'all 0.2s',
                                  boxShadow: isCheckedIn ? '0 2px 6px rgba(34,197,94,0.4)' : 'none',
                                }}
                              >
                                {isCheckedIn ? '✓' : ''}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Check-ins */}
          {recentCheckIns.length > 0 && (
            <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
              <div style={{ background: '#f0fdf4', padding: '12px 20px', borderBottom: '1.5px solid #bbf7d0' }}>
                <h2 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 800, color: '#166534', letterSpacing: '0.04em' }}>
                  ✅ RECENT CHECK-INS
                </h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {recentCheckIns.map((c, i) => (
                  <div key={c.id + i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 20px', borderBottom: '1px solid #f0fdf4' }}>
                    <span style={{ background: '#22c55e', color: '#fff', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0 }}>✓</span>
                    <span style={{ color: '#64748b', fontSize: '0.78rem', whiteSpace: 'nowrap', minWidth: '60px' }}>{c.time}</span>
                    <span style={{ fontWeight: 700, color: '#1e293b', flex: 1, fontSize: '0.88rem' }}>{c.name}</span>
                    <span style={{ background: '#f3e8ff', color: '#7c3aed', padding: '2px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                      Token #{c.token}
                    </span>
                    <span style={{ color: '#94a3b8', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{c.doctorName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════
            RIGHT: Queue panel + Wait Time
        ═══════════════════════════════════════ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Current Queue */}
          <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(90deg, #065f46, #16a34a)', padding: '12px 18px' }}>
              <h2 style={{ margin: 0, color: '#fff', fontSize: '0.88rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                🟢 CURRENT QUEUE
              </h2>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Now serving */}
              <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '10px', padding: '10px 14px' }}>
                <p style={{ margin: 0, fontSize: '0.62rem', color: '#166534', fontWeight: 800, letterSpacing: '0.08em', marginBottom: '4px' }}>NOW SERVING</p>
                {nowServing ? (
                  <>
                    <p style={{ margin: 0, fontWeight: 800, color: '#1e293b', fontSize: '0.95rem' }}>
                      Token #{nowServing.queuePosition ?? '—'} — {nowServing.patientName}
                    </p>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '0.72rem', marginTop: '2px' }}>{nowServing.doctorName}</p>
                  </>
                ) : (
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>No patient in consultation</p>
                )}
              </div>

              {/* Next */}
              <div style={{ background: '#f5f3ff', border: '1.5px solid #ddd6fe', borderRadius: '10px', padding: '10px 14px' }}>
                <p style={{ margin: 0, fontSize: '0.62rem', color: '#5b21b6', fontWeight: 800, letterSpacing: '0.08em', marginBottom: '4px' }}>NEXT</p>
                {nextPatient ? (
                  <>
                    <p style={{ margin: 0, fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>
                      Token #{nextPatient.queuePosition} — {nextPatient.patientName}
                    </p>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '0.72rem', marginTop: '2px' }}>{nextPatient.doctorName}</p>
                  </>
                ) : (
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>No patients waiting</p>
                )}
              </div>

              {/* Full waiting list */}
              {waitingList.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 6px', fontSize: '0.62rem', color: '#64748b', fontWeight: 800, letterSpacing: '0.06em' }}>
                    IN QUEUE — {waitingList.length} patient{waitingList.length !== 1 ? 's' : ''} waiting
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                    {waitingList.map((a, i) => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: i === 0 ? '#f5f3ff' : '#f8fafc', borderRadius: '8px', border: `1px solid ${i === 0 ? '#ddd6fe' : '#f1f5f9'}` }}>
                        <span style={{ background: i === 0 ? '#7c3aed' : '#94a3b8', color: '#fff', padding: '2px 7px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 800, flexShrink: 0 }}>
                          #{a.queuePosition}
                        </span>
                        <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>{a.patientName}</span>
                        {a.waitingTime != null && (
                          <span style={{ fontSize: '0.68rem', color: '#7c3aed', fontWeight: 700, whiteSpace: 'nowrap' }}>~{a.waitingTime}m</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {[
              { to: '/reception/doctor-delay', label: '⏰ Delay Manager', bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
              { to: '/reception/announcements', label: '📢 Announcements', bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
              { to: '/reception/doctors', label: '👨‍⚕️ Doctors', bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
              { to: '/queue-display', label: '📺 Queue Board', bg: '#0a0f1e', color: '#93c5fd', border: '#1e3a8a', external: true },
            ].map(b => (
              <Link
                key={b.to}
                to={b.to}
                target={b.external ? '_blank' : undefined}
                rel={b.external ? 'noreferrer' : undefined}
                style={{
                  background: b.bg, color: b.color,
                  border: `1px solid ${b.border}`,
                  borderRadius: '10px', padding: '10px 12px',
                  textDecoration: 'none', fontSize: '0.78rem',
                  fontWeight: 700, textAlign: 'center',
                  display: 'block',
                }}
              >
                {b.label}
              </Link>
            ))}
          </div>

          {/* Wait time info card */}
          <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
            <div style={{ background: '#fef9c3', padding: '10px 18px', borderBottom: '1.5px solid #fde68a' }}>
              <h2 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 800, color: '#92400e', letterSpacing: '0.04em' }}>
                ⏱️ LIVE WAIT TIMES
              </h2>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {waitingList.length === 0 ? (
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: '8px' }}>No patients in queue</p>
              ) : (
                waitingList.slice(0, 4).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ background: '#f3e8ff', color: '#7c3aed', padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, flexShrink: 0 }}>
                      #{a.queuePosition}
                    </span>
                    <span style={{ flex: 1, fontSize: '0.82rem', color: '#1e293b', fontWeight: 600 }}>{a.patientName}</span>
                    <span style={{ background: a.waitingTime === 0 ? '#dcfce7' : '#fff7ed', color: a.waitingTime === 0 ? '#16a34a' : '#ea580c', padding: '2px 8px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', border: `1px solid ${a.waitingTime === 0 ? '#bbf7d0' : '#fed7aa'}` }}>
                      {a.waitingTime != null ? (a.waitingTime === 0 ? '🟢 Next' : `⏳ ~${a.waitingTime} min`) : '—'}
                    </span>
                  </div>
                ))
              )}
              <Link to="/reception/doctor-delay"
                style={{ marginTop: '4px', background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px', textDecoration: 'none', fontSize: '0.78rem', fontWeight: 700, textAlign: 'center', display: 'block' }}>
                ⚡ Update Doctor Delay →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ReceptionDashboard