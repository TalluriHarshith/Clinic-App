import { createContext, useContext, useEffect, useState, useRef } from 'react'
import {
    collection,
    onSnapshot,
    addDoc,
    updateDoc,
    doc,
    query,
    where,
    getDocs,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/firebase'
import { useAuth } from './AuthContext'

const NotificationContext = createContext()

const REMINDER_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

export function NotificationProvider({ children }) {
    const { userRole } = useAuth()
    const [notifications, setNotifications] = useState([])
    const [unreadCount, setUnreadCount] = useState(0)
    const intervalRef = useRef(null)

    // ─── Listen to unread reception notifications in real-time ───────────────
    useEffect(() => {
        if (userRole !== 'reception') return

        const q = query(
            collection(db, 'receptionNotifications'),
            where('read', '==', false)
        )

        const unsub = onSnapshot(q, (snap) => {
            const notifs = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => {
                    const ta = a.createdAt?.toMillis?.() ?? 0
                    const tb = b.createdAt?.toMillis?.() ?? 0
                    return tb - ta
                })
            setNotifications(notifs)
            setUnreadCount(notifs.length)
        })

        return () => unsub()
    }, [userRole])

    // ─── 15-minute auto-reminder engine (only for reception role) ────────────
    useEffect(() => {
        if (userRole !== 'reception') return

        const checkAndNotify = async () => {
            const today = new Date().toISOString().split('T')[0]
            const q = query(
                collection(db, 'doctorDelayTrackers'),
                where('active', '==', true),
                where('date', '==', today),
                where('doctorStatus', '==', 'Pending')
            )

            const snap = await getDocs(q)
            const now = Date.now()

            for (const trackerDoc of snap.docs) {
                const data = trackerDoc.data()

                // Determine last reference time (lastNotifiedAt or arrivalConfirmedAt)
                const lastTime = data.lastNotifiedAt
                    ? (data.lastNotifiedAt.toMillis?.() ?? new Date(data.lastNotifiedAt).getTime())
                    : (data.arrivalConfirmedAt
                        ? new Date(data.arrivalConfirmedAt).getTime()
                        : null)

                if (!lastTime) continue

                const elapsed = now - lastTime

                if (elapsed >= REMINDER_INTERVAL_MS) {
                    // Write in-app notification for receptionist
                    await addDoc(collection(db, 'receptionNotifications'), {
                        type: 'doctor_delay',
                        doctorId: data.doctorId,
                        doctorName: data.doctorName,
                        message: `⏰ ${data.doctorName} has not arrived yet. Please update their status.`,
                        createdAt: serverTimestamp(),
                        read: false,
                        trackerId: trackerDoc.id,
                    })

                    // Update lastNotifiedAt on the tracker
                    await updateDoc(doc(db, 'doctorDelayTrackers', trackerDoc.id), {
                        lastNotifiedAt: Timestamp.now(),
                    })
                }
            }
        }

        // Run immediately, then every 60 seconds (checks if 15 min threshold crossed)
        checkAndNotify()
        intervalRef.current = setInterval(checkAndNotify, 60 * 1000)

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [userRole])

    // ─── Mark a single notification as read ──────────────────────────────────
    const markAsRead = async (id) => {
        await updateDoc(doc(db, 'receptionNotifications', id), { read: true })
    }

    // ─── Mark all notifications as read ──────────────────────────────────────
    const markAllAsRead = async () => {
        const promises = notifications.map((n) =>
            updateDoc(doc(db, 'receptionNotifications', n.id), { read: true })
        )
        await Promise.all(promises)
    }

    return (
        <NotificationContext.Provider
            value={{ notifications, unreadCount, markAsRead, markAllAsRead }}
        >
            {children}
        </NotificationContext.Provider>
    )
}

export function useNotifications() {
    return useContext(NotificationContext)
}
