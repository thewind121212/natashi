import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PlayerProvider } from './contexts/PlayerContext';
import { LoginPage } from './components/LoginPage';
import { Loader2 } from 'lucide-react';
import './App.css';

const AudioPlay = lazy(() => import('./pages/AudioPlay'));
const BotController = lazy(() => import('./pages/BotController'));

function AppContent() {
  const { isAuthenticated, isLoading, forceLogout } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <PlayerProvider onUnauthorized={forceLogout}>
      <Suspense
        fallback={(
          <div className="min-h-screen bg-slate-900 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          </div>
        )}
      >
        <Routes>
          <Route path="/" element={<AudioPlay />} />
          <Route path="/bot" element={<BotController />} />
        </Routes>
      </Suspense>
    </PlayerProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
