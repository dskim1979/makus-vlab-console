import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { FeaturesProvider } from './features';
import { BrandingProvider } from './branding';
import { I18nProvider } from './i18n';
import './styles.css';


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
