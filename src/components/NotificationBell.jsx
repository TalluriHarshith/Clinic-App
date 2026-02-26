import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useNotifications } from '../context/NotificationContext'
import '../styles/NotificationBell.css'

function timeAgo(ts) {
    if (!ts) return ''
    const ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime()
    const diff = Math.floor((Date.now() - ms) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return `${Math.floor(diff / 3600)}h ago`
}

function NotificationBell() {
    const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()
    const [open, setOpen] = useState(false)
    const [ringing, setRinging] = useState(false)
    const prevCount = useRef(unreadCount)
    const wrapperRef = useRef(null)

    // Ring bell when new notifications arrive
    useEffect(() => {
        if (unreadCount > prevCount.current) {
            setRinging(true)
            setTimeout(() => setRinging(false), 700)
        }
        prevCount.current = unreadCount
    }, [unreadCount])

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    return (
        <div className="notif-bell-wrapper" ref={wrapperRef}>
            <button
                className={`notif-bell-btn${ringing ? ' ringing' : ''}`}
                onClick={() => setOpen((o) => !o)}
                title="Doctor Delay Notifications"
            >
                🔔
                {unreadCount > 0 && (
                    <span className="notif-badge">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="notif-dropdown">
                    {/* Header */}
                    <div className="notif-dropdown-header">
                        <h4>🔔 Delay Alerts ({unreadCount})</h4>
                        {unreadCount > 0 && (
                            <button className="notif-mark-all-btn" onClick={markAllAsRead}>
                                Mark all read
                            </button>
                        )}
                    </div>

                    {/* List */}
                    <div className="notif-list">
                        {notifications.length === 0 ? (
                            <div className="notif-empty">
                                <div style={{ fontSize: '1.8rem', marginBottom: '6px' }}>✅</div>
                                No pending alerts
                            </div>
                        ) : (
                            notifications.map((n) => (
                                <div key={n.id} className="notif-item">
                                    <span className="notif-item-msg">{n.message}</span>
                                    <div className="notif-item-meta">
                                        <span className="notif-item-time">
                                            {timeAgo(n.createdAt)}
                                        </span>
                                        <button
                                            className="notif-read-btn"
                                            onClick={() => markAsRead(n.id)}
                                        >
                                            ✓ Dismiss
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Footer */}
                    <div className="notif-footer">
                        <Link to="/reception/doctor-delay" onClick={() => setOpen(false)}>
                            ⏰ Open Doctor Delay Manager →
                        </Link>
                    </div>
                </div>
            )}
        </div>
    )
}

export default NotificationBell
