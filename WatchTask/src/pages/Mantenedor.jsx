import React, { useEffect, useState, useEffectEvent } from "react";
import ListOrder from "@/components/component_listOrder";
import { useAuth } from "@/Context/AuthContext";
import { fetchOrdersByAssignedUser } from "@/utils/APIdb";
import { unstable_Activity, Activity as ActivityStable } from "react";
let Activity = ActivityStable ?? unstable_Activity;

export default function Mantenedor() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const onloadOrders = useEffectEvent((listOrders) => {
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
  });

  useEffect(() => {
    if (!user?.code) return;
    const loadAssignedOrders = async () => {
      const assignedOrders = await fetchOrdersByAssignedUser(user.code);
      onloadOrders(assignedOrders);
    };

    loadAssignedOrders();
  }, [user?.code]);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <Activity mode={orders ? "visible" : "hidden"}>
        <ListOrder orders={orders} />
      </Activity>
    </div>
  );
}
