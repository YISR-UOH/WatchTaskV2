export default function ViewOrder({ order }) {
  if (!order) return null;

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Detalles de la Orden</h2>
      {Object.entries(order.info || {}).map(([key, value]) => (
        <div key={key} className="mb-3">
          <span className="font-semibold">{key}:</span>{" "}
          {value === null || value === undefined || value === "" ? (
            "N/A"
          ) : typeof value === "object" ? (
            <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-100 p-2 text-sm text-gray-700">
              {JSON.stringify(value, null, 2)}
            </pre>
          ) : (
            String(value)
          )}
        </div>
      ))}
      <div className="mb-2">
        <span className="font-semibold">Código de Orden:</span> {order.code}
      </div>
      <div className="mb-2">
        <span className="font-semibold">Estado:</span>
      </div>
    </div>
  );
}
