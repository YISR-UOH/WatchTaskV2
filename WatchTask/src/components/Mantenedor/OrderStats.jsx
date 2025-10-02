// Componente para mostrar estadísticas de órdenes
function OrderStats({ orders }) {
  if (!orders || orders.length === 0) return null;

  return (
    <>
      {/* Resumen de órdenes por estado */}
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

      {/* Resumen de órdenes por prioridad */}
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
              <div key={prioridad} className={`p-4 rounded-lg border ${color}`}>
                <div className={`text-2xl font-bold ${textColor}`}>{count}</div>
                <div className={`text-sm ${textColor}`}>{label}</div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

export default OrderStats;
