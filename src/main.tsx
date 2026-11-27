import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { FeaturesProvider } from './features';
import { BrandingProvider } from './branding';
import { I18nProvider } from './i18n';
import './styles.css';
import './admin/pages/tables.css';   // after styles.css: its rules refine the shared ones (.menu, .table)
import './console.css';   // design layer v4: tokens are in styles.css, this refines the shared parts
import './themes.css';   // colour themes (html[data-accent], src/theme.ts)


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrandingProvider>
      <AuthProvider>
        <FeaturesProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        </FeaturesProvider>
      </AuthProvider>
      </BrandingProvider>
    </I18nProvider>
  </StrictMode>,
);
