import React, { useCallback, useEffect, useState } from "react";
import ListOrder from "@/components/component_listOrder";
import { useAuth } from "@/Context/AuthContext";
import { fetchOrdersByAssignedUser } from "@/utils/APIdb";
import { unstable_Activity, Activity as ActivityStable } from "react";
let Activity = ActivityStable ?? unstable_Activity;

export default function Mantenedor() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  const onloadOrders = (listOrders) => {
    if (listOrders == [] || !listOrders) return;
    const ordersData = listOrders.map((order) => {
      const tasks = order?.tasks ?? {};
      const taskData = Array.isArray(tasks.data) ? tasks.data : [];
      const tasksTotal = Number.isFinite(tasks?.Tasks_N)
        ? tasks.Tasks_N
        : taskData.length;
      const protocolos = Array.isArray(order?.protocolos)
        ? order.protocolos
        : [];
      return {
        code: order.code,
        tasks: { data: taskData, Tasks_N: tasksTotal },
        protocolos,
        description: order.info?.Descripcion || "",
        unidad: order.info?.["N Unidad"] || "",
        info: order.info || {},
        fullOrder: order,
      };
    });
    setOrders(ordersData);
  };

  const loadAssignedOrders = useCallback(async () => {
    if (!user?.code) return;
    setLoading(true);
    try {
      const assignedOrders = await fetchOrdersByAssignedUser(user.code);
      onloadOrders(assignedOrders);
    } finally {
      setLoading(false);
    }
  }, [user?.code]);

  useEffect(() => {
    loadAssignedOrders();
  }, [loadAssignedOrders]);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold text-slate-900">Mis Órdenes</h1>
        <button
          type="button"
          className="btn btn-outline"
          onClick={loadAssignedOrders}
          disabled={loading}
        >
          {loading ? "Cargando..." : "Actualizar Órdenes"}
        </button>
      </div>
      <Activity mode={orders ? "visible" : "hidden"}>
        <ListOrder orders={orders} />
      </Activity>
    </div>
  );
}
