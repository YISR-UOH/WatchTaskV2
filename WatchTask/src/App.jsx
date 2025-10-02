import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import Header from "@/Layout/Header";
import Footer from "@/Layout/Footer";
import { PeerProvider } from "@/p2p/PeerContext";
import PeerDebugPanel from "@/p2p/PeerDebugPanel";
import { AuthProvider, useAuth } from "@/Context/AuthContext";
import Login from "@/pages/Login";
import AdminDashboard from "@/pages/AdminDashboard";
import SupervisorDashboard from "@/pages/SupervisorDashboard";
import Mantenedor from "@/pages/Mantenedor";

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/login" replace />;
  return children;
}

function DefaultRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  if (user.role === "supervisor") return <Navigate to="/supervisor" replace />;
  if (user.role === "mantenedor") return <Navigate to="/mantenedor" replace />;
  return <Navigate to="/login" replace />;
}
function App() {
  const BASENAME = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "") || "/";
  return (
    <BrowserRouter basename={BASENAME}>
      <PeerProvider>
        <AuthProvider>
          <div className="min-h-dvh flex flex-col">
            <Header />
            <main className="flex-grow bg-gray-50 pt-12">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute roles={["admin"]}>
                      <AdminDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/supervisor"
                  element={
                    <ProtectedRoute roles={["supervisor"]}>
                      <SupervisorDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mantenedor"
                  element={
                    <ProtectedRoute roles={["mantenedor"]}>
                      <Mantenedor />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<DefaultRedirect />} />
              </Routes>
              <PeerDebugPanel />
            </main>
            <Footer />
          </div>
        </AuthProvider>
      </PeerProvider>
    </BrowserRouter>
  );
}

export default App;
