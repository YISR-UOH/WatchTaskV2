import React, { useCallback, useEffect, useState } from "react";
import ListOrder from "@/components/mantenedor/component_listOrder";
import { useAuth } from "@/Context/AuthContext";
import { fetchOrdersByAssignedUser, markOrdersExpired } from "@/utils/APIdb";
import { unstable_Activity, Activity as ActivityStable } from "react";
let Activity = ActivityStable ?? unstable_Activity;

export default function Mantenedor() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  const onloadOrders = (listOrders) => {
    if (!Array.isArray(listOrders) || listOrders.length === 0) {
      setOrders([]);
      return [];
    }

    const toNumberOrMax = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };

    const toNumberOrNull = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const parseDate = (value) => {
      if (!value) return null;
      const directDate = new Date(value);
      if (!Number.isNaN(directDate.getTime())) {
        return directDate;
      }

      if (typeof value === "string") {
        const parts = value.split("/");
        if (parts.length === 3) {
          let [day, month, year] = parts.map((part) => Number(part));
          if (
            Number.isFinite(day) &&
            Number.isFinite(month) &&
            Number.isFinite(year)
          ) {
            if (year < 100) {
              const currentCentury = Math.floor(new Date().getFullYear() / 100);
              year += currentCentury * 100;
              if (year - new Date().getFullYear() > 50) {
                year -= 100;
              }
            }
            const isoDate = new Date(year, month - 1, day);
            if (!Number.isNaN(isoDate.getTime())) {
              return isoDate;
            }
          }
        }
      }

      return null;
    };

    const nowMs = Date.now();
    const millisecondsPerDay = 1000 * 60 * 60 * 24;
    const expiredOrderCodes = [];

    const ordersData = listOrders
      .filter((order) => {
        if (!order?.code) return false;
        const status = Number(order?.info?.status);
        return status !== 2 && status !== 3 && status !== 4; // Skip completada, anulada y vencida
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

        const frequencyValueRaw = toNumberOrNull(
          order.info?.["Frec. Dias"] ?? order.info?.FrecDias
        );

        const nextEmissionDate = parseDate(
          order.info?.["Fecha Prox Emision"] ?? order.info?.FechaProxEmision
        );

        const nextEmissionDiffDays = nextEmissionDate
          ? (nextEmissionDate.getTime() - nowMs) / millisecondsPerDay
          : Number.POSITIVE_INFINITY;

        const nearDueThreshold =
          frequencyValueRaw !== null ? frequencyValueRaw * 0.3 : null;
        const isExpired = Boolean(
          Number.isFinite(nextEmissionDiffDays) && nextEmissionDiffDays < 0
        );

        if (isExpired) {
          expiredOrderCodes.push(order.code);
          return null;
        }

        const isNearDue = Boolean(
          nearDueThreshold !== null &&
            Number.isFinite(nextEmissionDiffDays) &&
            nextEmissionDiffDays >= 0 &&
            nextEmissionDiffDays <= nearDueThreshold
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
      const assignedOrders = await fetchOrdersByAssignedUser(user.code);
      const expiredCodes = onloadOrders(assignedOrders);
      if (Array.isArray(expiredCodes) && expiredCodes.length > 0) {
        try {
          await markOrdersExpired(expiredCodes);
        } catch (error) {
          console.error("No se pudieron marcar órdenes vencidas", error);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [user?.code]);

  useEffect(() => {
    loadAssignedOrders();
  }, [loadAssignedOrders]);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold text-slate-900">Mis Órdenes</h1>
        <button
          type="button"
          className="btn btn-outline"
          onClick={loadAssignedOrders}
          disabled={loading}
        >
          {loading ? "Cargando..." : "Actualizar Órdenes"}
        </button>
      </div>
      <Activity mode={orders ? "visible" : "hidden"}>
        <ListOrder orders={orders} />
      </Activity>
    </div>
  );
}
