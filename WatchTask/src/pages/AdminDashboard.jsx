import { useEffect, useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import { addUser, deleteUser, listUsers, updateUser } from "@/utils/APIdb";
import { processAndStorePdf } from "@/utils/pdfUtils";

function UsersTable({ users, onToggleActive, onDelete }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left border-b">
          <th className="py-2">Código</th>
          <th>Nombre</th>
          <th>Rol</th>
          <th>Especialidad</th>
          <th>Activo</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.code} className="border-b">
            <td className="py-2">{u.code}</td>
            <td>{u.name}</td>
            <td>{u.role}</td>
            <td>{u.speciality ?? "-"}</td>
            <td>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => onToggleActive(u)}
              >
                {u.active ? "Desactivar" : "Activar"}
              </button>
            </td>
            <td>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => onDelete(u)}
              >
                Eliminar
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    code: "",
    name: "",
    role: "supervisor",
    speciality: "",
    password: "",
  });
  const [pdfCount, setPdfCount] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const list = await listUsers();
    setUsers(list);
  };

  useEffect(() => {
    refresh();
  }, []);

  const onAddUser = async (e) => {
    e.preventDefault();
    await addUser({
      code: Number(form.code),
      name: form.name,
      role: form.role,
      speciality: form.speciality ? Number(form.speciality) : null,
      active: true,
      password: form.password || undefined,
    });
    setForm({
      code: "",
      name: "",
      role: "supervisor",
      speciality: "",
      password: "",
    });
    await refresh();
  };

  const onToggleActive = async (u) => {
    await updateUser(u.code, { active: !u.active });
    await refresh();
  };

  const onDelete = async (u) => {
    if (u.role === "admin") return; // don't delete admin for now
    await deleteUser(u.code);
    await refresh();
  };

  const onUploadPdf = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const count = await processAndStorePdf(file, (n) => setPdfCount(n));
      setPdfCount(count);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Panel Admin</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            {user.name} (#{user.code})
          </span>
          <button className="btn btn-outline" onClick={logout}>
            Salir
          </button>
        </div>
      </div>

      <section className="card p-4">
        <h3 className="text-lg font-semibold mb-3">Usuarios</h3>
        <form
          onSubmit={onAddUser}
          className="grid grid-cols-1 sm:grid-cols-6 gap-3 mb-4"
        >
          <input
            className="input"
            placeholder="Código"
            type="number"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
          <input
            className="input"
            placeholder="Nombre"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="supervisor">Supervisor</option>
            <option value="mantenedor">Mantenedor</option>
          </select>
          <select
            className="input"
            value={form.speciality}
            onChange={(e) => setForm({ ...form, speciality: e.target.value })}
          >
            <option value="">Sin especialidad</option>
            <option value="1">1 - Eléctrico</option>
            <option value="2">2 - Mecánico</option>
          </select>
          <input
            className="input"
            placeholder="Password (opcional)"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button className="btn btn-primary" type="submit">
            Agregar
          </button>
        </form>
        <UsersTable
          users={users}
          onToggleActive={onToggleActive}
          onDelete={onDelete}
        />
      </section>

      <section className="card p-4">
        <h3 className="text-lg font-semibold mb-3">
          Ingesta de PDF de Órdenes
        </h3>
        <input type="file" accept="application/pdf" onChange={onUploadPdf} />
        {busy && <p className="text-sm text-gray-600 mt-2">Procesando…</p>}
        {pdfCount != null && !busy && (
          <p className="text-sm text-green-700 mt-2">
            Órdenes procesadas: {pdfCount}
          </p>
        )}
      </section>
    </div>
  );
}
