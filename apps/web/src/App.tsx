import { Navigate, Route, Routes } from 'react-router-dom';
import { PatientShell } from './ui';
import { RequireAuth, homePathForRole } from './auth/RequireAuth';
import { useSession } from './auth/useSession';
import { SplashPage } from './pages/auth/SplashPage';
import { WelcomePage } from './pages/auth/WelcomePage';
import { HomePage } from './pages/patient/HomePage';
import { SubmitFollowUpPage } from './pages/patient/SubmitFollowUpPage';
import { FollowUpHistoryPage } from './pages/patient/FollowUpHistoryPage';
import { ResponseDetailPage } from './pages/patient/ResponseDetailPage';
import { DoctorDashboardPage } from './pages/doctor/DoctorDashboardPage';
import { Placeholder } from './pages/Placeholder';

/**
 * App routes, grouped by portal:
 *   /splash             public welcome splash (Get Started)
 *   /welcome            public auth (OAuth + SMS OTP)
 *   /app/*              patient portal (bottom-tab shell)
 *   /doctor, /admin     doctor + admin portals
 *
 * Role-aware guards (RequireAuth) gate each group; the API + RLS remain the
 * real authorization boundary.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/splash" element={<SplashPage />} />
      <Route path="/welcome" element={<WelcomePage />} />

      {/* Patient full-screen flows (outside the tab shell) */}
      <Route
        path="/app/submit"
        element={
          <RequireAuth roles={['patient', 'caregiver']}>
            <SubmitFollowUpPage />
          </RequireAuth>
        }
      />
      <Route
        path="/app/rows/:rowId/response"
        element={
          <RequireAuth roles={['patient', 'caregiver']}>
            <ResponseDetailPage />
          </RequireAuth>
        }
      />

      {/* Patient portal (tab shell) */}
      <Route
        path="/app/*"
        element={
          <RequireAuth roles={['patient', 'caregiver']}>
            <PatientRoutes />
          </RequireAuth>
        }
      />

      {/* Doctor portal */}
      <Route
        path="/doctor/*"
        element={
          <RequireAuth roles={['doctor']}>
            <DoctorDashboardPage />
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

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}

/** Send signed-in users to their portal; everyone else to the splash. */
function RootRedirect() {
  const session = useSession();
  return <Navigate to={session ? homePathForRole(session.role) : '/splash'} replace />;
}

/** Patient tab routes rendered inside the bottom-tab shell. */
function PatientRoutes() {
  return (
    <PatientShell>
      <Routes>
        <Route path="home" element={<HomePage />} />
        <Route path="chart" element={<FollowUpHistoryPage />} />
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
