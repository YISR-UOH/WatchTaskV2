import { useState } from "react";
import OrderCard from "./OrderCard";

// Componente de lista de órdenes usando tarjetas
function OrdersList({ orders, onOpenProtocols }) {
  const [expandedOrder, setExpandedOrder] = useState(null);

  // Ordenar órdenes por prioridad (1=SYS primero, 2=CCL, 3=otros)
  const sortedOrders = [...orders].sort((a, b) => {
    const priorityA = a.info?.prioridad || 3;
    const priorityB = b.info?.prioridad || 3;
    return priorityA - priorityB;
  });

  const toggleExpanded = (orderCode) => {
    setExpandedOrder(expandedOrder === orderCode ? null : orderCode);
  };

  if (!sortedOrders.length) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-400 text-6xl mb-4">📋</div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          No tienes órdenes asignadas
        </h3>
        <p className="text-gray-500">
          Actualmente no hay órdenes de trabajo asignadas a tu cuenta.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sortedOrders.map((order) => (
        <OrderCard
          key={order.code}
          order={order}
          isExpanded={expandedOrder === order.code}
          onToggleExpand={toggleExpanded}
          onOpenProtocols={onOpenProtocols}
        />
      ))}
    </div>
  );
}

export default OrdersList;
