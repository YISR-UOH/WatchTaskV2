import { useNavigate } from "react-router";
import { usePeer } from "@/p2p/PeerContext";
import { useAuth } from "@/Context/AuthContext";

export default function Header() {
  const navigate = useNavigate();
  const { toggleDebug } = usePeer();
  const { user, logout } = useAuth();

  const handleNavigateHome = () => {
    if (!user) {
      navigate("/login");
      return;
    }

    const roleHome = {
      admin: "/admin",
      supervisor: "/supervisor",
      mantenedor: "/mantenedor",
    };

    const target = roleHome[user.role] ?? "/login";
    navigate(target);
  };

  return (
    <header className="fixed top-0 left-0 w-full bg-white shadow-md z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          <button
            type="button"
            onClick={handleNavigateHome}
            className="btn btn-outline flex items-center gap-2 text-lg cursor-pointer"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              className="h-5 w-5 text-blue-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 10v10h14V10" />
              <path d="M9 20v-6h6v6" />
            </svg>
            <span className="leading-none">SIGEM</span>
          </button>
        </h1>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="text-sm text-gray-700">
                {user.name} · {user.role}
              </span>
              <button className="btn btn-outline btn-sm" onClick={logout}>
                Salir
              </button>
            </>
          ) : null}
          <button className="btn btn-outline" onClick={toggleDebug}>
            Debug
          </button>
        </div>
      </div>
    </header>
  );
}
