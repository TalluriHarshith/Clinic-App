import { useEffect, useState } from 'react'
import { db } from '../../firebase/firebase'
import {
  collection, onSnapshot, getDocs, updateDoc, doc,
  query, where, addDoc, serverTimestamp, writeBatch
} from 'firebase/firestore'
import { getDoctorTracker } from '../../utils/queueEngine'

const STATUS_COLORS = {
  Scheduled: '#2563eb', Waiting: '#7c3aed',
  'In Consultation': '#0891b2', Completed: '#16a34a', Cancelled: '#dc2626'
}

/* ─────────────────────────────────────────────────────────
 * Core inline recalculation — does NOT re-query Firestore.
 * Takes the current in-memory list + the newly arrived appt,
 * computes queue positions on the spot, and batch-writes all.
 * ───────────────────────────────────────────────────────── */
async function recalculateInMemory(doctorId, date, allAppointments, newlyArrivedId, delayMinutes, consultDuration) {
  // Collect everyone who should now be in the Waiting queue
  const nowWaiting = allAppointments
    .filter(a =>
      a.doctorId === doctorId &&
      a.date === date &&
      (a.status === 'Waiting' || a.id === newlyArrivedId)
    )
    .sort((a, b) => {
      // Sort by physical arrivedAt (or 'now' for the newly arrived patient)
      const ta = a.id === newlyArrivedId ? Date.now() : (a.arrivedAt ? new Date(a.arrivedAt).getTime() : 0)
      const tb = b.id === newlyArrivedId ? Date.now() : (b.arrivedAt ? new Date(b.arrivedAt).getTime() : 0)
      return ta - tb
    })

  if (nowWaiting.length === 0) return

  const total = nowWaiting.length
  const batch = writeBatch(db)

  nowWaiting.forEach((patient, index) => {
    const patientsBefore = index
    const patientsAfter = total - index - 1
    const waitingTime = delayMinutes + (patientsBefore * consultDuration)

    batch.update(doc(db, 'appointments', patient.id), {
      status: patient.id === newlyArrivedId ? 'Waiting' : patient.status,
      arrivedAt: patient.id === newlyArrivedId ? new Date().toISOString() : patient.arrivedAt,
      queuePosition: index + 1,
      patientsBefore,
      patientsAfter,
      waitingTime,
      delayMinutes,
      consultationDuration: consultDuration,
    })
  })

  await batch.commit()
}

