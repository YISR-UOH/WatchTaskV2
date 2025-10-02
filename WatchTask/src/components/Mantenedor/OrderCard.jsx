// Componente de tarjeta de orden reutilizable
function OrderCard({ order, isExpanded, onToggleExpand, onOpenProtocols }) {
  const getPriorityLabel = (prioridad) => {
    switch (prioridad) {
      case 1:
        return {
          label: "SYS",
          color: "bg-red-100 text-red-800 border-red-200",
        };
      case 2:
        return {
          label: "CCL",
          color: "bg-orange-100 text-orange-800 border-orange-200",
        };
      default:
        return {
          label: "NORMAL",
          color: "bg-gray-100 text-gray-800 border-gray-200",
        };
    }
  };

  const getStatusColor = (estado) => {
    switch (estado) {
      case "Pendiente":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "En Proceso":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "Completado":
        return "bg-green-100 text-green-800 border-green-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const priority = getPriorityLabel(order.info?.prioridad);
  const tasks = order.tasks?.data || [];
  const firstTask = tasks[0];
  const workshop = firstTask?.Taller || "Sin taller asignado";

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200">
      {/* Header de la orden */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="text-lg font-mono font-semibold text-gray-900">
              {order.info?.["Numero orden"] || order.code}
            </span>
            <span
              className={`px-2 py-1 text-xs font-semibold rounded border ${priority.color}`}
            >
              {priority.label}
            </span>
            <span
              className={`px-2 py-1 text-xs font-semibold rounded border ${getStatusColor(
                order.info?.["status"]
              )}`}
            >
              {order.info?.["status"] || "Pendiente"}
            </span>
          </div>
          <div className="text-sm text-gray-600">
            {tasks.length} tarea{tasks.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="text-sm text-gray-700 mb-3">
          {order.info?.["Descripcion"] ||
            order.info?.["descripcion"] ||
            "Sin descripción"}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>
              Especialidad:{" "}
              {order.info?.["Especialidad_id"] === 1
                ? "Eléctrico"
                : order.info?.["Especialidad_id"] === 2
                ? "Mecánico"
                : "N/A"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleExpand(order.code)}
              className="btn btn-outline btn-sm flex items-center gap-2"
            >
              <span>{isExpanded ? "Ocultar" : "Ver"} tareas</span>
              <span className="text-xs opacity-75">({workshop})</span>
              <span>{isExpanded ? "▲" : "▼"}</span>
            </button>

            <button
              onClick={() => onOpenProtocols(order)}
              className="btn btn-outline btn-sm"
              disabled={!order.protocolos || order.protocolos.length === 0}
            >
              Protocolos ({order.protocolos?.length || 0})
            </button>
          </div>
        </div>
      </div>

      {/* Lista expandible de tareas */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          {tasks.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              No hay tareas definidas para esta orden.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {tasks.map((task, index) => (
                <div
                  key={index}
                  className="p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm font-medium text-gray-900">
                          Tarea {task["Numero sec oper"] || index + 1}
                        </span>
                        <span className="text-xs text-gray-500">
                          {task["Tarea Standard"] || "N/A"}
                        </span>
                        <span
                          className={`px-2 py-1 text-xs rounded border ${getStatusColor(
                            "Pendiente"
                          )}`}
                        >
                          Pendiente
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">
                        {task.Descripcion || "Sin descripción"}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span>Taller: {task.Taller || "N/A"}</span>
                        <span>Horas estimadas: {task["Hs Estim"] || 0}</span>
                        <span>
                          Valor esperado: {task["Valor esperado"] || "N/A"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default OrderCard;
