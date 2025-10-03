import React, { useState } from "react";
import { useNavigate } from "react-router";
import { unstable_Activity, Activity as ActivityStable } from "react";
let Activity = ActivityStable ?? unstable_Activity;
export default function ListOrder({ orders }) {
  const navigate = useNavigate();
  const [hiddenTasks, setHiddenTasks] = useState(false);
  const [actualOrder, setActualOrder] = useState(null);
  const [hiddenProtocolos, setHiddenProtocolos] = useState(false);
  const [selectedProtocolIndex, setSelectedProtocolIndex] = useState(0);
  if (!orders || orders == []) return;
  const selectTask = (orderCode) => {
    if (actualOrder == orderCode) {
      setHiddenTasks(!hiddenTasks);
      setHiddenProtocolos(false);
      return;
    }
    setActualOrder(orderCode);
    setHiddenTasks(true);
    setHiddenProtocolos(false);
  };
  const selectProtocol = (orderCode) => {
    setSelectedProtocolIndex(0);
    if (actualOrder == orderCode) {
      setHiddenProtocolos(!hiddenProtocolos);
      setHiddenTasks(false);
      return;
    }
    setActualOrder(orderCode);
    setHiddenProtocolos(true);
    setHiddenTasks(false);
  };

  const handleViewOrder = (order) => {
    if (!order?.code) return;
    const payload = order.fullOrder ?? order;
    navigate(`/mantenedor/orden/${order.code}`, {
      state: { order: payload },
    });
  };

  const getTaskActionLabel = (task) => {
    const status = Number(task?.status);
    if (status === 2) return "Ver tarea";
    if (status === 1) return "Continuar";
    if (status === 3) return "Anulada";
    return "Iniciar";
  };

  const handleTaskAction = (order, task, index) => {
    if (!order?.code) return;
    const payload = order.fullOrder ?? order;
    navigate(`/mantenedor/orden/${order.code}/tarea/${index}`, {
      state: { order: payload },
    });
  };

  return (
    <div>
      {orders.map((order) => (
        <div key={order.code} className="border mb-2 rounded-lg shadow">
          <div className="space-x-reverse flex justify-between items-center top-0">
            <span className="border rounded-tl-md rounded-br-md px-1 py-1 text-sm font-mono font-semibold">
              {order.code}
            </span>
            <span className="border rounded-tr-md rounded-bl-md px-1 py-1 text-sm font-mono font-semibold">
              {order.tasks.data.filter((task) => task.status === 2).length +
                "/" +
                order.tasks.Tasks_N}
            </span>
          </div>
          <div className="flex justify-between flex-col">
            <span className="mb-2 px-2 font-semibold text-lg text-gray-700">
              Descripción: {order.description}
            </span>
            <span className="mb-2 px-2 font-semibold text-lg text-gray-700">
              Unidad: {order.unidad}
            </span>
          </div>
          <div className="relative flex justify-between items-center border-b border-gray-500 rounded-b-md">
            <button
              className="m-0 px-2 py-2 bg-blue-600 text-white  hover:bg-blue-700 cursor-pointer rounded-tr-md rounded-bl-md"
              onClick={() => selectTask(order.code)}
            >
              Tareas |{" "}
              {order.tasks.data.length > 0
                ? [
                    ...new Set(
                      order.tasks.data
                        .map((task) => task.Taller)
                        .filter((taller) => taller)
                    ),
                  ].join("- ")
                : "N/A"}
            </button>
            <button
              className="m-0 px-2 py-2 bg-blue-600 text-white  hover:bg-blue-700 cursor-pointer rounded-t-md"
              onClick={() => handleViewOrder(order)}
            >
              VER ORDEN COMPLETA
            </button>
            {
              // boton para iniciar orden (redirige a /orden/:code muestra toda la info de la orden y permite iniciar tareas)
            }
            <button
              className="m-0 px-2 py-2 bg-blue-600 text-white  hover:bg-blue-700 cursor-pointer rounded-tl-md rounded-br-md"
              onClick={() => selectProtocol(order.code)}
            >
              Anexos: {order.protocolos.length}
            </button>
          </div>
          <Activity
            mode={
              hiddenTasks && actualOrder == order.code ? "visible" : "hidden"
            }
          >
            <div>
              <ul className="px-2 list-inside">
                {order.tasks.data.map((task, index) => (
                  <li
                    key={index}
                    className="flex justify-between border-b border-gray-300 py-1"
                  >
                    <span>{task.Descripcion}</span>
                    <div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm min-w-[7rem] justify-center"
                        onClick={() => handleTaskAction(order, task, index)}
                      >
                        {getTaskActionLabel(task)}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Activity>
          <Activity
            mode={
              hiddenProtocolos && actualOrder == order.code
                ? "visible"
                : "hidden"
            }
          >
            <div>
              {order.protocolos.length > 1 ? (
                <select
                  name=""
                  id=""
                  className="m-2 p-2 border rounded w-1/2 justify-center text-center align-middle relative left-1/2 -translate-x-1/2"
                  value={selectedProtocolIndex}
                  onChange={(e) => setSelectedProtocolIndex(e.target.value)}
                >
                  {order.protocolos.map((protocolo, index) => (
                    <option key={index} value={index}>
                      Anexo {index + 1}
                    </option>
                  ))}
                </select>
              ) : null}

              <div className="bg-gray-50 p-4 rounded-md mt-2 border ">
                <pre className="whitespace-pre-wrap text-sm font-mono text-gray-800">
                  {order.protocolos.length > 0
                    ? order.protocolos[selectedProtocolIndex]
                    : "No hay protocolos de seguridad definidos para esta orden."}
                </pre>
              </div>
            </div>
          </Activity>
        </div>
      ))}
    </div>
  );
}
