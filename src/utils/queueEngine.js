/**
 * Queue Recalculation Engine
 *
 * Single source of truth for all queue position, waiting time,
 * and patients-before/after calculations.
 *
 * Formula:
 *   waiting_time = doctor_delay_minutes + (patients_before × avg_consultation_minutes)
 *
 * Queue order = physical arrival time (arrivedAt), NOT booked appointment time.
 */

import {
    collection, query, where, getDocs,
    updateDoc, doc, writeBatch
} from 'firebase/firestore'
import { db } from '../firebase/firebase'

/**
 * Recalculates and writes queue position + waiting time for
 * ALL Waiting patients of a given doctor on a given date.
 *
 * Called whenever:
 *  - A patient physically arrives (handleArrived)
 *  - Doctor delay minutes change
 *  - Doctor status changes to Arrived (delay → 0)
 *
 * @param {string} doctorId
 * @param {string} date          "YYYY-MM-DD"
 * @param {number} delayMinutes  Current doctor delay in minutes (0 if doctor arrived)
 * @param {number} consultationDuration  Average minutes per patient
 */
export async function recalculateQueue(doctorId, date, delayMinutes = 0, consultationDuration = 20) {
    // Fetch all active (Waiting) patients for this doctor today
    const q = query(
        collection(db, 'appointments'),
        where('doctorId', '==', doctorId),
        where('date', '==', date),
        where('status', '==', 'Waiting')
    )
    const snap = await getDocs(q)
    if (snap.empty) return

    // Sort by physical arrival time (arrivedAt) — this is THE queue order
    const patients = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
            const ta = a.arrivedAt ? new Date(a.arrivedAt).getTime() : 0
            const tb = b.arrivedAt ? new Date(b.arrivedAt).getTime() : 0
            return ta - tb
        })

    const totalPatients = patients.length
    const batch = writeBatch(db)

    patients.forEach((patient, index) => {
        const patientsBefore = index          // patients ahead in queue
        const patientsAfter = totalPatients - index - 1

        // Core formula
        const waitingTime = delayMinutes + (patientsBefore * consultationDuration)

        batch.update(doc(db, 'appointments', patient.id), {
            queuePosition: index + 1,          // 1-indexed
            patientsBefore,
            patientsAfter,
            waitingTime,                        // total estimated wait in minutes
            delayMinutes,                       // store for transparency
            consultationDuration,
        })
    })

    await batch.commit()
}

/**
 * Get the active delay tracker for a doctor on a given date.
 * Returns the tracker doc data or null.
 */
export async function getDoctorTracker(doctorId, date) {
    const q = query(
        collection(db, 'doctorDelayTrackers'),
        where('doctorId', '==', doctorId),
        where('date', '==', date),
        where('active', '==', true)
    )
    const snap = await getDocs(q)
    if (snap.empty) return null
    const d = snap.docs[0]
    return { id: d.id, ...d.data() }
}
