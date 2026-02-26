import { useEffect, useState } from 'react'
import {
    collection, onSnapshot, addDoc, updateDoc, deleteDoc,
    doc, query, where, serverTimestamp, orderBy
} from 'firebase/firestore'
import { db } from '../../firebase/firebase'

function AnnouncementsManager() {
    const [announcements, setAnnouncements] = useState([])
    const [text, setText] = useState('')
    const [adding, setAdding] = useState(false)

    useEffect(() => {
        const q = query(collection(db, 'announcements'))
        return onSnapshot(q, snap => {
            setAnnouncements(
                snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
            )
        })
    }, [])

    const handleAdd = async () => {
        if (!text.trim()) return
        setAdding(true)
        await addDoc(collection(db, 'announcements'), {
            text: text.trim(),
            active: true,
            createdAt: serverTimestamp(),
        })
        setText('')
        setAdding(false)
    }

    const toggleActive = async (id, current) => {
        await updateDoc(doc(db, 'announcements', id), { active: !current })
    }

    const handleDelete = async (id) => {
        await deleteDoc(doc(db, 'announcements', id))
    }

    return (
        <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ marginBottom: '1.5rem' }}>
                <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#1e293b' }}>
                    📢 Announcements Manager
                </h1>
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                    Manage scrolling announcements shown on the public Queue Display board
                </p>
            </div>

            {/* Add Announcement */}
            <div style={{
                background: '#fff', borderRadius: '12px',
                padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                marginBottom: '1.5rem', border: '1px solid #e2e8f0'
            }}>
                <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>
                    + Add New Announcement
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                        value={text}
                        onChange={e => setText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        placeholder="e.g. Dr. Sharma is running 15 mins late..."
                        style={{
                            flex: 1, padding: '10px 14px',
                            border: '1px solid #e2e8f0', borderRadius: '8px',
                            fontSize: '0.9rem', outline: 'none',
                        }}
                    />
                    <button
                        onClick={handleAdd}
                        disabled={adding || !text.trim()}
                        style={{
                            background: adding ? '#94a3b8' : '#2563eb',
                            color: '#fff', border: 'none', borderRadius: '8px',
                            padding: '10px 20px', cursor: adding ? 'default' : 'pointer',
                            fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap',
                        }}
                    >
                        {adding ? 'Adding...' : '📢 Publish'}
                    </button>
                </div>
            </div>

            {/* Announcement List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {announcements.length === 0 ? (
                    <div style={{
                        background: '#fff', borderRadius: '12px', padding: '3rem',
                        textAlign: 'center', color: '#94a3b8', boxShadow: '0 1px 4px rgba(0,0,0,0.05)'
                    }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📢</div>
                        <p style={{ margin: 0 }}>No announcements yet. Add one above!</p>
                    </div>
                ) : (
                    announcements.map(a => (
                        <div key={a.id} style={{
                            background: '#fff', borderRadius: '10px',
                            padding: '12px 16px',
                            display: 'flex', alignItems: 'center', gap: '12px',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                            border: `1.5px solid ${a.active ? '#fde68a' : '#e2e8f0'}`,
                            opacity: a.active ? 1 : 0.6,
                        }}>
                            <span style={{ fontSize: '1.2rem' }}>
                                {a.active ? '🟢' : '⚫'}
                            </span>
                            <span style={{ flex: 1, fontSize: '0.9rem', color: '#334155', fontWeight: a.active ? 600 : 400 }}>
                                {a.text}
                            </span>
                            <span style={{
                                background: a.active ? '#fef9c3' : '#f1f5f9',
                                color: a.active ? '#ca8a04' : '#94a3b8',
                                padding: '3px 10px', borderRadius: '20px',
                                fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap'
                            }}>
                                {a.active ? '📺 Showing on Board' : 'Hidden'}
                            </span>
                            <button
                                onClick={() => toggleActive(a.id, a.active)}
                                style={{
                                    background: a.active ? '#f1f5f9' : '#dcfce7',
                                    color: a.active ? '#64748b' : '#16a34a',
                                    border: 'none', borderRadius: '6px',
                                    padding: '5px 12px', cursor: 'pointer',
                                    fontSize: '0.78rem', fontWeight: 600,
                                }}
                            >
                                {a.active ? '⏸ Hide' : '▶ Show'}
                            </button>
                            <button
                                onClick={() => handleDelete(a.id)}
                                style={{
                                    background: '#fee2e2', color: '#dc2626',
                                    border: 'none', borderRadius: '6px',
                                    padding: '5px 10px', cursor: 'pointer',
                                    fontSize: '0.78rem', fontWeight: 600,
                                }}
                            >
                                🗑️
                            </button>
                        </div>
                    ))
                )}
            </div>

            {/* Board Link */}
            <div style={{
                marginTop: '1.5rem', background: '#eff6ff',
                border: '1px solid #bfdbfe', borderRadius: '10px',
                padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px'
            }}>
                <span style={{ fontSize: '1.2rem' }}>📺</span>
                <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 700, color: '#1e40af', fontSize: '0.88rem' }}>
                        Queue Display Board URL
                    </p>
                    <p style={{ margin: 0, color: '#3b82f6', fontSize: '0.8rem' }}>
                        Open this link on the waiting room TV/monitor:
                    </p>
                </div>
                <a
                    href="/queue-display"
                    target="_blank"
                    rel="noreferrer"
                    style={{
                        background: '#2563eb', color: '#fff',
                        padding: '8px 16px', borderRadius: '8px',
                        textDecoration: 'none', fontSize: '0.82rem', fontWeight: 700,
                        whiteSpace: 'nowrap',
                    }}
                >
                    📺 Open Board →
                </a>
            </div>
        </div>
    )
}

export default AnnouncementsManager
