import { Navigate, Route, Routes } from 'react-router-dom';
import { PatientShell } from './ui';
import { RequireAuth } from './auth/RequireAuth';
import { WelcomePage } from './pages/auth/WelcomePage';
import { HomePage } from './pages/patient/HomePage';
import { Placeholder } from './pages/Placeholder';

/**
 * App routes, grouped by portal:
 *   /welcome            public auth (OAuth + SMS OTP)
 *   /app/*              patient portal (bottom-tab shell)
 *   /doctor, /admin     doctor + admin portals (scaffolded; built in later WPs)
 *
 * Role-aware guards (RequireAuth) gate each group; the API + RLS remain the
 * real authorization boundary.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/home" replace />} />
      <Route path="/welcome" element={<WelcomePage />} />

      {/* Patient portal */}
      <Route
        path="/app/*"
        element={
          <RequireAuth roles={['patient', 'caregiver']}>
            <PatientRoutes />
          </RequireAuth>
        }
      />

      {/* Doctor portal (scaffold) */}
      <Route
        path="/doctor/*"
        element={
          <RequireAuth roles={['doctor']}>
            <Placeholder
              title="Post-Op Monitoring"
              note="Doctor dashboard — built in a later work package."
            />
          </RequireAuth>
        }
      />

      {/* Admin portal (scaffold) */}
      <Route
        path="/admin/*"
        element={
          <RequireAuth roles={['admin']}>
            <Placeholder
              title="Admin Console"
              note="Hospital registry + onboarding — built in a later work package."
            />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/app/home" replace />} />
    </Routes>
  );
}

/** Patient tab routes rendered inside the bottom-tab shell. */
function PatientRoutes() {
  return (
    <PatientShell>
      <Routes>
        <Route path="home" element={<HomePage />} />
        <Route
          path="chart"
          element={<Placeholder title="Chart" note="Your post-op flow chart." />}
        />
        <Route path="chat" element={<Placeholder title="Chat" note="Message your care team." />} />
        <Route
          path="care-team"
          element={<Placeholder title="Care Team" note="Your doctors and consultations." />}
        />
        <Route
          path="profile"
          element={<Placeholder title="Profile" note="Account and preferences." />}
        />
        <Route path="*" element={<Navigate to="/app/home" replace />} />
      </Routes>
    </PatientShell>
  );
}
