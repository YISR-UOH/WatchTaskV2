import { useEffect, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import { listUsers } from "@/utils/APIdb";
import { listOrders, bulkUpsertOrders } from "@/utils/APIdb";
import { usePeer } from "@/p2p/PeerContext";

function AssignmentView({ orders, maintainers, onAssign }) {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedMaintainer, setSelectedMaintainer] = useState(null);

  const unassignedOrders = orders.filter((o) => !o.info?.asignado_a_code);

  const handleAssign = () => {
    if (selectedOrder && selectedMaintainer) {
      onAssign(selectedOrder.code, selectedMaintainer.code);
      setSelectedOrder(null);
      setSelectedMaintainer(null);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Asignar Órdenes a Mantenedores</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h4 className="font-medium mb-2">Órdenes Disponibles</h4>
          <select
            className="input w-full"
            value={selectedOrder?.code || ""}
            onChange={(e) => {
              const code = Number(e.target.value);
              const order = unassignedOrders.find((o) => o.code === code);
              setSelectedOrder(order);
            }}
          >
            <option value="">Seleccionar Orden</option>
            {unassignedOrders.map((o) => (
              <option key={o.code} value={o.code}>
                #{o.code} - {o.info?.Descripcion || "Sin descripción"}
              </option>
            ))}
          </select>
        </div>
        <div className="card p-4">
          <h4 className="font-medium mb-2">Mantenedores Disponibles</h4>
          <select
            className="input w-full"
            value={selectedMaintainer?.code || ""}
            onChange={(e) => {
              const code = Number(e.target.value);
              const maintainer = maintainers.find((m) => m.code === code);
              setSelectedMaintainer(maintainer);
            }}
          >
            <option value="">Seleccionar Mantenedor</option>
            {maintainers.map((m) => (
              <option key={m.code} value={m.code}>
                #{m.code} - {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        className="btn btn-primary"
        onClick={handleAssign}
        disabled={!selectedOrder || !selectedMaintainer}
      >
        Asignar Orden
      </button>
    </div>
  );
}

function DashboardView({ orders, maintainers }) {
  const assignedOrders = orders.filter((o) => o.info?.asignado_a_code);
  const completedOrders = orders.filter((o) => o.info?.status === 1);
  const totalOrders = orders.length;

  const stats = [
    { label: "Total Órdenes", value: totalOrders },
    { label: "Órdenes Asignadas", value: assignedOrders.length },
    { label: "Órdenes Completadas", value: completedOrders.length },
    { label: "Mantenedores Activos", value: maintainers.length },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Dashboard de Asignaciones</h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-sm text-gray-600">{stat.label}</div>
          </div>
        ))}
      </div>
      <div className="card p-4">
        <h4 className="font-medium mb-2">Órdenes Asignadas</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Código</th>
              <th>Descripción</th>
              <th>Asignado a</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {assignedOrders.map((o) => {
              const maintainer = maintainers.find(
                (m) => m.code === o.info?.asignado_a_code
              );
              return (
                <tr key={o.code} className="border-b">
                  <td className="py-2">{o.code}</td>
                  <td>{o.info?.Descripcion || "Sin descripción"}</td>
                  <td>{maintainer ? maintainer.name : "Desconocido"}</td>
                  <td>{o.info?.status === 1 ? "Completada" : "En Progreso"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SupervisorDashboard() {
  const { user, logout } = useAuth();
  const { broadcastSync, sendOrdersToUser } = usePeer();
  const [orders, setOrders] = useState([]);
  const [maintainers, setMaintainers] = useState([]);
  const [activeView, setActiveView] = useState("assignment");

  const refresh = async () => {
    const allOrders = await listOrders();
    setOrders(allOrders);
    const allUsers = await listUsers();
    const maint = allUsers.filter((u) => u.role === "mantenedor" && u.active);
    setMaintainers(maint);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleAssign = async (orderCode, maintainerCode) => {
    const order = orders.find((o) => o.code === orderCode);
    const maintainer = maintainers.find((m) => m.code === maintainerCode);
    if (order && maintainer) {
      const updatedOrder = {
        ...order,
        info: {
          ...order.info,
          asignado_a_code: maintainerCode,
          asignado_a_name: maintainer.name,
          asignado_por_code: user.code,
          asignado_por_name: user.name,
        },
      };
      await bulkUpsertOrders([updatedOrder]);
      await broadcastSync();
      // Enviar órdenes específicas al mantenedor asignado
      await sendOrdersToUser(maintainer.code);
      await refresh();
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Panel Supervisor</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {user.name} (#{user.code})
          </span>
          <button className="btn btn-outline" onClick={logout}>
            Salir
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className={`btn ${
            activeView === "assignment" ? "btn-primary" : "btn-outline"
          }`}
          onClick={() => setActiveView("assignment")}
        >
          Asignar Órdenes
        </button>
        <button
          className={`btn ${
            activeView === "dashboard" ? "btn-primary" : "btn-outline"
          }`}
          onClick={() => setActiveView("dashboard")}
        >
          Dashboard
        </button>
      </div>

      {activeView === "assignment" && (
        <AssignmentView
          orders={orders}
          maintainers={maintainers}
          onAssign={handleAssign}
        />
      )}
      {activeView === "dashboard" && (
        <DashboardView orders={orders} maintainers={maintainers} />
      )}
    </div>
  );
}
