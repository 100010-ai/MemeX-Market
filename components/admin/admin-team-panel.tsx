"use client";

import { useMemo, useState } from "react";
import { Check, KeyRound, Search, Shield, ShieldCheck, UserCog, UserMinus, UserPlus } from "lucide-react";
import type { AdminContext, AdminMember, AdminRole } from "@/components/admin/admin-types";

type ProfileOption = { id: string; telegram_id: number; username: string | null; first_name: string; is_system: boolean };
type AdminAction = (action: string, payload?: Record<string, unknown>) => Promise<void>;

const roleLabels: Record<AdminRole, string> = { owner: "Владелец", operator: "Оператор", moderator: "Модератор", analyst: "Аналитик" };
const roleDescriptions: Record<AdminRole, string> = {
  owner: "Полный контроль, включая команду и экономику.",
  operator: "Ежедневные операции, контент, каталог и модерация.",
  moderator: "Игроки, мемкоины, подарки и журнал действий.",
  analyst: "Аналитика, риски, health и аудит без изменений данных.",
};
const permissionLabels: Record<string, string> = {
  "analytics.read": "Аналитика",
  "players.manage": "Игроки",
  "economy.manage": "Экономика",
  "coins.manage": "Мемкоины",
  "gifts.manage": "Подарки",
  "catalog.manage": "Каталог",
  "promos.manage": "Промокоды",
  "missions.manage": "Задания",
  "risk.read": "Риски",
  "health.read": "Health",
  "runtime.manage": "Runtime",
  "admins.manage": "Команда",
  "audit.read": "Аудит",
  "assets.manage": "Медиа",
};
const rolePermissions: Record<AdminRole, string[]> = {
  owner: Object.keys(permissionLabels),
  operator: ["analytics.read", "players.manage", "coins.manage", "gifts.manage", "catalog.manage", "promos.manage", "missions.manage", "risk.read", "health.read", "audit.read", "assets.manage"],
  moderator: ["analytics.read", "players.manage", "coins.manage", "gifts.manage", "risk.read", "audit.read"],
  analyst: ["analytics.read", "risk.read", "health.read", "audit.read"],
};

function memberName(member: AdminMember) {
  return member.username ? `@${member.username}` : member.firstName;
}

