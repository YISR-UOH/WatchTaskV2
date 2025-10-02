import { useEffect, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import { fetchOrdersByAssignedUser } from "@/utils/APIdb";

function OrdersTable({ orders }) {
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [selectedProtocols, setSelectedProtocols] = useState(null);

  // Ordenar órdenes por prioridad (1=SYS primero, 2=CCL, 3=otros)
  const sortedOrders = [...orders].sort((a, b) => {
    const priorityA = a.info?.prioridad || 3;
    const priorityB = b.info?.prioridad || 3;
    return priorityA - priorityB;
  });

  const toggleExpanded = (orderCode) => {
    setExpandedOrder(expandedOrder === orderCode ? null : orderCode);
  };

  const openProtocolsModal = (order) => {
    setSelectedProtocols(order);
  };

  const closeProtocolsModal = () => {
    setSelectedProtocols(null);
  };

  const getPriorityLabel = (prioridad) => {
    switch (prioridad) {
      case 1:
        return { label: "SYS", color: "bg-red-100 text-red-800" };
      case 2:
        return { label: "CCL", color: "bg-orange-100 text-orange-800" };
      default:
        return { label: "NORMAL", color: "bg-gray-100 text-gray-800" };
    }
  };

  if (!sortedOrders.length) {
    return (
      <div className="text-center py-8 text-gray-500">
        No tienes órdenes asignadas actualmente.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-gray-50">
              <th className="py-3 px-2 w-8"></th>
              <th className="py-3 px-2">Código</th>
              <th className="py-3 px-2">Prioridad</th>
              <th className="py-3 px-2">Descripción</th>
              <th className="py-3 px-2">Especialidad</th>
              <th className="py-3 px-2">Estado</th>
              <th className="py-3 px-2">Fecha Creación</th>
              <th className="py-3 px-2">Ubicación</th>
              <th className="py-3 px-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sortedOrders.map((order) => {
              const priority = getPriorityLabel(order.info?.prioridad);
              const isExpanded = expandedOrder === order.code;

              return (
                <tr key={order.code} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-2">
                    <button
                      onClick={() => toggleExpanded(order.code)}
                      className="btn btn-ghost btn-xs"
                    >
                      {isExpanded ? "▼" : "▶"}
                    </button>
                  </td>
                  <td className="py-3 px-2 font-mono">
                    {order.info?.["Numero orden"] || order.code}
                  </td>
                  <td className="py-3 px-2">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${priority.color}`}
                    >
                      {priority.label}
                    </span>
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
                  <td className="py-3 px-2">
                    <button
                      onClick={() => openProtocolsModal(order)}
                      className="btn btn-outline btn-xs"
                      disabled={
                        !order.protocolos || order.protocolos.length === 0
                      }
                    >
                      Protocolos ({order.protocolos?.length || 0})
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tabla expandible de tareas */}
      {expandedOrder && (
        <div className="mt-4 border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 border-b">
            <h4 className="font-semibold">
              Tareas de la Orden #{expandedOrder}
            </h4>
          </div>
          <div className="overflow-x-auto">
            {(() => {
              const order = sortedOrders.find((o) => o.code === expandedOrder);
              const tasks = order?.tasks?.data || [];

              if (!tasks.length) {
                return (
                  <div className="text-center py-4 text-gray-500">
                    No hay tareas definidas para esta orden.
                  </div>
                );
              }

              return (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b bg-gray-25">
                      <th className="py-2 px-3">Taller</th>
                      <th className="py-2 px-3">N° Secuencia</th>
                      <th className="py-2 px-3">Tarea Standard</th>
                      <th className="py-2 px-3">Descripción</th>
                      <th className="py-2 px-3">Hs Estimadas</th>
                      <th className="py-2 px-3">Valor Esperado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task, index) => (
                      <tr key={index} className="border-b hover:bg-gray-25">
                        <td className="py-2 px-3">{task.Taller || "N/A"}</td>
                        <td className="py-2 px-3">
                          {task["Numero sec oper"] || "N/A"}
                        </td>
                        <td className="py-2 px-3">
                          {task["Tarea Standard"] || "N/A"}
                        </td>
                        <td className="py-2 px-3">
                          {task.Descripcion || "N/A"}
                        </td>
                        <td className="py-2 px-3">{task["Hs Estim"] || 0}</td>
                        <td className="py-2 px-3">
                          {task["Valor esperado"] || "N/A"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal de protocolos */}
      {selectedProtocols && (
        <div className="modal modal-open">
          <div className="modal-box max-w-4xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">
                Protocolos de Seguridad - Orden #
                {selectedProtocols.info?.["Numero orden"] ||
                  selectedProtocols.code}
              </h3>
              <button
                onClick={closeProtocolsModal}
                className="btn btn-sm btn-circle btn-ghost"
              >
                ✕
              </button>
            </div>

            {selectedProtocols.protocolos &&
            selectedProtocols.protocolos.length > 0 ? (
              <div className="tabs tabs-boxed mb-4">
                {selectedProtocols.protocolos.map((protocolo, index) => (
                  <a
                    key={index}
                    className={`tab ${index === 0 ? "tab-active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      // Cambiar la pestaña activa
                      const tabs = e.target.parentElement.children;
                      for (let tab of tabs) {
                        tab.classList.remove("tab-active");
                      }
                      e.target.classList.add("tab-active");

                      // Mostrar el contenido correspondiente
                      const contents = e.target
                        .closest(".modal-box")
                        .querySelectorAll(".tab-content");
                      contents.forEach((content) =>
                        content.classList.add("hidden")
                      );
                      contents[index].classList.remove("hidden");
                    }}
                  >
                    Protocolo {index + 1}
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No hay protocolos de seguridad definidos para esta orden.
              </div>
            )}

            {selectedProtocols.protocolos &&
              selectedProtocols.protocolos.length > 0 && (
                <div className="space-y-4">
                  {selectedProtocols.protocolos.map((protocolo, index) => (
                    <div
                      key={index}
                      className={`tab-content ${index === 0 ? "" : "hidden"}`}
                    >
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <pre className="whitespace-pre-wrap text-sm font-mono">
                          {protocolo}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            <div className="modal-action">
              <button onClick={closeProtocolsModal} className="btn">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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

      {/* Resumen de órdenes por prioridad */}
      {!loading && orders.length > 0 && (
        <section className="card p-4">
          <h3 className="text-lg font-semibold mb-4">Resumen por Prioridad</h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                prioridad: 1,
                label: "SYS",
                color: "bg-red-100 border-red-200",
                textColor: "text-red-800",
              },
              {
                prioridad: 2,
                label: "CCL",
                color: "bg-orange-100 border-orange-200",
                textColor: "text-orange-800",
              },
              {
                prioridad: 3,
                label: "NORMAL",
                color: "bg-gray-100 border-gray-200",
                textColor: "text-gray-800",
              },
            ].map(({ prioridad, label, color, textColor }) => {
              const count = orders.filter(
                (order) => (order.info?.prioridad || 3) === prioridad
              ).length;

              return (
                <div
                  key={prioridad}
                  className={`p-4 rounded-lg border ${color}`}
                >
                  <div className={`text-2xl font-bold ${textColor}`}>
                    {count}
                  </div>
                  <div className={`text-sm ${textColor}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
