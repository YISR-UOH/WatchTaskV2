import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { initAPIDB, seedRootAdminFromEnv, verifyUser } from "@/utils/APIdb";
import { usePeer } from "@/p2p/PeerContext";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { setAuthUser } = usePeer();

  const emitAuthUserChanged = useCallback((payload) => {
    try {
      window.dispatchEvent(
        new CustomEvent("auth:user-changed", { detail: payload || null })
      );
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      await initAPIDB();
      await seedRootAdminFromEnv();
      const raw = localStorage.getItem("auth.user");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          setUser(parsed);
          setAuthUser(parsed);
          emitAuthUserChanged(parsed);
        } catch {}
      }
      setLoading(false);
    })();
  }, [setAuthUser, emitAuthUserChanged]);

  const login = useCallback(
    async ({ code, password }) => {
      const user = await verifyUser(code, password);
      if (user) {
        const session = {
          code: user.code,
          name: user.name,
          role: user.role,
          speciality: user.speciality,
        };
        setUser(session);
        localStorage.setItem("auth.user", JSON.stringify(session));
        setAuthUser(session);
        emitAuthUserChanged(session);
        return { ok: true, user: session };
      }
      return { ok: false, error: "Credenciales inválidas" };
    },
    [setAuthUser, emitAuthUserChanged]
  );

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem("auth.user");
    setAuthUser(null);
    emitAuthUserChanged(null);
  }, [setAuthUser, emitAuthUserChanged]);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
