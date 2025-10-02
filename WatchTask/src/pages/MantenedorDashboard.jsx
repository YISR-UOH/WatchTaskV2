import { useEffect, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import { fetchOrdersByAssignedUser } from "@/utils/APIdb";

function OrdersTable({ orders }) {
  if (!orders.length) {
    return (
      <div className="text-center py-8 text-gray-500">
        No tienes órdenes asignadas actualmente.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b bg-gray-50">
            <th className="py-3 px-2">Código</th>
            <th className="py-3 px-2">Descripción</th>
            <th className="py-3 px-2">Especialidad</th>
            <th className="py-3 px-2">Estado</th>
            <th className="py-3 px-2">Fecha Creación</th>
            <th className="py-3 px-2">Ubicación</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.code} className="border-b hover:bg-gray-50">
              <td className="py-3 px-2 font-mono">
                {order.info?.["Numero orden"] || order.code}
              </td>
              <td className="py-3 px-2">
                {order.info?.["Descripcion"] ||
                  order.info?.["descripcion"] ||
                  "Sin descripción"}
              </td>
              <td className="py-3 px-2">
                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                  {order.info?.["Especialidad_id"] === 1
                    ? "Eléctrico"
                    : order.info?.["Especialidad_id"] === 2
                    ? "Mecánico"
                    : "N/A"}
                </span>
              </td>
              <td className="py-3 px-2">
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    order.info?.["Estado"] === "Pendiente"
                      ? "bg-yellow-100 text-yellow-800"
                      : order.info?.["Estado"] === "En Proceso"
                      ? "bg-blue-100 text-blue-800"
                      : order.info?.["Estado"] === "Completado"
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {order.info?.["Estado"] || "Pendiente"}
                </span>
              </td>
              <td className="py-3 px-2">
                {order.info?.["Fecha"] ||
                  order.info?.["fecha_creacion"] ||
                  "N/A"}
              </td>
              <td className="py-3 px-2">
                {order.info?.["Ubicacion"] ||
                  order.info?.["ubicacion"] ||
                  "N/A"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MantenedorDashboard() {
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Mis Órdenes de Trabajo</h3>
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
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Cargando órdenes...</p>
          </div>
        ) : (
          <OrdersTable orders={orders} />
        )}
      </section>

      {/* Resumen de órdenes por estado */}
      {!loading && orders.length > 0 && (
        <section className="card p-4">
          <h3 className="text-lg font-semibold mb-4">Resumen por Estado</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {["Pendiente", "En Proceso", "Completado", "Cancelado"].map(
              (estado) => {
                const count = orders.filter(
                  (order) => (order.info?.["Estado"] || "Pendiente") === estado
                ).length;

                const bgColor =
                  {
                    Pendiente: "bg-yellow-100 border-yellow-200",
                    "En Proceso": "bg-blue-100 border-blue-200",
                    Completado: "bg-green-100 border-green-200",
                    Cancelado: "bg-red-100 border-red-200",
                  }[estado] || "bg-gray-100 border-gray-200";

                const textColor =
                  {
                    Pendiente: "text-yellow-800",
                    "En Proceso": "text-blue-800",
                    Completado: "text-green-800",
                    Cancelado: "text-red-800",
                  }[estado] || "text-gray-800";

                return (
                  <div
                    key={estado}
                    className={`p-4 rounded-lg border ${bgColor}`}
                  >
                    <div className={`text-2xl font-bold ${textColor}`}>
                      {count}
                    </div>
                    <div className={`text-sm ${textColor}`}>{estado}</div>
                  </div>
                );
              }
            )}
          </div>
        </section>
      )}
    </div>
  );
}
