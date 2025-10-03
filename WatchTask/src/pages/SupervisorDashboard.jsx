import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/Context/AuthContext";
import { listUsers } from "@/utils/APIdb";
import {
  listOrders,
  bulkUpsertOrders,
  saveOrderChecklist,
} from "@/utils/APIdb";
import { usePeer } from "@/p2p/PeerContext";
import OrderCompletionChecklist from "@/components/OrderCompletionChecklist";

const areAllTasksCompleted = (order) => {
  const data = Array.isArray(order?.tasks?.data) ? order.tasks.data : [];
  if (!data.length) return false;
  return data.every((item) => Number(item?.status) === 2);
};

function AssignmentView({ orders, maintainers, onAssign }) {
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [selectedMaintainer, setSelectedMaintainer] = useState(null);
  const [searchCode, setSearchCode] = useState("");
  const [searchDescription, setSearchDescription] = useState("");
  const [expandedOrders, setExpandedOrders] = useState(new Set());

  const filteredOrders = useMemo(() => {
    const unassigned = orders.filter((o) => !o.info?.asignado_a_code);
    return unassigned.filter((o) => {
      const codeMatch = searchCode
        ? o.code.toString().includes(searchCode)
        : true;
      const descMatch = searchDescription
        ? (o.info?.Descripcion || "")
            .toLowerCase()
            .includes(searchDescription.toLowerCase())
        : true;
      return codeMatch && descMatch;
    });
  }, [orders, searchCode, searchDescription]);

  const handleOrderToggle = (orderCode) => {
    setSelectedOrders((prev) =>
      prev.includes(orderCode)
        ? prev.filter((code) => code !== orderCode)
        : [...prev, orderCode]
    );
  };

  const handleAssignMass = () => {
    if (selectedOrders.length > 0 && selectedMaintainer) {
      selectedOrders.forEach((orderCode) => {
        onAssign(orderCode, selectedMaintainer.code);
      });
      setSelectedOrders([]);
      setSelectedMaintainer(null);
    }
  };

  const handleAssignSingle = (orderCode) => {
    if (selectedMaintainer) {
      onAssign(orderCode, selectedMaintainer.code);
    }
  };

  const toggleTasks = (orderCode) => {
    setExpandedOrders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(orderCode)) {
        newSet.delete(orderCode);
      } else {
        newSet.add(orderCode);
      }
      return newSet;
    });
  };

  const getTaskStatusLabel = (status) => {
    const numStatus = Number(status);
    if (numStatus === 2) return "Completada";
    if (numStatus === 1) return "En Progreso";
    if (numStatus === 3) return "Anulada";
    return "Pendiente";
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Asignar Órdenes a Mantenedores</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <input
          type="text"
          placeholder="Buscar por código"
          className="input"
          value={searchCode}
          onChange={(e) => setSearchCode(e.target.value)}
        />
        <input
          type="text"
          placeholder="Buscar por descripción"
          className="input"
          value={searchDescription}
          onChange={(e) => setSearchDescription(e.target.value)}
        />
      </div>
      <div className="card p-4">
        <h4 className="font-medium mb-2">Mantenedor para Asignar</h4>
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
              #{m.code} - {m.name} ({m.speciality || "Sin especialidad"})
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h4 className="font-medium">
            Órdenes Disponibles ({filteredOrders.length})
          </h4>
          <button
            className="btn btn-primary"
            onClick={handleAssignMass}
            disabled={selectedOrders.length === 0 || !selectedMaintainer}
          >
            Asignar Seleccionadas ({selectedOrders.length})
          </button>
        </div>
        {filteredOrders.map((order) => (
          <div key={order.code} className="border rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedOrders.includes(order.code)}
                  onChange={() => handleOrderToggle(order.code)}
                  className="h-4 w-4"
                />
                <span className="font-semibold">#{order.code}</span>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => toggleTasks(order.code)}
                >
                  {expandedOrders.has(order.code)
                    ? "Ocultar Tareas"
                    : "Mostrar Tareas"}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleAssignSingle(order.code)}
                  disabled={!selectedMaintainer}
                >
                  Asignar
                </button>
              </div>
            </div>
            <div className="mt-2">
              <p>
                <strong>Descripción:</strong>{" "}
                {order.info?.Descripcion || "Sin descripción"}
              </p>
              <p>
                <strong>Unidad:</strong> {order.info?.["N Unidad"] || "N/A"}
              </p>
              <p>
                <strong>Tareas:</strong>{" "}
                {Array.isArray(order.tasks?.data) ? order.tasks.data.length : 0}
              </p>
            </div>
            {expandedOrders.has(order.code) && (
              <div className="mt-4 border-t pt-4">
                <h5 className="font-medium mb-2">Tareas:</h5>
                <ul className="space-y-1">
                  {Array.isArray(order.tasks?.data) ? (
                    order.tasks.data.map((task, index) => (
                      <li key={index} className="flex justify-between text-sm">
                        <span>{task.Descripcion || "Sin descripción"}</span>
                        <span className="text-gray-600">
                          {getTaskStatusLabel(task.status)}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li>No hay tareas disponibles.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardView({ orders, maintainers }) {
  const assignedOrders = orders.filter((o) => o.info?.asignado_a_code);
  const completedOrders = orders.filter((o) => areAllTasksCompleted(o));
  const approvedOrders = completedOrders.filter(
    (o) => o.info?.checkListDict?.supervisor?.firma
  );
  const pendingApprovalOrders = completedOrders.filter(
    (o) => !o.info?.checkListDict?.supervisor?.firma
  );
  const inProgressOrders = orders.filter(
    (o) => o.info?.asignado_a_code && !areAllTasksCompleted(o)
  );
  const totalOrders = orders.length;

  const totalAssignedHours = useMemo(() => {
    return assignedOrders.reduce((sum, o) => {
      const tasks = Array.isArray(o.tasks?.data) ? o.tasks.data : [];
      return (
        sum +
        tasks.reduce((taskSum, t) => taskSum + (Number(t["Hs Estim"]) || 0), 0)
      );
    }, 0);
  }, [assignedOrders]);

  const maintainersBySpeciality = useMemo(() => {
    const grouped = maintainers.reduce((acc, m) => {
      const spec = m.speciality || "Sin especialidad";
      if (!acc[spec]) acc[spec] = [];
      acc[spec].push(m);
      return acc;
    }, {});
    return Object.entries(grouped).map(([spec, list]) => ({
      speciality: spec,
      count: list.length,
      availableHours: list.length * 8, // 8 horas por día
    }));
  }, [maintainers]);

  const stats = [
    { label: "Total Órdenes", value: totalOrders },
    { label: "Órdenes Asignadas", value: assignedOrders.length },
    { label: "Órdenes en Progreso", value: inProgressOrders.length },
    { label: "Órdenes Aprobadas", value: approvedOrders.length },
    { label: "Pendientes Aprobación", value: pendingApprovalOrders.length },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">KPIs y Resumen</h3>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-sm text-gray-600">{stat.label}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h4 className="font-medium mb-2">Horas Asignadas vs Disponibles</h4>
          <div className="text-lg">
            Asignadas: {totalAssignedHours.toFixed(1)} HH
          </div>
          <div className="text-sm text-gray-600">
            Disponibles:{" "}
            {maintainersBySpeciality.reduce(
              (sum, s) => sum + s.availableHours,
              0
            )}{" "}
            HH/día
          </div>
        </div>
        <div className="card p-4">
          <h4 className="font-medium mb-2">Mantenedores por Especialidad</h4>
          {maintainersBySpeciality.map((spec) => (
            <div key={spec.speciality} className="flex justify-between text-sm">
              <span>{spec.speciality}:</span>
              <span>
                {spec.count} mantenedores ({spec.availableHours} HH/día)
              </span>
            </div>
          ))}
        </div>
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
              <th>HH Estimadas</th>
            </tr>
          </thead>
          <tbody>
            {assignedOrders.map((o) => {
              const maintainer = maintainers.find(
                (m) => m.code === o.info?.asignado_a_code
              );
              const tasks = Array.isArray(o.tasks?.data) ? o.tasks.data : [];
              const totalHours = tasks.reduce(
                (sum, t) => sum + (Number(t["Hs Estim"]) || 0),
                0
              );
              return (
                <tr key={o.code} className="border-b">
                  <td className="py-2">{o.code}</td>
                  <td>{o.info?.Descripcion || "Sin descripción"}</td>
                  <td>{maintainer ? maintainer.name : "Desconocido"}</td>
                  <td>
                    {areAllTasksCompleted(o)
                      ? "Completada"
                      : o.info?.asignado_a_code
                      ? "En Progreso"
                      : "Pendiente"}
                  </td>
                  <td>{totalHours.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompletedOrdersView({ orders, maintainers, onChecklistSave }) {
  const completedOrders = orders.filter((o) => areAllTasksCompleted(o));
  const [showChecklist, setShowChecklist] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isSavingChecklist, setIsSavingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState(null);

  const handleReviewChecklist = (order) => {
    setSelectedOrder(order);
    setShowChecklist(true);
  };

  const handleChecklistCancel = () => {
    setChecklistError(null);
    setShowChecklist(false);
    setSelectedOrder(null);
  };

  const handleChecklistSave = async (payload) => {
    if (!selectedOrder) return;
    try {
      setChecklistError(null);
      setIsSavingChecklist(true);
      await onChecklistSave(selectedOrder.code, payload);
      setShowChecklist(false);
      setSelectedOrder(null);
    } catch (err) {
      console.error("Failed to save checklist", err);
      setChecklistError(
        "No se pudo guardar el checklist. Inténtalo nuevamente."
      );
    } finally {
      setIsSavingChecklist(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        Órdenes Completadas - Revisión Supervisor
      </h3>
      <div className="space-y-2">
        {completedOrders.length === 0 ? (
          <p className="text-gray-600">
            No hay órdenes completadas pendientes de revisión.
          </p>
        ) : (
          completedOrders.map((order) => {
            const maintainer = maintainers.find(
              (m) => m.code === order.info?.asignado_a_code
            );
            const tasks = Array.isArray(order.tasks?.data)
              ? order.tasks.data
              : [];
            const totalHours = tasks.reduce(
              (sum, t) => sum + (Number(t["Hs Estim"]) || 0),
              0
            );
            const hasChecklist = !!order.info?.checkListDict;
            const isApproved = order.info?.checkListDict?.supervisor?.firma; // Asumiendo que si hay firma, está aprobado

            return (
              <div key={order.code} className="border rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold">#{order.code}</span>
                    <span className="ml-2 text-sm text-gray-600">
                      Asignado a: {maintainer ? maintainer.name : "Desconocido"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {hasChecklist && (
                      <span
                        className={`px-2 py-1 text-xs rounded ${
                          isApproved
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {isApproved ? "Aprobada" : "Pendiente Aprobación"}
                      </span>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleReviewChecklist(order)}
                    >
                      Revisar Checklist
                    </button>
                  </div>
                </div>
                <div className="mt-2">
                  <p>
                    <strong>Descripción:</strong>{" "}
                    {order.info?.Descripcion || "Sin descripción"}
                  </p>
                  <p>
                    <strong>Horas Estimadas:</strong> {totalHours.toFixed(1)} HH
                  </p>
                  <p>
                    <strong>Tareas Completadas:</strong>{" "}
                    {tasks.filter((t) => Number(t.status) === 2).length} /{" "}
                    {tasks.length}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      {showChecklist && selectedOrder && (
        <OrderCompletionChecklist
          isOpen={showChecklist}
          order={selectedOrder}
          task={null} // No específica tarea, es para la orden completa
          taskIndex={null}
          user={null} // Se pasará desde el componente padre si es necesario, pero el componente usa useAuth internamente
          initialData={selectedOrder.info?.checkListDict}
          onCancel={handleChecklistCancel}
          onSubmit={handleChecklistSave}
          saving={isSavingChecklist}
          submitError={checklistError}
        />
      )}
    </div>
  );
}

export default function SupervisorDashboard() {
  const { user, logout } = useAuth();
  const { broadcastSync, sendOrdersToUser } = usePeer();
  const [orders, setOrders] = useState([]);
  const [maintainers, setMaintainers] = useState([]);
  const [activeView, setActiveView] = useState("assignment");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      const allOrders = await listOrders();
      setOrders(allOrders);
      const allUsers = await listUsers();
      const maint = allUsers.filter((u) => u.role === "mantenedor" && u.active);
      setMaintainers(maint);
    } finally {
      setIsRefreshing(false);
    }
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

  const handleChecklistSave = async (orderCode, payload) => {
    const updatedOrder = await saveOrderChecklist(orderCode, payload);
    setOrders((prev) =>
      prev.map((o) => (o.code === orderCode ? updatedOrder : o))
    );
    await broadcastSync();
  };

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Panel Supervisor</h2>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-outline"
            onClick={refresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refrescando..." : "Refrescar"}
          </button>
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
        <button
          className={`btn ${
            activeView === "completed" ? "btn-primary" : "btn-outline"
          }`}
          onClick={() => setActiveView("completed")}
        >
          Órdenes Completadas
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
      {activeView === "completed" && (
        <CompletedOrdersView
          orders={orders}
          maintainers={maintainers}
          onChecklistSave={handleChecklistSave}
        />
      )}
    </div>
  );
}
