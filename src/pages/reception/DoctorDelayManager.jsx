import { useEffect, useState } from 'react'
import {
    collection, onSnapshot, query, where,
    updateDoc, doc, addDoc, serverTimestamp, Timestamp, getDocs,
} from 'firebase/firestore'
import { db } from '../../firebase/firebase'
import { recalculateQueue } from '../../utils/queueEngine'

/* ─── Status config ──────────────────────────────── */
const STATUS_CONFIG = {
    Pending: { bg: '#fef9c3', color: '#ca8a04', icon: '⏳', label: 'Pending Arrival' },
    Arrived: { bg: '#dcfce7', color: '#16a34a', icon: '✅', label: 'Doctor Arrived' },
    Delayed: { bg: '#ffedd5', color: '#ea580c', icon: '⚠️', label: 'Delayed' },
    'Not Available': { bg: '#fee2e2', color: '#dc2626', icon: '❌', label: 'Not Available' },
}

/* ─── Live elapsed timer hook ────────────────────── */
function useElapsed(isoTimestamp) {
    const [elapsed, setElapsed] = useState('')
    useEffect(() => {
        const tick = () => {
            if (!isoTimestamp) { setElapsed('—'); return }
            const diff = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000)
            const h = Math.floor(diff / 3600)
            const m = Math.floor((diff % 3600) / 60)
            const s = diff % 60
            setElapsed(h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`)
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [isoTimestamp])
    return elapsed
}

/* ─── Inline delay editor ────────────────────────── */
function DelayEditor({ tracker, onSave }) {
    const [minutes, setMinutes] = useState(tracker.delayMinutes ?? 0)
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        await onSave(tracker, minutes)
        setSaving(false)
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 600 }}>Doctor delay:</span>
            <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', background: '#f8fafc' }}>
                <button
                    onClick={() => setMinutes(m => Math.max(0, m - 5))}
                    style={{ padding: '4px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#475569', fontWeight: 700 }}
                >−</button>
                <input
                    type="number"
                    min="0"
                    max="240"
                    step="5"
                    value={minutes}
                    onChange={e => setMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ width: '52px', textAlign: 'center', border: 'none', background: 'none', fontSize: '0.9rem', fontWeight: 700, color: '#1e293b', outline: 'none' }}
                />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', paddingRight: '8px' }}>min</span>
                <button
                    onClick={() => setMinutes(m => m + 5)}
                    style={{ padding: '4px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#475569', fontWeight: 700 }}
                >+</button>
            </div>
            <button
                onClick={handleSave}
                disabled={saving}
                style={{ background: saving ? '#94a3b8' : '#7c3aed', color: '#fff', border: 'none', borderRadius: '7px', padding: '6px 14px', cursor: saving ? 'default' : 'pointer', fontSize: '0.82rem', fontWeight: 700 }}
            >
                {saving ? '...' : '⚡ Apply to All'}
            </button>
            {tracker.delayMinutes > 0 && (
                <span style={{ fontSize: '0.75rem', color: '#ea580c', fontWeight: 600 }}>
                    Current: {tracker.delayMinutes} min delay
                </span>
            )}
        </div>
    )
}

/* ─── Tracker card ───────────────────────────────── */
function TrackerCard({ tracker, doctors, onUpdateStatus, onUpdateDelay }) {
    const elapsed = useElapsed(tracker.arrivalConfirmedAt)
    const cfg = STATUS_CONFIG[tracker.doctorStatus] || STATUS_CONFIG.Pending
    const isActive = tracker.active && tracker.doctorStatus !== 'Arrived'
    const doctor = doctors[tracker.doctorId] || {}
    const consultDuration = doctor.consultationDuration || 20

    return (
        <div style={{
            background: '#fff', borderRadius: '14px',
            padding: '1.5rem',
            boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
            borderLeft: `5px solid ${cfg.color}`,
            display: 'flex', flexDirection: 'column', gap: '1rem',
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', flexShrink: 0 }}>
                    👨‍⚕️
                </div>
                <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#1e293b' }}>{tracker.doctorName}</h3>
                    <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
                        {doctor.specialization || '—'} · ⏱️ {consultDuration} min/patient
                    </p>
                    <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '0.75rem' }}>
                        First arrival at: {tracker.arrivalConfirmedAt
                            ? new Date(tracker.arrivalConfirmedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                            : '—'}
                    </p>
                </div>
                <span style={{ background: cfg.bg, color: cfg.color, padding: '5px 14px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 700, border: `1px solid ${cfg.color}33`, whiteSpace: 'nowrap' }}>
                    {cfg.icon} {cfg.label}
                </span>
            </div>

            {/* Live stats row */}
            {isActive && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                        { label: 'ELAPSED', value: elapsed, color: '#7c3aed', mono: true },
                        { label: 'WAITING PATIENTS', value: tracker.waitingPatients ?? '—', color: '#2563eb' },
                        { label: 'CURRENT DELAY', value: tracker.delayMinutes > 0 ? `${tracker.delayMinutes} min` : 'None', color: tracker.delayMinutes > 0 ? '#ea580c' : '#16a34a' },
                    ].map(s => (
                        <div key={s.label} style={{ background: '#f8fafc', borderRadius: '10px', padding: '10px 12px' }}>
                            <p style={{ margin: 0, fontSize: '0.62rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.06em' }}>{s.label}</p>
                            <p style={{ margin: 0, fontSize: s.mono ? '1.1rem' : '1.3rem', fontWeight: 800, color: s.color, fontFamily: s.mono ? 'monospace' : 'inherit' }}>{s.value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Delay editor (only when active & pending/delayed) */}
            {isActive && (
                <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 14px' }}>
                    <DelayEditor tracker={tracker} onSave={onUpdateDelay} />
                    <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: '#94a3b8' }}>
                        💡 Formula: Wait = delay + (patients_before × {consultDuration} min). Updating delay recalculates all waiting patients automatically.
                    </p>
                </div>
            )}

            {/* Action buttons */}
            {tracker.active && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {tracker.doctorStatus !== 'Arrived' && (
                        <button onClick={() => onUpdateStatus(tracker, 'Arrived')}
                            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                            ✅ Mark Arrived
                        </button>
                    )}
                    {tracker.doctorStatus !== 'Delayed' && tracker.doctorStatus !== 'Arrived' && (
                        <button onClick={() => onUpdateStatus(tracker, 'Delayed')}
                            style={{ background: '#ea580c', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                            ⚠️ Mark Delayed
                        </button>
                    )}
                    {tracker.doctorStatus !== 'Not Available' && tracker.doctorStatus !== 'Arrived' && (
                        <button onClick={() => onUpdateStatus(tracker, 'Not Available')}
                            style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                            ❌ Not Available
                        </button>
                    )}
                </div>
            )}

            {/* Resolved */}
            {!tracker.active && (
                <div style={{ background: '#dcfce7', borderRadius: '8px', padding: '8px 14px', color: '#16a34a', fontWeight: 600, fontSize: '0.85rem' }}>
                    ✅ Resolved — Doctor arrived. All waiting times reset to 0.
                </div>
            )}
        </div>
    )
}

/* ─── Main page ──────────────────────────────────── */
function DoctorDelayManager() {
    const [trackers, setTrackers] = useState([])
    const [doctors, setDoctors] = useState({})
    const [loading, setLoading] = useState(true)
    const [showResolved, setShowResolved] = useState(false)
    const today = new Date().toISOString().split('T')[0]

    useEffect(() => {
        const q = query(collection(db, 'doctorDelayTrackers'), where('date', '==', today))
        const unsub = onSnapshot(q, snap => {
            setTrackers(snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0)))
            setLoading(false)
        })
        return () => unsub()
    }, [today])

    useEffect(() => {
        return onSnapshot(collection(db, 'doctors'), snap => {
            const m = {}
            snap.docs.forEach(d => { m[d.id] = d.data() })
            setDoctors(m)
        })
    }, [])

    /* Update doctor status (Arrived / Delayed / Not Available) */
    const handleUpdateStatus = async (tracker, newStatus) => {
        const consultDuration = doctors[tracker.doctorId]?.consultationDuration || 20
        const updates = { doctorStatus: newStatus, lastNotifiedAt: Timestamp.now() }

        if (newStatus === 'Arrived') {
            // Doctor arrived → delay = 0, deactivate tracker, recalculate all with 0 delay
            updates.active = false
            updates.arrivedAt = new Date().toISOString()
            updates.delayMinutes = 0
            await updateDoc(doc(db, 'doctorDelayTrackers', tracker.id), updates)
            await recalculateQueue(tracker.doctorId, today, 0, consultDuration)
        } else {
            await updateDoc(doc(db, 'doctorDelayTrackers', tracker.id), updates)
        }

        // Notify receptionist for Delayed / Not Available
        if (newStatus === 'Delayed' || newStatus === 'Not Available') {
            const icon = newStatus === 'Delayed' ? '⚠️' : '❌'
            await addDoc(collection(db, 'receptionNotifications'), {
                type: 'doctor_delay',
                doctorId: tracker.doctorId,
                doctorName: tracker.doctorName,
                message: `${icon} ${tracker.doctorName} is marked as "${newStatus}". Please inform waiting patients.`,
                createdAt: serverTimestamp(),
                read: false,
                trackerId: tracker.id,
            })
        }
    }

    /* Update delay minutes → recalculate ALL waiting patients */
    const handleUpdateDelay = async (tracker, newDelayMinutes) => {
        const consultDuration = doctors[tracker.doctorId]?.consultationDuration || 20

        // 1. Update delay on tracker
        await updateDoc(doc(db, 'doctorDelayTrackers', tracker.id), {
            delayMinutes: newDelayMinutes,
            doctorStatus: newDelayMinutes > 0 ? 'Delayed' : tracker.doctorStatus,
        })

        // 2. Recalculate ALL waiting patients with new delay — single source of truth
        await recalculateQueue(tracker.doctorId, today, newDelayMinutes, consultDuration)

        // 3. Notify receptionist
        await addDoc(collection(db, 'receptionNotifications'), {
            type: 'doctor_delay',
            doctorId: tracker.doctorId,
            doctorName: tracker.doctorName,
            message: `⏰ ${tracker.doctorName} delay updated to ${newDelayMinutes} mins. All patient wait times recalculated.`,
            createdAt: serverTimestamp(),
            read: false,
            trackerId: tracker.id,
        })
    }

    const active = trackers.filter(t => t.active)
    const resolved = trackers.filter(t => !t.active)
    const displayed = showResolved ? trackers : active

    return (
        <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: '#1e293b' }}>⏰ Doctor Delay Manager</h1>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                        Set delay → all patient wait times recalculate automatically · {new Date().toDateString()}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ background: active.length > 0 ? '#fef9c3' : '#dcfce7', color: active.length > 0 ? '#ca8a04' : '#16a34a', padding: '6px 14px', borderRadius: '20px', fontSize: '0.82rem', fontWeight: 700 }}>
                        {active.length > 0 ? `⏳ ${active.length} Active` : '✅ All Clear'}
                    </span>
                    {resolved.length > 0 && (
                        <button onClick={() => setShowResolved(s => !s)}
                            style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>
                            {showResolved ? 'Hide Resolved' : `Show Resolved (${resolved.length})`}
                        </button>
                    )}
                </div>
            </div>

            {/* Summary strip */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                {[
                    { label: 'Active', value: active.length, color: '#7c3aed', bg: '#f3e8ff', icon: '⏳' },
                    { label: 'Delayed', value: trackers.filter(t => t.doctorStatus === 'Delayed').length, color: '#ea580c', bg: '#ffedd5', icon: '⚠️' },
                    { label: 'Not Available', value: trackers.filter(t => t.doctorStatus === 'Not Available').length, color: '#dc2626', bg: '#fee2e2', icon: '❌' },
                    { label: 'Resolved', value: resolved.length, color: '#16a34a', bg: '#dcfce7', icon: '✅' },
                ].map(s => (
                    <div key={s.label} style={{ background: '#fff', borderRadius: '10px', padding: '12px 18px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '10px', flex: '1', minWidth: '130px' }}>
                        <div style={{ background: s.bg, width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>{s.icon}</div>
                        <div>
                            <p style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: s.color }}>{s.value}</p>
                            <p style={{ margin: 0, fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>{s.label}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Cards */}
            {loading ? (
                <p style={{ color: '#94a3b8', textAlign: 'center', padding: '3rem' }}>Loading trackers...</p>
            ) : displayed.length === 0 ? (
                <div style={{ background: '#fff', borderRadius: '14px', padding: '3rem', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>✅</div>
                    <h3 style={{ color: '#1e293b', margin: '0 0 6px' }}>No Active Delay Trackers</h3>
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: 0 }}>
                        Trackers auto-create when a patient physically checks in via the Appointments page.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {displayed.map(tracker => (
                        <TrackerCard
                            key={tracker.id}
                            tracker={tracker}
                            doctors={doctors}
                            onUpdateStatus={handleUpdateStatus}
                            onUpdateDelay={handleUpdateDelay}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export default DoctorDelayManager
