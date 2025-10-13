import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router";
import { unstable_Activity, Activity as ActivityStable } from "react";
import ViewOrder from "@/components/mantenedor/component_viewOrder";
import { getOrderByCode } from "@/utils/APIdb";

let Activity = ActivityStable ?? unstable_Activity;

export default function OrderDetail() {
  const { code } = useParams();
  const location = useLocation();
  const stateOrder = useMemo(() => location.state?.order ?? null, [location]);
  const [order, setOrder] = useState(stateOrder);
  const [loading, setLoading] = useState(!stateOrder);
  const [error, setError] = useState(null);

  useEffect(() => {
    let canceled = false;

    async function loadOrder() {
      if (stateOrder || !code) {
        setLoading(false);
        if (!code) setError("Código de orden inválido");
        return;
      }
      try {
        setLoading(true);
        const fetched = await getOrderByCode(code);
        if (!canceled) {
          if (fetched) {
            setOrder(fetched);
          } else {
            setError("No se encontró la orden solicitada.");
          }
        }
      } catch {
        if (!canceled) setError("No se pudo cargar la orden.");
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    loadOrder();

    return () => {
      canceled = true;
    };
  }, [code, stateOrder]);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <Activity mode={loading ? "visible" : "hidden"}>
        <div className="bg-white border rounded-lg p-6 shadow">
          <p className="text-gray-600">Cargando orden...</p>
        </div>
      </Activity>
      <Activity mode={!loading && error ? "visible" : "hidden"}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 shadow">
          <p className="text-red-700">{error}</p>
        </div>
      </Activity>
      <Activity mode={!loading && order && !error ? "visible" : "hidden"}>
        <div className="bg-white border rounded-lg p-6 shadow">
          <ViewOrder orden={order} onUpdateOrder={setOrder} />
        </div>
      </Activity>
    </div>
  );
}
