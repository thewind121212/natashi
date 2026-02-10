import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface User {
  id: string;
  username: string;
  avatar: string | null;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
  forceLogout: () => void; // Called when session is invalidated (e.g., WebSocket 4401)
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getApiBaseUrl(): string {
  const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (apiBase && apiBase.trim()) {
    return apiBase.trim().replace(/\/$/, ''); // Remove trailing slash
  }
  return ''; // Empty string = relative paths (same origin)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const apiBase = getApiBaseUrl();

  useEffect(() => {
    // Check if user is already authenticated
    fetch(`${apiBase}/auth/me`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch user:', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = () => {
    // Redirect to Discord OAuth
    window.location.href = `${apiBase}/auth/discord`;
  };

  const logout = async () => {
    try {
      await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' });
      setUser(null);
      // Reload to clear any cached state
      window.location.reload();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const forceLogout = () => {
    // Immediately clear user state without API call (session already invalid)
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        forceLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
