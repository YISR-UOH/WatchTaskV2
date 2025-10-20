import React, { useCallback, useEffect, useMemo, useState } from "react";
import ListOrder from "@/components/mantenedor/component_listOrder";
import { useAuth } from "@/Context/AuthContext";
import {
  fetchOrdersByAssignedUser,
  markOrdersExpired,
  getOrderExpirationDetails,
} from "@/utils/APIdb";
import { startOfChileDay } from "@/utils/timezone";
import { unstable_Activity, Activity as ActivityStable } from "react";
let Activity = ActivityStable ?? unstable_Activity;

const MACHINES = {
  KBA: "KBA",
  COR: "CORRUGADORA",
  ISW: "ISOWA",
  ET: "ETERNA",
  LAM: "LAMINADORA",
  NT: "MARTIN",
  W1: "WARD",
};

const SERVICES = {
  SC: "SERVICIOS",
  GRS: "GRUAS",
  DP: "PLANTA",
  EXP: "EXPEDICION",
  TM: "TALLER",
  EDI: "EDIFICIO",
};

const regexMachine = /^(?<code>\w+)\s(?<name>[\w-]+)(\s-\s(?<desc>.+))?$/;

const parseMachineCode = (unidad) => {
  if (typeof unidad !== "string") return { machineName: "", machineDesc: "" };
  const match = unidad.match(regexMachine);
  if (match?.groups) {
    return {
      machineName: match.groups.name || "",
      machineDesc: match.groups.desc || "",
    };
  }
  return { machineName: "", machineDesc: "" };
};

