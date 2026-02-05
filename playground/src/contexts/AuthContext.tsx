import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already authenticated
    fetch('/auth/me')
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
    window.location.href = '/auth/discord';
  };

  const logout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' });
      setUser(null);
      // Reload to clear any cached state
      window.location.reload();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
