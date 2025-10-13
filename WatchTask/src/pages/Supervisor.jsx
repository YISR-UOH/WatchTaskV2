/**
 * Vista de Supervisor
 * funciona como modulo central para supervisores y acceso a otras vistas.
 */

import React, { useMemo, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import AssignOrden from "@/components/supervisor/component_assignOrden";

export default function Supervisor() {
  const { user } = useAuth();
  const tabs = useMemo(
    () => [
      {
        id: "assign",
        label: "Asignar Ordenes",
        content: <AssignOrden />,
      },
      {
        id: "review",
        label: "Revision de Ordenes",
        content: <div>En revisión</div>,
      },
      {
        id: "dashboard",
        label: "Dashboard",
        content: <div>Dashboard en construcción</div>,
      },
    ],
    []
  );
  const [activeTab, setActiveTab] = useState(tabs[0].id);

  const getButtonClass = (tabId) =>
    tabId === activeTab
      ? "font-bold text-lg cursor-pointer px-4 py-2 bg-blue-500 text-white rounded"
      : "text-lg cursor-pointer px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200";

  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div>
      <div className="flex flex-row gap-4 p-4 align-center justify-center sticky top-0 bg-white shadow">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={getButtonClass(tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="max-w-6xl mx-auto p-4">{currentTab.content}</div>
    </div>
  );
}
