import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import Header from "@/Layout/Header";
import Footer from "@/Layout/Footer";
import { PeerProvider } from "@/p2p/PeerContext";
import PeerDebugPanel from "@/p2p/PeerDebugPanel";
import { AuthProvider, useAuth } from "@/Context/AuthContext";
import Login from "@/pages/Login";
import AdminDashboard from "@/pages/AdminDashboard";

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/login" replace />;
  return children;
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
                <Route path="*" element={<Navigate to="/login" replace />} />
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
