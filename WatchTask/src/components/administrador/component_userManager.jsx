/**
 * administracion de usuarios, agregar, editar y eliminar.
 * usuario:
 *  -codigo
 *  -nombre
 *  -rol (admin, supervisor, mantenedor)
 *  -especialidad (solo para mantenedor y supervisor)
 *  -estado (activo/inactivo)
 *  -password (encriptado con bcrypt)
 *  -firma digitalizada (digitalizar la firma y guardarla como svg)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { unstable_Activity, Activity as ActivityStable } from "react";
import { addUser, listUsers, updateUser } from "@/utils/APIdb";
let Activity = ActivityStable ?? unstable_Activity;
const EMPTY_SIGNATURE = null;

function createEmptyUserForm() {
  return {
    code: "",
    name: "",
    role: "",
    speciality: "",
    password: "",
    signature: EMPTY_SIGNATURE,
  };
}

const ROLES = {
  admin: "Administrador",
  supervisor: "Supervisor",
  mantenedor: "Mantenedor",
};
const SPECIALTIES = {
  1: "ELECTRICO",
  2: "MECANICO",
};
export default function UserManager() {
  const [modalState, setModalState] = useState({
    open: false,
    mode: "create",
    user: null,
  });
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [togglingUser, setTogglingUser] = useState(null);

  const refresh = useCallback(async () => {
    setUsersError(null);
    setActionError(null);
    try {
      setLoadingUsers(true);
      const list = await listUsers();
      setUsers(Array.isArray(list) ? list : []);
    } catch (error) {
      setUsersError(
        error?.message || "No se pudieron obtener los usuarios registrados."
      );
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleOpenCreateModal = () =>
    setModalState({ open: true, mode: "create", user: null });
  const handleOpenEditModal = (user) =>
    setModalState({ open: true, mode: "edit", user });
  const handleCloseModal = () =>
    setModalState({ open: false, mode: "create", user: null });

  const orderedUsers = useMemo(() => {
    const getActiveRank = (user) => (user?.active === false ? 1 : 0);
    const getSpecialityRank = (user) => {
      if (user?.role === "admin") return -1;
      const specialityValue = Number.parseInt(user?.speciality, 10);
      return Number.isFinite(specialityValue)
        ? specialityValue
        : Number.MAX_SAFE_INTEGER;
    };

    const getRoleRank = (user) => {
      if (user?.role === "supervisor") return 0;
      if (user?.role === "mantenedor") return 1;
      if (user?.role === "admin") return 2;
      return 99;
    };

    return [...users].sort((a, b) => {
      const activeDiff = getActiveRank(a) - getActiveRank(b);
      if (activeDiff !== 0) return activeDiff;

      const specialityDiff = getSpecialityRank(a) - getSpecialityRank(b);
      if (specialityDiff !== 0) return specialityDiff;

      const roleDiff = getRoleRank(a) - getRoleRank(b);
      if (roleDiff !== 0) return roleDiff;

      const nameA = String(a?.name || "").toLocaleLowerCase();
      const nameB = String(b?.name || "").toLocaleLowerCase();
      return nameA.localeCompare(nameB, "es");
    });
  }, [users]);

  const handleToggleUserActive = useCallback(
    async (user) => {
      if (!user) return;
      if (togglingUser !== null) return;

      const numericCode = Number(user.code);
      if (!Number.isFinite(numericCode)) {
        setActionError("El usuario seleccionado no tiene un código válido.");
        return;
      }

      const nextActive = user.active === false;
      const promptMessage = nextActive
        ? `¿Deseas activar al usuario ${user.name} (#${user.code})?`
        : `¿Deseas desactivar al usuario ${user.name} (#${user.code})?`;

      const confirmed =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(promptMessage)
          : true;

      if (!confirmed) return;

      setActionError(null);
      setTogglingUser(numericCode);
      try {
        await updateUser(user.code, {
          active: nextActive,
          updatedAt: new Date().toISOString(),
        });
        await refresh();
      } catch (error) {
        setActionError(
          error?.message ||
            "No se pudo actualizar el estado del usuario seleccionado."
        );
      } finally {
        setTogglingUser(null);
      }
    },
    [refresh, togglingUser]
  );

  return (
    <div className="space-y-6">
      <Activity mode={modalState.open ? "visible" : "hidden"}>
        <UserModal
          visible={modalState.open}
          mode={modalState.mode}
          user={modalState.user}
          onClose={handleCloseModal}
          onSuccess={refresh}
        />
      </Activity>

      <section className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            <button
              className="mb-2 flex items-center gap-2 rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600"
              onClick={handleOpenCreateModal}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z"
                />
              </svg>
              Agregar Usuario
            </button>
          </h2>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={refresh}
            disabled={loadingUsers}
          >
            {loadingUsers ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-6 animate-spin"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            )}
          </button>
        </div>

        {usersError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {usersError}
          </div>
        ) : null}

        {actionError ? (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            {actionError}
          </div>
        ) : null}

        {loadingUsers ? (
          <p className="text-sm text-slate-600">Cargando usuarios...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-slate-600">
            No hay usuarios registrados en la base local.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Rol</th>
                  <th className="px-3 py-2">Especialidad</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Editar</th>
                  <th className="px-3 py-2">Activar/Desactivar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {orderedUsers.map((user) => {
                  const specialityLabel =
                    SPECIALTIES?.[user?.speciality] || "-";
                  const numericCode = Number(user.code);
                  const isBusy = togglingUser === numericCode;
                  const isActive = user.active !== false;
                  const actionLabel = isActive ? "Desactivar" : "Activar";
                  return (
                    <tr key={user.code}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        #{user.code}
                      </td>
                      <td className="px-3 py-2">{user.name}</td>
                      <td className="px-3 py-2">
                        {ROLES[user.role] || user.role || "Sin rol"}
                      </td>
                      <td className="px-3 py-2">{specialityLabel}</td>
                      <td className="px-3 py-2">
                        {user.active === false ? "Inactivo" : "Activo"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => handleOpenEditModal(user)}
                          aria-label={`Editar usuario ${user.name}`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth="1.5"
                            stroke="currentColor"
                            className="size-5 text-blue-600"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                            />
                          </svg>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => handleToggleUserActive(user)}
                          disabled={isBusy}
                          aria-label={`${actionLabel} usuario ${user.name}`}
                          title={actionLabel}
                        >
                          {isBusy ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth="1.5"
                              stroke="currentColor"
                              className={`size-5 animate-spin ${
                                isActive ? "text-red-600" : "text-emerald-600"
                              }`}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                              />
                            </svg>
                          ) : isActive ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth="1.5"
                              stroke="currentColor"
                              className="size-5 text-red-600"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z"
                              />
                            </svg>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth="1.5"
                              stroke="currentColor"
                              className="size-5 text-emerald-600"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z"
                              />
                            </svg>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function UserModal({ visible, mode, user, onClose, onSuccess }) {
  const isEdit = mode === "edit" && user;
  const initialForm = useMemo(() => {
    if (isEdit) {
      const specialityRaw = user?.speciality;
      const hasSpeciality =
        specialityRaw !== null &&
        specialityRaw !== undefined &&
        String(specialityRaw).trim() !== "";
      return {
        code: String(user?.code ?? ""),
        name: user?.name ?? "",
        role: user?.role ?? "",
        speciality: hasSpeciality ? String(specialityRaw) : "",
        password: "",
        signature: user?.signature ?? EMPTY_SIGNATURE,
      };
    }
    return createEmptyUserForm();
  }, [isEdit, user]);

  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [signatureTouched, setSignatureTouched] = useState(false);

  useEffect(() => {
    if (visible) {
      setForm(initialForm);
      setError(null);
      setBusy(false);
      setSignatureTouched(false);
    }
  }, [initialForm, visible]);

  if (!visible) return null;

  const isSpecialityRequired =
    form.role === "supervisor" || form.role === "mantenedor";

  const handleFieldChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "role"
        ? {
            speciality:
              value === "supervisor" || value === "mantenedor"
                ? prev.speciality
                : "",
          }
        : {}),
    }));
  };

  const handleSignatureChange = (value) => {
    setSignatureTouched(true);
    setForm((prev) => ({
      ...prev,
      signature: value || EMPTY_SIGNATURE,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;

    setError(null);

    const numericCode = Number.parseInt(form.code, 10);
    if (!Number.isFinite(numericCode) || numericCode <= 0) {
      setError("Ingresa un código numérico válido.");
      return;
    }

    const nameValue = form.name.trim();
    if (!nameValue) {
      setError("El nombre es obligatorio.");
      return;
    }

    if (!form.role) {
      setError("Selecciona un rol para el usuario.");
      return;
    }

    let specialityValue = null;
    if (isSpecialityRequired) {
      const parsedSpeciality = Number.parseInt(form.speciality, 10);
      if (!Number.isFinite(parsedSpeciality)) {
        setError("Selecciona una especialidad válida.");
        return;
      }
      specialityValue = parsedSpeciality;
    }

    const passwordValue = form.password.trim();
    if (!isEdit && !passwordValue) {
      setError("Define una contraseña temporal para el usuario.");
      return;
    }

    try {
      setBusy(true);
      if (isEdit) {
        const patch = {
          name: nameValue,
          role: form.role,
          speciality: isSpecialityRequired ? specialityValue : null,
          updatedAt: new Date().toISOString(),
        };
        if (passwordValue) {
          patch.password = passwordValue;
        }
        if (signatureTouched) {
          patch.signature = form.signature ?? EMPTY_SIGNATURE;
        }
        await updateUser(user.code, patch);
      } else {
        await addUser({
          code: numericCode,
          name: nameValue,
          role: form.role,
          speciality: specialityValue,
          active: true,
          password: passwordValue,
          signature: form.signature ?? EMPTY_SIGNATURE,
        });
      }
      await onSuccess?.();
      onClose();
    } catch (err) {
      setError(
        err?.message ||
          (isEdit
            ? "No se pudieron guardar los cambios del usuario."
            : "No se pudo crear el usuario.")
      );
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (!busy) {
      onClose();
    }
  };

  const modalTitle = isEdit
    ? `Editar usuario #${user?.code ?? ""}`
    : "Agregar Nuevo Usuario";
  const submitLabel = isEdit ? "Guardar cambios" : "Agregar usuario";
  const passwordLabel = isEdit
    ? "Contraseña (opcional)"
    : "Contraseña temporal";
  const passwordPlaceholder = isEdit
    ? "Deja en blanco para mantener la contraseña actual"
    : "Define una contraseña temporal";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-slate-900/40 px-4 py-6">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex max-h-[calc(100vh-4rem)] flex-col overflow-y-auto">
          <header className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {modalTitle}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {isEdit
                ? "Actualiza la información del usuario seleccionado."
                : "Completa la información requerida para crear el nuevo usuario."}
            </p>
          </header>
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div>
                <label
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="user-code"
                >
                  Código
                </label>
                <input
                  id="user-code"
                  type="number"
                  min="1"
                  className="input w-full"
                  value={form.code}
                  onChange={handleFieldChange("code")}
                  disabled={busy || isEdit}
                  required
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="user-name"
                >
                  Nombre completo
                </label>
                <input
                  id="user-name"
                  type="text"
                  className="input w-full"
                  value={form.name}
                  onChange={handleFieldChange("name")}
                  disabled={busy}
                  required
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="user-role"
                >
                  Rol
                </label>
                <select
                  id="user-role"
                  className="input w-full"
                  value={form.role}
                  onChange={handleFieldChange("role")}
                  disabled={busy}
                  required
                >
                  <option value="">Seleccionar rol</option>
                  {Object.entries(ROLES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="user-speciality"
                >
                  Especialidad
                </label>
                <select
                  id="user-speciality"
                  className="input w-full"
                  value={form.speciality}
                  onChange={handleFieldChange("speciality")}
                  disabled={busy || !isSpecialityRequired}
                  required={isSpecialityRequired}
                >
                  <option value="">
                    {isSpecialityRequired
                      ? "Seleccionar especialidad"
                      : "Sin especialidad"}
                  </option>
                  {Object.entries(SPECIALTIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="user-password"
                >
                  {passwordLabel}
                </label>
                <input
                  id="user-password"
                  type="password"
                  className="input w-full"
                  value={form.password}
                  onChange={handleFieldChange("password")}
                  disabled={busy}
                  placeholder={passwordPlaceholder}
                  {...(isEdit ? {} : { required: true })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Firma digital (opcional)
                </label>
                <SignaturePad
                  value={form.signature}
                  onChange={handleSignatureChange}
                  disabled={busy}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Dibuja la firma con el mouse o una pantalla táctil. Puedes
                  borrar para volver a intentarlo.
                </p>
              </div>
              <div>
                <span className="text-xs text-slate-500">
                  La firma queda almacenada en la base local (IndexedDB) y se
                  reutiliza al editar al usuario.
                </span>
              </div>
              {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
            </div>
            <footer className="flex justify-end gap-3 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleClose}
                disabled={busy}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Guardando..." : submitLabel}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );
}

function SignaturePad({ value, onChange, disabled = false }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  useEffect(() => {
    resetCanvas();
    if (!value) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      resetCanvas();
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = value;
  }, [resetCanvas, value]);

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ratioX = canvas.width / rect.width;
    const ratioY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * ratioX,
      y: (event.clientY - rect.top) * ratioY,
    };
  };

  const commitStroke = () => {
    const canvas = canvasRef.current;
    if (!canvas || !onChange) return;
    onChange(canvas.toDataURL("image/png"));
  };

  const handlePointerDown = (event) => {
    if (disabled) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture?.(event.pointerId);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = getPoint(event);
    if (!point) return;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    drawingRef.current = true;
  };

  const handlePointerMove = (event) => {
    if (disabled || !drawingRef.current) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = getPoint(event);
    if (!point) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const handlePointerUp = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.preventDefault();
    commitStroke();
    const canvas = canvasRef.current;
    canvas?.releasePointerCapture?.(event.pointerId);
  };

  const handlePointerLeave = (event) => {
    if (!drawingRef.current) return;
    handlePointerUp(event);
  };

  const handleClear = () => {
    if (disabled) return;
    resetCanvas();
    onChange?.(EMPTY_SIGNATURE);
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <canvas
        ref={canvasRef}
        width={640}
        height={220}
        className={`h-48 w-full touch-none rounded-md border border-dashed border-slate-300 bg-white ${
          disabled ? "opacity-60" : "cursor-crosshair"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={handleClear}
          disabled={disabled}
        >
          Borrar firma
        </button>
      </div>
    </div>
  );
}
