import { useEffect, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import { fetchOrdersByAssignedUser } from "@/utils/APIdb";
import {
  OrdersList,
  ProtocolsModal,
  OrderStats,
} from "@/components/Mantenedor";

export default function MantenedorDashboard() {
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProtocols, setSelectedProtocols] = useState(null);

  const loadAssignedOrders = async () => {
    if (!user?.code) return;

    setLoading(true);
    try {
      // Obtener órdenes asignadas al mantenedor actual
      const assignedOrders = await fetchOrdersByAssignedUser(user.code);
      setOrders(assignedOrders);
    } catch (error) {
      console.error("Error cargando órdenes:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssignedOrders();
  }, [user?.code]);

  // Listener para cambios en órdenes (para sincronización P2P)
  useEffect(() => {
    const handleOrdersChange = () => {
      loadAssignedOrders();
    };

    window.addEventListener("orders:changed", handleOrdersChange);
    return () => {
      window.removeEventListener("orders:changed", handleOrdersChange);
    };
  }, [user?.code]);

  const openProtocolsModal = (order) => {
    setSelectedProtocols(order);
  };

  const closeProtocolsModal = () => {
    setSelectedProtocols(null);
  };

  if (!user) return null;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Panel Mantenedor</h2>
          <p className="text-gray-600">Órdenes asignadas a {user.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {user.name} (#{user.code})
          </span>
          <button className="btn btn-outline" onClick={logout}>
            Salir
          </button>
        </div>
      </div>

      <section className="card p-4">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">
            Mis Órdenes de Trabajo (Ordenadas por Prioridad)
          </h3>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={loadAssignedOrders}
              disabled={loading}
            >
              {loading ? "Cargando..." : "Actualizar"}
            </button>
            <span className="text-sm text-gray-600">
              {orders.length} orden{orders.length !== 1 ? "es" : ""} asignada
              {orders.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Cargando órdenes...</p>
          </div>
        ) : (
          <OrdersList orders={orders} onOpenProtocols={openProtocolsModal} />
        )}
      </section>
    </div>
  );
}
