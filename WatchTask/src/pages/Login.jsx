import { useState } from "react";
import { useAuth } from "@/Context/AuthContext";
import { useNavigate } from "react-router";

export default function Login() {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const res = await login({ code, password });
    if (res.ok) {
      if (res.user.role === "admin") navigate("/admin");
      else if (res.user.role === "supervisor") navigate("/supervisor");
      else if (res.user.role === "mantenedor") navigate("/mantenedor");
      else navigate("/login"); // Para otros roles sin vista
    } else setError(res.error || "Error de autenticación");
  };

  return (
    <div className="max-w-md mx-auto mt-16 p-6 bg-white shadow card">
      <h2 className="text-xl font-semibold mb-4">Iniciar sesión</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Código</label>
          <input
            type="number"
            className="input w-full"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <input
            type="password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error ? <p className="text-red-600 text-sm">{error}</p> : null}
        <button type="submit" className="btn btn-primary w-full">
          Entrar
        </button>
      </form>
      <p className="text-xs text-gray-500 mt-3">Usa las credenciales de .env</p>
    </div>
  );
}
