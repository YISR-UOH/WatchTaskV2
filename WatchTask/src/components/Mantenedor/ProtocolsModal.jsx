import React from "react";

// Componente modal para mostrar protocolos de seguridad
function ProtocolsModal({ order, isOpen, onClose }) {
  const [selectedProtocolIndex, setSelectedProtocolIndex] = React.useState(0);

  if (!isOpen || !order) return null;

  const handleProtocolChange = (e) => {
    setSelectedProtocolIndex(parseInt(e.target.value));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold">
            Protocolos de Seguridad - Orden #
            {order.info?.["Numero orden"] || order.code}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {order.protocolos && order.protocolos.length > 0 ? (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Seleccionar Protocolo:
                </label>
                <select
                  value={selectedProtocolIndex}
                  onChange={handleProtocolChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {order.protocolos.map((protocolo, index) => (
                    <option key={index} value={index}>
                      Protocolo {index + 1}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg border">
                <pre className="whitespace-pre-wrap text-sm font-mono text-gray-800">
                  {order.protocolos[selectedProtocolIndex]}
                </pre>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No hay protocolos de seguridad definidos para esta orden.
            </div>
          )}
        </div>

        <div className="flex justify-end p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProtocolsModal;
