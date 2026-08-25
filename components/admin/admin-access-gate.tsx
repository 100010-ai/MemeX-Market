"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";

type AdminAccess = {
  profileId: string;
  role: "owner" | "operator" | "moderator" | "analyst";
  roleLabel: string;
  source: "environment" | "database" | "key";
};

type AdminAccessContextValue = {
  access: AdminAccess;
  logout: () => Promise<void>;
};

const AdminAccessContext = createContext<AdminAccessContextValue | null>(null);

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function useAdminAccess() {
  return useContext(AdminAccessContext);
}

export function AdminAccessGate({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/auth", { cache: "no-store", credentials: "same-origin" });
      const payload = await responseJson(response);
      if (response.ok && payload.authenticated === true && payload.admin) {
        setAccess(payload.admin as AdminAccess);
        setConfigured(true);
      } else {
        setAccess(null);
        if (typeof payload.configured === "boolean") setConfigured(payload.configured);
        if (response.status !== 401) setError(typeof payload.error === "string" ? payload.error : "Не удалось проверить доступ");
      }
    } catch {
      setAccess(null);
      setError("Сервер авторизации временно недоступен");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      setAccess(null);
      setKey("");
      setError(null);
    }
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || key.length < 32) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const payload = await responseJson(response);
      if (!response.ok || payload.authenticated !== true || !payload.admin) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Доступ не подтверждён");
      }
      setAccess(payload.admin as AdminAccess);
      setKey("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Доступ не подтверждён");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return <main className="admin-auth-root"><div className="admin-auth-loading" role="status" aria-live="polite"><LoaderCircle size={18} className="animate-spin"/><span>Проверка защищённой сессии</span></div></main>;
  }

  if (!access) {
    return <main className="admin-auth-root">
      <section className="admin-auth-card" aria-labelledby="admin-auth-title">
        <header className="admin-auth-brand"><span>MXM</span><div><b>CONTROL CENTER</b><small>Owner access</small></div></header>
        <div className="admin-auth-lock"><LockKeyhole size={18}/></div>
        <h1 id="admin-auth-title">Вход владельца</h1>
        <p>Защищённый доступ к операциям, экономике и аналитике.</p>
        <form onSubmit={submit} className="admin-auth-form">
          <label htmlFor="admin-owner-key">Ключ доступа</label>
          <div className="admin-auth-key-field">
            <KeyRound size={14}/>
            <input
              id="admin-owner-key"
              name="owner-key"
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(event) => setKey(event.target.value.slice(0, 256))}
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Введите секретный ключ"
              disabled={!configured || submitting}
              minLength={32}
              maxLength={256}
              required
              autoFocus
            />
            <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "Скрыть ключ" : "Показать ключ"}>
              {showKey ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
          {error ? <div className="admin-auth-error" role="alert">{error}</div> : null}
          {!configured ? <div className="admin-auth-error" role="alert">Owner-доступ не настроен на сервере.</div> : null}
          <button className="admin-auth-submit" disabled={!configured || submitting || key.length < 32}>
            {submitting ? <LoaderCircle size={14} className="animate-spin"/> : <ShieldCheck size={14}/>} Войти
          </button>
        </form>
        <footer><span>HttpOnly session</span><span>12 часов</span><span>Rate limited</span></footer>
      </section>
    </main>;
  }

  return <AdminAccessContext.Provider value={{ access, logout }}>{children}</AdminAccessContext.Provider>;
}