export default function Mantenedor() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectMachine, setSelectMachine] = useState("");
  const [selectService, setSelectService] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const onloadOrders = (listOrders) => {
    if (!Array.isArray(listOrders) || listOrders.length === 0) {
      setOrders([]);
      return [];
    }

    const toNumberOrMax = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };

    const now = new Date();
    const nowMs = now.getTime();
    const todayStart = startOfChileDay(now);
    const todayStartMs = todayStart ? todayStart.getTime() : nowMs;
    const millisecondsPerDay = 1000 * 60 * 60 * 24;
    const expiredOrderCodes = [];

    const ordersData = listOrders
      .filter((order) => {
        if (!order?.code) return false;
        const status = Number(order?.info?.status);
        return status !== 2 && status !== 3;
      })
      .map((order) => {
        const tasks = order?.tasks ?? {};
        const taskData = Array.isArray(tasks.data) ? tasks.data : [];
        const tasksTotal = Number.isFinite(tasks?.Tasks_N)
          ? tasks.Tasks_N
          : taskData.length;
        const protocolos = Array.isArray(order?.protocolos)
          ? order.protocolos
          : [];
        const priorityValue = toNumberOrMax(
          order.info?.prioridad ?? order.info?.Prioridad
        );

        const frequencyValue = toNumberOrMax(
          order.info?.["Frec. Dias"] ?? order.info?.FrecDias
        );

        const expirationDetails = getOrderExpirationDetails(order);
        const isExpired = expirationDetails
          ? todayStartMs > expirationDetails.expirationDate.getTime()
          : false;

        if (isExpired) {
          expiredOrderCodes.push(order.code);
          return null;
        }

        const frequencyValueRaw = expirationDetails?.frequencyDays ?? null;

        const dueDiffDays = expirationDetails
          ? (expirationDetails.dueDate.getTime() - todayStartMs) /
            millisecondsPerDay
          : Number.POSITIVE_INFINITY;

        const nextEmissionDiffDays = expirationDetails
          ? (expirationDetails.expirationDate.getTime() - todayStartMs) /
            millisecondsPerDay
          : Number.POSITIVE_INFINITY;

        const nearDueThreshold =
          frequencyValueRaw !== null ? frequencyValueRaw * 0.3 : null;

        const isNearDue = Boolean(
          nearDueThreshold !== null &&
            Number.isFinite(dueDiffDays) &&
            dueDiffDays >= 0 &&
            dueDiffDays <= nearDueThreshold
        );

        return {
          code: order.code,
          tasks: { data: taskData, Tasks_N: tasksTotal },
          protocolos,
          description: order.info?.Descripcion || "",
          unidad: order.info?.["N Unidad"] || "",
          info: order.info || {},
          fullOrder: order,
          priorityValue,
          frequencyValue,
          nextEmissionDiffDays,
          isNearDue,
        };
      })
      .filter(Boolean)
      .sort((orderA, orderB) => {
        if (orderA.isNearDue !== orderB.isNearDue) {
          return orderA.isNearDue ? -1 : 1;
        }

        if (orderA.priorityValue !== orderB.priorityValue) {
          return orderA.priorityValue - orderB.priorityValue;
        }

        if (orderA.frequencyValue !== orderB.frequencyValue) {
          return orderA.frequencyValue - orderB.frequencyValue;
        }

        return String(orderA.code).localeCompare(String(orderB.code));
      });

    setOrders(ordersData);
    return expiredOrderCodes;
  };

  const loadAssignedOrders = useCallback(async () => {
    if (!user?.code) return;
    setLoading(true);

    try {
      const processLoad = async (shouldMarkExpired) => {
        const assignedOrders = await fetchOrdersByAssignedUser(user.code);
        const expiredCodes = onloadOrders(assignedOrders);

        if (!shouldMarkExpired || !Array.isArray(expiredCodes)) {
          return;
        }

        try {
          const result = await markOrdersExpired(expiredCodes);
          if (result?.expiredMarked > 0 || result?.restored > 0) {
            await processLoad(false);
          }
        } catch (error) {
          console.error("No se pudieron marcar órdenes vencidas", error);
        }
      };

      await processLoad(true);
    } finally {
      setLoading(false);
    }
  }, [user?.code]);

  useEffect(() => {
    loadAssignedOrders();
  }, [loadAssignedOrders]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleOrdersChanged = () => {
      loadAssignedOrders();
    };
    window.addEventListener("orders:changed", handleOrdersChanged);
    return () => {
      window.removeEventListener("orders:changed", handleOrdersChanged);
    };
  }, [loadAssignedOrders]);

  useEffect(() => {
    setSelectMachine("");
    setSelectService("");
    setSearchTerm("");
  }, [user?.code]);

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value.toLowerCase());
  };

  const handleChangeMachine = (event) => {
    setSelectService("");
    setSelectMachine(event.target.value);
  };

  const handleChangeService = (event) => {
    setSelectMachine("");
    setSelectService(event.target.value);
  };

  const filteredOrders = useMemo(() => {
    const term = searchTerm.trim();
    return orders
      .filter((order) => {
        if (selectMachine) {
          const { machineName, machineDesc } = parseMachineCode(order.unidad);
          if (
            machineName === "FL" &&
            (machineDesc.includes(selectMachine) ||
              machineDesc.includes(MACHINES[selectMachine]))
          ) {
            return true;
          }
          return machineName === selectMachine;
        }
        if (selectService) {
          const { machineName } = parseMachineCode(order.unidad);
          return machineName === selectService;
        }
        return true;
      })
      .filter((order) => {
        if (!term) return true;
        const unidad = String(order.unidad ?? "").toLowerCase();
        const code = String(order.code ?? "").toLowerCase();
        const description = String(order.description ?? "").toLowerCase();
        return (
          unidad.includes(term) ||
          code.includes(term) ||
          description.includes(term)
        );
      });
  }, [orders, selectMachine, selectService, searchTerm]);

  const hasOrders = orders.length > 0;
  const noMatches = hasOrders && filteredOrders.length === 0 && !loading;

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="sr-only" htmlFor="maintenance-search">
              Buscar órdenes
            </label>
            <div className="relative">
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                id="maintenance-search"
                type="text"
                placeholder="Buscar por código o unidad"
                className="input w-full pl-9"
                onChange={handleSearchChange}
              />
            </div>
          </div>
          <div className="min-w-[200px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Máquina
            </label>
            <select
              className="input w-full"
              value={selectMachine}
              onChange={handleChangeMachine}
            >
              <option value="">Todas</option>
              {Object.entries(MACHINES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[200px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Servicio
            </label>
            <select
              className="input w-full"
              value={selectService}
              onChange={handleChangeService}
            >
              <option value="">Todos</option>
              {Object.entries(SERVICES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-outline flex items-center justify-center"
            onClick={loadAssignedOrders}
            disabled={loading}
            aria-label="Actualizar órdenes"
            title="Actualizar órdenes"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="size-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
          </button>
        </div>
      </div>
      <Activity mode={orders ? "visible" : "hidden"}>
        <ListOrder orders={filteredOrders} />
      </Activity>
      {noMatches ? (
        <div className="mt-6 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
          No se encontraron órdenes que coincidan con los filtros aplicados.
        </div>
      ) : null}
    </div>
  );
}