function ReceptionAppointments() {
  const [appointments, setAppointments] = useState([])
  const [doctors, setDoctors] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0])
  const [filterStatus, setFilterStatus] = useState('All')

  // ── Real-time listener — receptionist sees live updates instantly ──
  useEffect(() => {
    const unsubAppts = onSnapshot(collection(db, 'appointments'), snap => {
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.timeSlot > b.timeSlot ? 1 : -1)
      setAppointments(all)
      setLoading(false)
    })

    const unsubDoctors = onSnapshot(collection(db, 'doctors'), snap => {
      const dm = {}
      snap.docs.forEach(d => { dm[d.id] = d.data() })
      setDoctors(dm)
    })

    return () => { unsubAppts(); unsubDoctors() }
  }, [])

  /* ── Patient physically arrives → queue recalculates immediately ── */
  const handleArrived = async (appt) => {
    const today = new Date().toISOString().split('T')[0]
    const consultDur = doctors[appt.doctorId]?.consultationDuration || 20

    // Get current doctor delay from tracker (0 if no tracker yet)
    const tracker = await getDoctorTracker(appt.doctorId, today)
    const delayMinutes = tracker?.delayMinutes ?? 0

    // Single batch: sets this patient to Waiting + recalculates everyone
    await recalculateInMemory(
      appt.doctorId, today,
      appointments,          // current in-memory list — no extra Firestore read needed
      appt.id,               // the newly arrived patient
      delayMinutes,
      consultDur
    )

    // Create delay tracker if first patient today
    if (!tracker) {
      await addDoc(collection(db, 'doctorDelayTrackers'), {
        doctorId: appt.doctorId,
        doctorName: appt.doctorName,
        date: today,
        arrivalConfirmedAt: new Date().toISOString(),
        doctorStatus: 'Pending',
        lastNotifiedAt: null,
        active: true,
        delayMinutes: 0,
        waitingPatients: 1,
      })
    } else {
      // Count current Waiting + 1 (the one we just added)
      const waitingNow = appointments.filter(
        a => a.doctorId === appt.doctorId && a.date === today && a.status === 'Waiting'
      ).length + 1
      await updateDoc(doc(db, 'doctorDelayTrackers', tracker.id), {
        waitingPatients: waitingNow,
      })
    }
  }

  /* ── Move Waiting → In Consultation, or In Consultation → Completed ──
     When a patient leaves the Waiting state, everyone behind them moves
     up one position and their wait times reduce automatically.          */
  const handleStatusChange = async (appt, newStatus) => {
    const today = new Date().toISOString().split('T')[0]
    const consultDur = doctors[appt.doctorId]?.consultationDuration || 20

    // 1. Update this patient's status
    await updateDoc(doc(db, 'appointments', appt.id), { status: newStatus })

    // 2. If they just left the Waiting queue → recalculate everyone still waiting
    if (newStatus === 'In Consultation' || newStatus === 'Completed') {
      const tracker = await getDoctorTracker(appt.doctorId, today)
      const delayMinutes = tracker?.delayMinutes ?? 0

      // Remaining waiting patients, sorted by physical arrival time
      const remainingWaiting = appointments
        .filter(a =>
          a.doctorId === appt.doctorId &&
          a.date === today &&
          a.status === 'Waiting' &&
          a.id !== appt.id          // exclude the one we just moved
        )
        .sort((a, b) => {
          const ta = a.arrivedAt ? new Date(a.arrivedAt).getTime() : 0
          const tb = b.arrivedAt ? new Date(b.arrivedAt).getTime() : 0
          return ta - tb
        })

      if (remainingWaiting.length > 0) {
        const total = remainingWaiting.length
        const batch = writeBatch(db)
        remainingWaiting.forEach((patient, index) => {
          batch.update(doc(db, 'appointments', patient.id), {
            queuePosition: index + 1,
            patientsBefore: index,
            patientsAfter: total - index - 1,
            waitingTime: delayMinutes + (index * consultDur),
            delayMinutes,
            consultationDuration: consultDur,
          })
        })
        await batch.commit()
      }
    }
  }

  const filtered = appointments.filter(a => {
    const matchSearch = !search
      || a.patientName?.toLowerCase().includes(search.toLowerCase())
      || a.doctorName?.toLowerCase().includes(search.toLowerCase())
    const matchDate = !filterDate || a.date === filterDate
    const matchStatus = filterStatus === 'All' || a.status === filterStatus
    return matchSearch && matchDate && matchStatus
  })

  // Summary counts for today
  const today = new Date().toISOString().split('T')[0]
  const todayAppts = appointments.filter(a => a.date === today)
  const waitingCount = todayAppts.filter(a => a.status === 'Waiting').length
  const inConsult = todayAppts.filter(a => a.status === 'In Consultation').length
  const doneCount = todayAppts.filter(a => a.status === 'Completed').length

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>🗂️ All Appointments</h1>
          <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            Live view · mark arrivals below to auto-calculate patient wait times
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { label: '⏳ Waiting', val: waitingCount, bg: '#f3e8ff', color: '#7c3aed' },
            { label: '🩺 In Consult', val: inConsult, bg: '#e0f2fe', color: '#0891b2' },
            { label: '✅ Completed', val: doneCount, bg: '#dcfce7', color: '#16a34a' },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, color: s.color, padding: '6px 14px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 700 }}>
              {s.label}: {s.val}
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem', background: '#fff', padding: '1rem', borderRadius: '10px', boxShadow: '0 2px 8px #0001' }}>
        <input
          placeholder="🔍 Search patient or doctor..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 2, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', minWidth: '200px' }}
        />
        <input
          type="date"
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          style={{ padding: '8px', border: '1px solid #e2e8f0', borderRadius: '8px' }}
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '8px', border: '1px solid #e2e8f0', borderRadius: '8px' }}
        >
          {['All', 'Scheduled', 'Waiting', 'In Consultation', 'Completed', 'Cancelled'].map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={() => { setFilterDate(today); setSearch(''); setFilterStatus('All') }}
          style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
        >
          Today
        </button>
        <button
          onClick={() => { setFilterDate(''); setSearch(''); setFilterStatus('All') }}
          style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading...</p>
      ) : (
        <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px #0001', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['#', 'Patient', 'Doctor', 'Date', 'Time', 'Status', 'Token', 'Wait Time', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 10px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontSize: '0.82rem', color: '#64748b', fontWeight: 700 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No appointments found.</td></tr>
              ) : filtered.map((a, i) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9', background: a.status === 'Waiting' ? '#fdfaff' : '#fff' }}>
                  <td style={{ padding: '10px' }}>{i + 1}</td>
                  <td style={{ padding: '10px', fontWeight: 700 }}>{a.patientName}</td>
                  <td style={{ padding: '10px', color: '#475569' }}>{a.doctorName}</td>
                  <td style={{ padding: '10px', color: '#475569', fontSize: '0.85rem' }}>{a.date}</td>
                  <td style={{ padding: '10px', color: '#475569', fontSize: '0.85rem' }}>{a.timeSlot}</td>

                  {/* Status badge */}
                  <td style={{ padding: '10px' }}>
                    <span style={{
                      background: (STATUS_COLORS[a.status] || '#94a3b8') + '22',
                      color: STATUS_COLORS[a.status] || '#94a3b8',
                      padding: '4px 10px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap'
                    }}>
                      {a.status}
                    </span>
                  </td>

                  {/* Token / Queue position */}
                  <td style={{ padding: '10px' }}>
                    {a.queuePosition != null ? (
                      <span style={{ background: '#f3e8ff', color: '#7c3aed', padding: '3px 10px', borderRadius: '20px', fontSize: '0.82rem', fontWeight: 800 }}>
                        #{a.queuePosition}
                      </span>
                    ) : '—'}
                  </td>

                  {/* Wait time with before/after */}
                  <td style={{ padding: '10px' }}>
                    {a.status === 'Waiting' && a.waitingTime != null ? (
                      <div>
                        <span style={{ color: '#7c3aed', fontWeight: 700, fontSize: '0.88rem' }}>
                          ⏳ ~{a.waitingTime} min
                        </span>
                        <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '2px' }}>
                          {a.patientsBefore ?? 0} before · {a.patientsAfter ?? 0} behind
                        </div>
                      </div>
                    ) : '—'}
                  </td>

                  {/* Action buttons */}
                  <td style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {/* Scheduled → Arrived (triggers queue recalculation) */}
                      {a.status === 'Scheduled' && (
                        <button
                          onClick={() => handleArrived(a)}
                          style={{ background: '#fde68a', color: '#92400e', border: 'none', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }}
                        >
                          ✅ Arrived
                        </button>
                      )}
                      {/* Waiting → In Consultation */}
                      {a.status === 'Waiting' && (
                        <button
                          onClick={() => handleStatusChange(a, 'In Consultation')}
                          style={{ background: '#e0f2fe', color: '#0891b2', border: 'none', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }}
                        >
                          🩺 Start
                        </button>
                      )}
                      {/* In Consultation → Completed */}
                      {a.status === 'In Consultation' && (
                        <button
                          onClick={() => handleStatusChange(a, 'Completed')}
                          style={{ background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }}
                        >
                          ✅ Done
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info banner */}
      <div style={{ marginTop: '1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 14px', fontSize: '0.8rem', color: '#1e40af' }}>
        💡 <strong>How it works:</strong> Click <strong>✅ Arrived</strong> when a patient physically checks in.
        Their waiting time auto-calculates as: <strong>doctor delay + (patients before × consultation time)</strong>.
        Patient portal updates instantly in real-time.
      </div>
    </div>
  )
}

export default ReceptionAppointments