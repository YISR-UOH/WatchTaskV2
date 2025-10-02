import React, { useEffect, useState, useEffectEvent } from "react";
import ComponentOrder from "@/components/component_order";
import { useAuth } from "@/Context/AuthContext";
import { fetchOrdersByAssignedUser } from "@/utils/APIdb";
import { unstable_Activity, Activity as ActivityStable } from "react";
let Activity = ActivityStable ?? unstable_Activity;

export default function Mantenedor() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const onloadOrders = useEffectEvent((listOrders) => {
    if (listOrders == [] || !listOrders) return;
    const ordersData = listOrders.map((order) => ({
      code: order.code,
      tasks: order.tasks || [],
      protocols: order.protocolos || [],
      description: order.info.Descripcion || "",
    }));
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
      <h1 className="text-2xl font-bold mb-4">Mantenedor Page</h1>
      <p>Contenido del Mantenedor.</p>
      <Activity mode={orders ? "visible" : "hidden"}>
        <ComponentOrder orders={orders} />
      </Activity>
    </div>
  );
}
