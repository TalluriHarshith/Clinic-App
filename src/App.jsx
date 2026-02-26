import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { NotificationProvider } from './context/NotificationContext'
import Login from './pages/Login'
import Navbar from './components/Navbar'
import Dashboard from './pages/Dashboard'
import Appointments from './pages/Appointments'
import LabReports from './pages/LabReports'
import Inventory from './pages/Inventory'
// Doctor
import DoctorDashboard from './pages/doctor/DoctorDashboard'
import DoctorAvailability from './pages/doctor/DoctorAvailability'
import DoctorAppointments from './pages/doctor/DoctorAppointments'
import DoctorPrescriptions from './pages/doctor/DoctorPrescriptions'
import DoctorProfile from './pages/doctor/DoctorProfile'
// Patient
import PatientDashboard from './pages/patient/PatientDashboard'
import BookAppointment from './pages/patient/BookAppointment'
import PatientAppointments from './pages/patient/PatientAppointments'
import PatientPrescriptions from './pages/patient/PatientPrescriptions'
// Reception
import ReceptionDashboard from './pages/reception/ReceptionDashboard'
import ReceptionAppointments from './pages/reception/ReceptionAppointments'
import ReceptionDoctors from './pages/reception/ReceptionDoctors'
import DoctorDelayManager from './pages/reception/DoctorDelayManager'
import AnnouncementsManager from './pages/reception/AnnouncementsManager'
// Public
import QueueDisplay from './pages/QueueDisplay'
import './App.css'

function RoleRedirect() {
  const { user, userRole } = useAuth()

  if (!user) return <Navigate to="/" replace />

  // ✅ Wait until role is loaded — don't redirect prematurely
  if (userRole === null) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column', gap: '1rem'
      }}>
        <div style={{ fontSize: '3rem' }}>🏥</div>
        <p style={{ color: '#64748b', fontSize: '1rem' }}>Loading your portal...</p>
      </div>
    )
  }

  if (userRole === 'doctor') return <Navigate to="/doctor/dashboard" replace />
  if (userRole === 'patient') return <Navigate to="/patient/dashboard" replace />
  if (userRole === 'reception') return <Navigate to="/reception/dashboard" replace />

  // Fallback
  return <Navigate to="/dashboard" replace />
}

function ProtectedRoute({ children }) {
  const { user, userRole } = useAuth()
  if (!user) return <Navigate to="/" replace />
  if (userRole === null) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ fontSize: '3rem' }}>🏥</div>
      <p style={{ color: '#64748b' }}>Loading...</p>
    </div>
  )
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <>
      {user && <Navbar />}
      <Routes>
        {/* Auth */}
        <Route path="/" element={!user ? <Login /> : <RoleRedirect />} />

        {/* Legacy */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/appointments" element={<ProtectedRoute><Appointments /></ProtectedRoute>} />
        <Route path="/lab-reports" element={<ProtectedRoute><LabReports /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />

        {/* Doctor Portal */}
        <Route path="/doctor/dashboard" element={<ProtectedRoute><DoctorDashboard /></ProtectedRoute>} />
        <Route path="/doctor/appointments" element={<ProtectedRoute><DoctorAppointments /></ProtectedRoute>} />
        <Route path="/doctor/availability" element={<ProtectedRoute><DoctorAvailability /></ProtectedRoute>} />
        <Route path="/doctor/prescriptions" element={<ProtectedRoute><DoctorPrescriptions /></ProtectedRoute>} />
        <Route path="/doctor/profile" element={<ProtectedRoute><DoctorProfile /></ProtectedRoute>} />

        {/* Patient Portal */}
        <Route path="/patient/dashboard" element={<ProtectedRoute><PatientDashboard /></ProtectedRoute>} />
        <Route path="/patient/book" element={<ProtectedRoute><BookAppointment /></ProtectedRoute>} />
        <Route path="/patient/appointments" element={<ProtectedRoute><PatientAppointments /></ProtectedRoute>} />
        <Route path="/patient/prescriptions" element={<ProtectedRoute><PatientPrescriptions /></ProtectedRoute>} />

        {/* Reception Portal */}
        <Route path="/reception/dashboard" element={<ProtectedRoute><ReceptionDashboard /></ProtectedRoute>} />
        <Route path="/reception/appointments" element={<ProtectedRoute><ReceptionAppointments /></ProtectedRoute>} />
        <Route path="/reception/doctors" element={<ProtectedRoute><ReceptionDoctors /></ProtectedRoute>} />
        <Route path="/reception/doctor-delay" element={<ProtectedRoute><DoctorDelayManager /></ProtectedRoute>} />
        <Route path="/reception/announcements" element={<ProtectedRoute><AnnouncementsManager /></ProtectedRoute>} />

        {/* Public — No login required (waiting room TV board) */}
        <Route path="/queue-display" element={<QueueDisplay />} />
      </Routes>
    </>
  )
}

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </NotificationProvider>
    </AuthProvider>
  )
}

export default App