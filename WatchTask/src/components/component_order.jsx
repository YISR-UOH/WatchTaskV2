import React, { useEffect, useState } from "react";
import { unstable_Activity, Activity as ActivityStable } from "react";
let Activity = ActivityStable ?? unstable_Activity;
export default function ComponentOrder({ orders }) {
  const [hiddenTasks, setHiddenTasks] = useState(false);
  const [actualOrder, setActualOrder] = useState(null);
  if (!orders || orders == []) return;
  console.log(orders);
  const selectTask = (orderCode) => {
    if (actualOrder == orderCode) {
      setHiddenTasks(!hiddenTasks);
      return;
    }
    setActualOrder(orderCode);
    setHiddenTasks(true);
  };
  return (
    <div>
      {orders.map((order) => (
        <div key={order.code} className="border mb-1 rounded-lg shadow">
          <div className="space-x-reverse flex justify-between items-center top-0">
            <span className="border rounded-tl-md rounded-br-md px-1 py-1 text-sm font-mono font-semibold">
              {order.code}
            </span>
            <span className="border rounded-tr-md rounded-bl-md px-1 py-1 text-sm font-mono font-semibold">
              {order.tasks.data.filter((task) => task.status === "2").length +
                "/" +
                order.tasks.Tasks_N}
            </span>
          </div>
          <div>
            <span className="mb-2 px-2 font-semibold text-lg text-gray-700">
              Descripción: {order.description}
            </span>
          </div>
          <div>
            <button
              className="m-2 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer"
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
            <button className="mb-2 cursor-pointer px-2 py-1 bg-blue-600 text-white rounded hover:bg-green-700">
              Anexos: {order.protocols.length}
            </button>
          </div>
          <Activity
            mode={
              hiddenTasks && actualOrder == order.code ? "visible" : "hidden"
            }
          >
            <ul className="list-disc list-inside">
              {order.tasks.data.map((task, index) => (
                <li key={index}>{task.Descripcion}</li>
              ))}
            </ul>
          </Activity>
        </div>
      ))}
    </div>
  );
}
