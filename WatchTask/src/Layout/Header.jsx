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
            className="rounded-md text-left text-lg font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer"
          >
            WatchTask
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