export function AdminTeamPanel({ admin, members, profiles, busy, act }: { admin: AdminContext; members: AdminMember[]; profiles: ProfileOption[]; busy: string | null; act: AdminAction }) {
  const canManage = admin.permissions.includes("admins.manage");
  const [profileId, setProfileId] = useState("");
  const [role, setRole] = useState<AdminRole>("analyst");
  const [permissions, setPermissions] = useState<string[]>(rolePermissions.analyst);
  const [search, setSearch] = useState("");
  const candidates = useMemo(() => profiles.filter((profile) => !profile.is_system && `${profile.username || ""} ${profile.first_name} ${profile.telegram_id}`.toLowerCase().includes(search.toLowerCase())).slice(0, 8), [profiles, search]);

  function selectRole(next: AdminRole) {
    setRole(next);
    setPermissions([...rolePermissions[next]]);
  }
  function editMember(member: AdminMember) {
    setProfileId(member.profileId);
    setSearch(memberName(member));
    setRole(member.role);
    setPermissions(member.permissions.length ? [...member.permissions] : [...rolePermissions[member.role]]);
  }
  function togglePermission(permission: string) {
    setPermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  }

  const primaryOwner = admin.source === "environment" || admin.source === "key";
  return <div className="admin-team-layout">
    <section className="admin-team-summary"><div><span className="admin-dashboard-kicker"><UserCog size={12}/> ACCESS CONTROL</span><h2>Команда и полномочия</h2><p>Роли по умолчанию можно точечно ограничить или расширить. Каждое изменение попадёт в аудит.</p></div><div className="admin-team-count"><strong>{members.filter((member) => member.active).length + (primaryOwner ? 1 : 0)}</strong><span>активных администраторов</span></div></section>

    <div className="admin-team-grid">
      <section className="admin-team-members"><header><div><span>TEAM</span><h3>Действующие доступы</h3></div><ShieldCheck size={15}/></header><div className="admin-member-list">
        {primaryOwner ? <article className="admin-member-card is-owner"><span className="admin-member-avatar"><ShieldCheck size={15}/></span><div><b>Основной владелец</b><small>{admin.source === "key" ? "Защищённая browser-сессия" : "Telegram ID из окружения"}</small></div><em>Владелец</em><span className="admin-member-status">{admin.source === "key" ? "KEY" : "ENV"}</span></article> : null}
        {members.map((member) => <article key={member.profileId} className={`admin-member-card ${member.active ? "" : "is-disabled"}`}><span className="admin-member-avatar"><Shield size={15}/></span><button type="button" onClick={() => editMember(member)}><b>{memberName(member)}</b><small>TG {member.telegramId} · {member.permissions.length || rolePermissions[member.role].length} прав</small></button><em>{roleLabels[member.role]}</em>{canManage && member.profileId !== admin.profileId ? <button type="button" className="admin-member-remove" disabled={Boolean(busy)} onClick={() => void act("admin.member.revoke", { profileId: member.profileId })} aria-label={`Отозвать доступ у ${memberName(member)}`}><UserMinus size={13}/></button> : <span className="admin-member-status">{member.active ? "ON" : "OFF"}</span>}</article>)}
        {!members.length && !primaryOwner ? <div className="admin-panel-empty">Администраторы ещё не назначены.</div> : null}
      </div></section>

      <section className="admin-access-editor"><header><div><span>PERMISSIONS</span><h3>{profileId ? "Изменить доступ" : "Назначить администратора"}</h3></div><KeyRound size={15}/></header>{canManage ? <div className="admin-access-form">
        <label><span>Игрок</span><div className="admin-profile-picker"><Search size={13}/><input value={search} onChange={(event) => { setSearch(event.target.value); setProfileId(""); }} placeholder="Имя, @username или Telegram ID"/></div></label>
        {search && !profileId ? <div className="admin-profile-results">{candidates.map((profile) => <button key={profile.id} type="button" onClick={() => { setProfileId(profile.id); setSearch(profile.username ? `@${profile.username}` : profile.first_name); }}><span>{profile.username ? `@${profile.username}` : profile.first_name}</span><small>TG {profile.telegram_id}</small></button>)}</div> : null}
        <div><span className="admin-field-label">Роль</span><div className="admin-role-grid">{(Object.keys(roleLabels) as AdminRole[]).map((key) => <button key={key} type="button" onClick={() => selectRole(key)} className={role === key ? "is-active" : ""}><span>{roleLabels[key]}</span><small>{roleDescriptions[key]}</small>{role === key ? <Check size={12}/> : null}</button>)}</div></div>
        <div><div className="admin-permissions-head"><span className="admin-field-label">Точные разрешения</span><small>{permissions.length} из {Object.keys(permissionLabels).length}</small></div><div className="admin-permission-grid">{Object.entries(permissionLabels).map(([key, label]) => <label key={key} className={permissions.includes(key) ? "is-checked" : ""}><input type="checkbox" checked={permissions.includes(key)} onChange={() => togglePermission(key)}/><span><Check size={10}/></span>{label}</label>)}</div></div>
        <button type="button" className="control-primary admin-access-save" disabled={Boolean(busy) || !profileId || !permissions.length} onClick={() => void act("admin.member.upsert", { profileId, role, permissions })}><UserPlus size={13}/>{profileId && members.some((member) => member.profileId === profileId) ? "Сохранить полномочия" : "Назначить доступ"}</button>
      </div> : <div className="admin-access-locked"><Shield size={20}/><b>Только для владельца</b><p>У вашей роли нет разрешения на управление командой. Список доступов остаётся видимым для прозрачности.</p></div>}</section>
    </div>
  </div>;
}
