import { useEffect, useState, useRef } from 'react'
import {
    collection, onSnapshot, query, where, orderBy
} from 'firebase/firestore'
import { db } from '../firebase/firebase'

/* ─── Helpers ────────────────────────────────────────────────────── */
function useClockTick() {
    const [now, setNow] = useState(new Date())
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000)
        return () => clearInterval(id)
    }, [])
    return now
}

function formatTime12(dateObj) {
    return dateObj.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }).toUpperCase()
}

function formatDate(dateObj) {
    return dateObj.toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
}

/* ─── Marquee Announcements ──────────────────────────────────────── */
function AnnouncementTicker({ announcements }) {
    if (!announcements || announcements.length === 0) return null
    const text = announcements.map(a => `📢 ${a.text}`).join('    •    ')
    return (
        <div style={{
            background: '#1e3a5f',
            color: '#fbbf24',
            padding: '10px 0',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            borderTop: '2px solid #fbbf24',
        }}>
            <div style={{
                display: 'inline-block',
                animation: 'marquee 30s linear infinite',
                paddingLeft: '100%',
                fontSize: '1rem',
                fontWeight: 600,
                letterSpacing: '0.03em',
            }}>
                {text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{text}
            </div>
        </div>
    )
}

/* ─── Doctor Queue Panel ─────────────────────────────────────────── */
function DoctorPanel({ doctor, appointments }) {
    const inConsultation = appointments.find(a => a.status === 'In Consultation')
    const waiting = appointments.filter(a => a.status === 'Waiting')
        .sort((a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999))

    const estWait = waiting.length > 0
        ? `${waiting.length * (doctor.consultationDuration || 20)}–${waiting.length * (doctor.consultationDuration || 20) + 5} mins`
        : null

    return (
        <div style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '16px',
            overflow: 'hidden',
            backdropFilter: 'blur(10px)',
        }}>
            {/* Doctor Header */}
            <div style={{
                background: 'linear-gradient(135deg, #1e40af, #1d4ed8)',
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}>
                <div style={{
                    width: '44px', height: '44px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.4rem', flexShrink: 0,
                }}>
                    {doctor.gender === 'female' ? '👩‍⚕️' : '👨‍⚕️'}
                </div>
                <div style={{ flex: 1 }}>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}>
                        {doctor.name?.toUpperCase()}
                    </h2>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#93c5fd', fontWeight: 500 }}>
                        {doctor.specialization}
                    </p>
                </div>
                {estWait && (
                    <div style={{
                        background: 'rgba(251,191,36,0.15)',
                        border: '1px solid rgba(251,191,36,0.4)',
                        borderRadius: '20px',
                        padding: '4px 12px',
                        fontSize: '0.72rem',
                        color: '#fbbf24',
                        fontWeight: 700,
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                    }}>
                        ⏱️ ~{estWait}
                    </div>
                )}
            </div>

            {/* Now Serving */}
            <div style={{ padding: '12px 20px 8px' }}>
                <div style={{
                    background: inConsultation
                        ? 'linear-gradient(135deg, #065f46, #047857)'
                        : 'rgba(255,255,255,0.04)',
                    borderRadius: '10px',
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '8px',
                    border: inConsultation ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.08)',
                }}>
                    <span style={{
                        background: inConsultation ? '#10b981' : '#475569',
                        color: '#fff',
                        fontSize: '0.62rem',
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        letterSpacing: '0.08em',
                        flexShrink: 0,
                    }}>
                        NOW SERVING
                    </span>
                    {inConsultation ? (
                        <>
                            <span style={{
                                background: '#059669',
                                color: '#fff', fontWeight: 800,
                                fontSize: '1rem', padding: '2px 10px',
                                borderRadius: '8px', flexShrink: 0,
                            }}>
                                #{inConsultation.queuePosition ?? '—'}
                            </span>
                            <span style={{ color: '#ecfdf5', fontWeight: 700, fontSize: '0.95rem', flex: 1 }}>
                                {inConsultation.patientName}
                            </span>
                            <span style={{ background: 'rgba(16,185,129,0.2)', color: '#6ee7b7', padding: '3px 8px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700 }}>
                                🩺 IN ROOM
                            </span>
                        </>
                    ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No patient in consultation</span>
                    )}
                </div>

                {/* Waiting List */}
                {waiting.length > 0 ? (
                    <div>
                        <p style={{ margin: '0 0 6px', fontSize: '0.68rem', color: '#64748b', fontWeight: 700, letterSpacing: '0.08em' }}>
                            NEXT IN QUEUE
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {waiting.slice(0, 5).map((a, i) => (
                                <div key={a.id} style={{
                                    display: 'flex', alignItems: 'center', gap: '10px',
                                    background: i === 0 ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.03)',
                                    border: i === 0 ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(255,255,255,0.05)',
                                    borderRadius: '8px', padding: '7px 12px',
                                    transition: 'all 0.2s',
                                }}>
                                    <span style={{
                                        background: i === 0 ? '#7c3aed' : '#334155',
                                        color: '#fff', fontWeight: 800,
                                        fontSize: '0.8rem', padding: '2px 8px',
                                        borderRadius: '6px', minWidth: '32px',
                                        textAlign: 'center',
                                    }}>
                                        #{a.queuePosition ?? (i + 1)}
                                    </span>
                                    <span style={{
                                        color: i === 0 ? '#e9d5ff' : '#cbd5e1',
                                        fontWeight: i === 0 ? 700 : 500,
                                        flex: 1, fontSize: '0.88rem'
                                    }}>
                                        {a.patientName}
                                    </span>
                                    <span style={{
                                        fontSize: '0.68rem',
                                        color: '#94a3b8',
                                        fontWeight: 500,
                                    }}>
                                        ⏳ Waiting
                                    </span>
                                </div>
                            ))}
                            {waiting.length > 5 && (
                                <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#64748b', textAlign: 'center' }}>
                                    +{waiting.length - 5} more in queue
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                    <div style={{ padding: '8px 0', color: '#475569', fontSize: '0.82rem', textAlign: 'center' }}>
                        ✅ No more patients waiting
                    </div>
                )}
            </div>

            {/* Footer */}
            <div style={{ padding: '8px 20px 12px', display: 'flex', gap: '8px' }}>
                <span style={{ background: 'rgba(37,99,235,0.15)', color: '#93c5fd', padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 600 }}>
                    📅 {appointments.length} today
                </span>
                <span style={{ background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 600 }}>
                    ⏳ {waiting.length} waiting
                </span>
                <span style={{ background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 600 }}>
                    ✅ {appointments.filter(a => a.status === 'Completed').length} done
                </span>
            </div>
        </div>
    )
}

/* ─── Main Queue Display ─────────────────────────────────────────── */
function QueueDisplay() {
    const now = useClockTick()
    const [doctors, setDoctors] = useState([])
    const [todayAppts, setTodayAppts] = useState([])
    const [announcements, setAnnouncements] = useState([])
    const today = new Date().toISOString().split('T')[0]

    // Real-time: today's appointments
    useEffect(() => {
        const q = query(collection(db, 'appointments'), where('date', '==', today))
        return onSnapshot(q, snap => {
            setTodayAppts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        })
    }, [today])

    // Real-time: all doctors
    useEffect(() => {
        return onSnapshot(collection(db, 'doctors'), snap => {
            setDoctors(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        })
    }, [])

    // Real-time: active announcements
    useEffect(() => {
        const q = query(collection(db, 'announcements'), where('active', '==', true))
        return onSnapshot(q, snap => {
            setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        })
    }, [])

    // Only show doctors who have appointments today or are available
    const activeDoctors = doctors.filter(doc =>
        todayAppts.some(a => a.doctorId === doc.id)
    )

    const getAppts = (doctorId) =>
        todayAppts.filter(a => a.doctorId === doctorId &&
            ['In Consultation', 'Waiting', 'Completed'].includes(a.status)
        ).sort((a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999))

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(160deg, #0a0f1e 0%, #0d1b3e 40%, #0a1628 100%)',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: "'Segoe UI', Inter, sans-serif",
        }}>
            {/* ── Header Bar ── */}
            <div style={{
                background: 'linear-gradient(90deg, #1e3a8a, #1e40af)',
                padding: '16px 32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                borderBottom: '2px solid rgba(251,191,36,0.4)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{
                        width: '52px', height: '52px',
                        background: 'rgba(255,255,255,0.12)',
                        borderRadius: '14px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.8rem',
                    }}>🏥</div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 900, letterSpacing: '0.06em', color: '#fff' }}>
                            MEDCARE CLINIC
                        </h1>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: '#93c5fd', letterSpacing: '0.04em' }}>
                            CURRENT QUEUE STATUS — LIVE
                        </p>
                    </div>
                </div>

                {/* Live Clock */}
                <div style={{ textAlign: 'right' }}>
                    <div style={{
                        fontSize: '2rem', fontWeight: 900,
                        fontFamily: 'monospace',
                        color: '#fbbf24',
                        letterSpacing: '0.05em',
                    }}>
                        {formatTime12(now)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#93c5fd', marginTop: '2px' }}>
                        {formatDate(now)}
                    </div>
                </div>
            </div>

            {/* ── Queue Grid ── */}
            <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>
                {activeDoctors.length === 0 ? (
                    <div style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        height: '60vh', color: '#475569',
                    }}>
                        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🏥</div>
                        <h2 style={{ color: '#3B82F6', fontSize: '1.4rem' }}>No Active Queues Today</h2>
                        <p style={{ color: '#64748b' }}>Queues will appear here once patients check in</p>
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${Math.min(activeDoctors.length, 3)}, 1fr)`,
                        gap: '20px',
                    }}>
                        {activeDoctors.map(doc => (
                            <DoctorPanel
                                key={doc.id}
                                doctor={doc}
                                appointments={getAppts(doc.id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* ── Live Blink Indicator ── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '8px', gap: '8px',
                background: 'rgba(0,0,0,0.3)',
                fontSize: '0.72rem', color: '#475569',
            }}>
                <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: '#10b981',
                    animation: 'pulse-dot 1.5s ease-in-out infinite',
                    display: 'inline-block',
                }} />
                LIVE — Updates automatically in real-time
            </div>

            {/* ── Announcements Ticker ── */}
            <AnnouncementTicker announcements={announcements} />

            <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(1.3); }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e3a8a; border-radius: 3px; }
      `}</style>
        </div>
    )
}

export default QueueDisplay
