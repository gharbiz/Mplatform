import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Navigation } from './components/Navigation';
import { Hero } from './components/Hero';
import { Features } from './components/Features';
import { PreFooter } from './components/PreFooter';
import { Footer } from './components/Footer';
import { StrategyPage } from './pages/StrategyPage';
import { StrategyResultPage } from './pages/StrategyResultPage';
import { PricingPage } from './pages/PricingPage';
import { SignUpPage } from './pages/SignUpPage';
import { SignInPage } from './pages/SignInPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { DashboardLayout } from './pages/dashboard/DashboardLayout';
import { DashboardHomePage } from './pages/dashboard/DashboardHomePage';
import { MyBusinessesPage } from './pages/dashboard/MyBusinessesPage';
import { MarketingStrategiesPage } from './pages/dashboard/MarketingStrategiesPage';
import { SavedStrategyPage } from './pages/dashboard/SavedStrategyPage';
import { ContentCreationPage } from './pages/dashboard/ContentCreationPage';
import { IdealCustomerProfilesPage } from './pages/dashboard/IdealCustomerProfilesPage';
import { SmmStrategiesPage } from './pages/dashboard/SmmStrategiesPage';
import { AccountContextBuilderPage } from './pages/dashboard/AccountContextBuilderPage';
import { BalancePage } from './pages/dashboard/BalancePage';
import { CheckoutPage } from './pages/CheckoutPage';
import { supabase } from './lib/supabase';
import { LanguageProvider } from './lib/i18n';

function HomePage() {
  const [redirect, setRedirect] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setRedirect(true);
    });
  }, []);

  if (redirect) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      <Hero />
      <Features />
      <PreFooter />
      <Footer />
    </div>
  );
}

function AppContent() {
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(() => setAuthInitialized(true)).catch(() => setAuthInitialized(true));

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {});
    return () => { authListener?.subscription.unsubscribe(); };
  }, []);

  if (!authInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <LanguageProvider>
    <Router>
      <Routes>
        {/* Public */}
        <Route path="/" element={<HomePage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/strategy" element={<StrategyPage />} />
        <Route path="/strategy/:domain" element={<StrategyResultPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Dashboard */}
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardHomePage />} />
          <Route path="businesses" element={<MyBusinessesPage />} />
          <Route path="strategies" element={<MarketingStrategiesPage />} />
          <Route path="strategies/:id" element={<SavedStrategyPage />} />
          <Route path="content" element={<ContentCreationPage />} />
          <Route path="icp" element={<IdealCustomerProfilesPage />} />
          <Route path="smm" element={<SmmStrategiesPage />} />
          <Route path="account-context-builder" element={<AccountContextBuilderPage />} />
          <Route path="balance" element={<BalancePage />} />
        </Route>
        <Route path="/checkout" element={<CheckoutPage />} />
      </Routes>
    </Router>
    </LanguageProvider>
  );
}

export default function App() {
  return <AppContent />;
}
