import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "./api";

export type SessionEmployee = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "employee";
  profilePhotoUrl: string | null;
};

type AuthContextValue = {
  employee: SessionEmployee | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<SessionEmployee>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [employee, setEmployee] = useState<SessionEmployee | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = async () => {
    try {
      const data = await apiFetch<{ employee: SessionEmployee }>("/auth/me");
      setEmployee(data.employee);
    } catch {
      setEmployee(null);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const value = useMemo<AuthContextValue>(() => ({
    employee,
    ready,
    refresh,
    async login(username, password) {
      const data = await apiFetch<{ employee: SessionEmployee }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setEmployee(data.employee);
      return data.employee;
    },
    async logout() {
      await apiFetch<void>("/auth/logout", { method: "POST" });
      setEmployee(null);
    },
  }), [employee, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}