import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminHome } from './admin/AdminHome';
import { AdminModule } from './admin/AdminModule';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './auth/PasswordResetPages';
import { SignupPage, SignupVerifyPage } from './auth/SignupPage';
import { KioskPage } from './kiosk/KioskPage';
import { Shell } from './components/Shell';
import { TermsGate } from './components/Terms';
import { useI18n } from './i18n';
import { PortalHome } from './portal/PortalHome';
import { DataPage } from './portal/DataPage';
import { ReservePage } from './portal/ReservePage';
import { ResourcesPage } from './portal/ResourcesPage';

function RequireAuth({ admin = false, children }: { admin?: boolean; children: ReactNode }) {
  const { loading, user, isAdmin } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (loading) return <div className="center muted">{t('app.loading')}</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && !isAdmin) return <Shell><div className="center">{t('admin.notAdmin')}</div></Shell>;
  return <TermsGate><Shell>{children}</Shell></TermsGate>;
}

export function App() {
  const { loading, user, isAdmin } = useAuth();
  return (
    <Routes>
      <Route path="/kiosk" element={<KioskPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/signup/verify" element={<SignupVerifyPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/login" element={!loading && user ? <Navigate to={isAdmin ? '/admin' : '/'} replace /> : <LoginPage />} />
      <Route path="/" element={<RequireAuth><PortalHome /></RequireAuth>} />
      <Route path="/resources" element={<RequireAuth><ResourcesPage /></RequireAuth>} />
      <Route path="/reserve" element={<RequireAuth><ReservePage /></RequireAuth>} />
      <Route path="/data" element={<RequireAuth><DataPage /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth admin><AdminHome /></RequireAuth>} />
      <Route path="/admin/:moduleId" element={<RequireAuth admin><AdminModule /></RequireAuth>} />
      <Route path="/admin/:moduleId/:pageId" element={<RequireAuth admin><AdminModule /></RequireAuth>} />
      <Route path="/admin/:moduleId/:pageId/:subId" element={<RequireAuth admin><AdminModule /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
