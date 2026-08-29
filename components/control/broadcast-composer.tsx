"use client";

import { FormEvent, Fragment, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Bold, Code2, FileUp, Image as ImageIcon, Italic, Link2, LoaderCircle, Megaphone, Play, Plus, Radio, Send, Strikethrough, TestTube2, Trash2, X } from "lucide-react";

type Campaign = {
  id: string;
  audience: string;
  segment: string;
  channel_target?: string | null;
  message: string;
  parse_mode?: string | null;
  attachment_type: string;
  attachment_url?: string | null;
  buttons?: Array<{ text: string; url: string }>;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  last_error?: string | null;
  created_at: string;
  finished_at?: string | null;
};

type BroadcastPayload = { campaigns: Campaign[]; defaultChannel: string; adminTelegramId: string | null; batchSize: number };
type Audience = "players" | "channel";
type Segment = "all" | "premium" | "donors" | "manual";
type ParseMode = "MarkdownV2" | "HTML" | "Plain";
type AttachmentType = "none" | "photo" | "document";
type Button = { text: string; url: string };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Ошибка ${response.status}`);
  return body as T;
}
function pct(done: number, total: number) { return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100; }
function date(value: string | null | undefined) { if (!value) return "—"; return new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }

function markdownPreview(text: string): ReactNode[] {
  const pattern = /(\[[^\]]+\]\(https:\/\/[^)]+\)|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;
  return text.split(pattern).map((part, index) => {
    if (/^\[[^\]]+\]\(https:\/\/[^)]+\)$/.test(part)) {
      const match = part.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
      return <span key={index} className="underline decoration-white/35 underline-offset-2">{match?.[1] || part}</span>;
    }
    if (part.startsWith("*") && part.endsWith("*")) return <strong key={index}>{part.slice(1, -1)}</strong>;
    if (part.startsWith("_") && part.endsWith("_")) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith("~") && part.endsWith("~")) return <s key={index}>{part.slice(1, -1)}</s>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-white/[.07] px-1 py-0.5 font-mono text-[.92em]">{part.slice(1, -1)}</code>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function BroadcastComposer() {
  const [data, setData] = useState<BroadcastPayload | null>(null);
  const [audience, setAudience] = useState<Audience>("players");
  const [segment, setSegment] = useState<Segment>("all");
  const [channel, setChannel] = useState("");
  const [message, setMessage] = useState("");
  const [parseMode, setParseMode] = useState<ParseMode>("MarkdownV2");
  const [attachmentType, setAttachmentType] = useState<AttachmentType>("none");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [manualIds, setManualIds] = useState("");
  const [linkPreview, setLinkPreview] = useState(true);
  const [buttons, setButtons] = useState<Button[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const payload = await json<BroadcastPayload>("/api/control/broadcasts");
      setData(payload);
      setChannel((current) => current || payload.defaultChannel || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить рассылки");
    }
  }, []);

  useEffect(() => { cancelledRef.current = false; void load(); return () => { cancelledRef.current = true; }; }, [load]);

  function insert(before: string, after = before) {
    const area = textareaRef.current;
    if (!area) { setMessage((value) => `${value}${before}${after}`); return; }
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = message.slice(start, end) || "текст";
    const next = `${message.slice(0, start)}${before}${selected}${after}${message.slice(end)}`;
    setMessage(next);
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start + before.length, start + before.length + selected.length); });
  }

  const payload = () => ({
    message,
    parseMode: parseMode === "Plain" ? null : parseMode,
    attachmentType,
    attachmentUrl: attachmentType === "none" ? null : attachmentUrl,
    buttons: buttons.filter((button) => button.text.trim() && button.url.trim()),
    linkPreview,
  });

  async function uploadImage(file: File | null) {
    if (!file) return;
    setBusy("upload"); setError(null);
    try {
      const form = new FormData();
      form.set("image", file);
      const result = await json<{ url: string }>("/api/control/upload", { method: "POST", body: form });
      setAttachmentType("photo");
      setAttachmentUrl(result.url);
      setNotice("Изображение загружено");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Загрузка не выполнена"); }
    finally { setBusy(null); }
  }

  async function testSend() {
    setBusy("test"); setError(null); setNotice(null);
    try {
      await json("/api/control/broadcasts", { method: "POST", body: JSON.stringify({ action: "test", ...payload() }) });
      setNotice(`Тест отправлен ${data?.adminTelegramId ? `на ${data.adminTelegramId}` : "администратору"}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Тест не отправлен"); }
    finally { setBusy(null); }
  }

  async function sendChannel() {
    if (!window.confirm(`Опубликовать сообщение в ${channel || "канал"}?`)) return;
    setBusy("channel"); setError(null); setNotice(null);
    try {
      await json("/api/control/broadcasts", { method: "POST", body: JSON.stringify({ action: "channel", channel, ...payload() }) });
      setNotice("Публикация отправлена в канал");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Публикация не отправлена"); }
    finally { setBusy(null); }
  }

  async function pumpCampaign(id: string) {
    let keepGoing = true;
    while (keepGoing && !cancelledRef.current) {
      const result = await json<{ campaign: Campaign }>("/api/control/broadcasts", { method: "POST", body: JSON.stringify({ action: "batch", id }) });
      const campaign = result.campaign;
      setData((current) => current ? { ...current, campaigns: current.campaigns.map((row) => row.id === id ? { ...row, ...campaign } : row) } : current);
      keepGoing = campaign.status === "sending" || campaign.status === "queued";
      if (keepGoing) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await load();
  }

  async function startPlayers() {
    if (!window.confirm("Запустить массовую рассылку? Сначала рекомендуется нажать «Тест себе».")) return;
    setBusy("start"); setError(null); setNotice(null);
    try {
      const result = await json<{ campaign: Campaign }>("/api/control/broadcasts", { method: "POST", body: JSON.stringify({ action: "start", segment, manualRecipientIds: manualIds, ...payload() }) });
      setNotice(`Рассылка создана: ${result.campaign.total_recipients} получателей`);
      await load();
      if (result.campaign.status === "sending") void pumpCampaign(result.campaign.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Рассылка остановилась"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Рассылка не создана"); }
    finally { setBusy(null); }
  }

  async function cancelCampaign(id: string) {
    await json("/api/control/broadcasts", { method: "POST", body: JSON.stringify({ action: "cancel", id }) });
    await load();
  }

  const previewText = parseMode === "MarkdownV2" ? markdownPreview(message) : message;

  return <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
    <div className="space-y-4">
      <section className="rounded-[20px] border border-white/[.07] bg-[#0b0e12] p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2 text-[13px] font-semibold"><Megaphone size={16}/>Центр рассылок</div><p className="mt-1 max-w-2xl text-[10px] leading-5 text-white/38">Telegram Bot API, сегменты аудитории, MarkdownV2/HTML, медиа, inline-кнопки, тестовая отправка и прогресс пакетной доставки.</p></div>
          <div className="inline-flex rounded-[12px] border border-white/[.07] bg-black/20 p-1">
            <button onClick={() => setAudience("players")} className={`rounded-[9px] px-3 py-1.5 text-[10px] ${audience === "players" ? "bg-white text-black" : "text-white/45"}`}><Radio size={11} className="mr-1 inline"/>Игроки</button>
            <button onClick={() => setAudience("channel")} className={`rounded-[9px] px-3 py-1.5 text-[10px] ${audience === "channel" ? "bg-white text-black" : "text-white/45"}`}><Megaphone size={11} className="mr-1 inline"/>Канал</button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_180px]">
          <div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => insert("*", "*")} className="control-small" title="Жирный"><Bold size={12}/></button>
              <button type="button" onClick={() => insert("_", "_")} className="control-small" title="Курсив"><Italic size={12}/></button>
              <button type="button" onClick={() => insert("~", "~")} className="control-small" title="Зачёркнутый"><Strikethrough size={12}/></button>
              <button type="button" onClick={() => insert("`", "`")} className="control-small" title="Код"><Code2 size={12}/></button>
              <button type="button" onClick={() => insert("[", "](https://example.com)")} className="control-small" title="Ссылка"><Link2 size={12}/></button>
              <select value={parseMode} onChange={(event) => setParseMode(event.target.value as ParseMode)} className="control-input !min-h-8 !w-auto !py-1"><option>MarkdownV2</option><option>HTML</option><option>Plain</option></select>
            </div>
            <textarea ref={textareaRef} value={message} onChange={(event) => setMessage(event.target.value)} rows={11} className="control-input min-h-[230px] resize-y !p-3 !text-[12px] !leading-6" placeholder="Напишите сообщение…\n\n*Жирный*, _курсив_, [ссылка](https://example.com)"/>
            <div className="mt-1 flex justify-between text-[8px] text-white/25"><span>{attachmentType === "none" ? "до 4096 символов" : "подпись до 1024 символов"}</span><span>{message.length}</span></div>
          </div>

          <div className="space-y-3">
            {audience === "players" ? <label className="block text-[9px] text-white/40">Аудитория<select value={segment} onChange={(event) => setSegment(event.target.value as Segment)} className="control-input mt-1.5"><option value="all">Все игроки</option><option value="premium">Premium</option><option value="donors">Платившие Stars</option><option value="manual">Список Telegram ID</option></select></label> : <label className="block text-[9px] text-white/40">Канал<input value={channel} onChange={(event) => setChannel(event.target.value)} className="control-input mt-1.5" placeholder="@channel"/></label>}
            {segment === "manual" && audience === "players" ? <label className="block text-[9px] text-white/40">Telegram ID<textarea value={manualIds} onChange={(event) => setManualIds(event.target.value)} rows={5} className="control-input mt-1.5 resize-y" placeholder="123456789, 987654321"/></label> : null}
            <label className="flex items-center justify-between rounded-[12px] border border-white/[.06] bg-black/15 px-3 py-2 text-[9px] text-white/45"><span>Preview ссылок</span><input type="checkbox" checked={linkPreview} onChange={(event) => setLinkPreview(event.target.checked)}/></label>
          </div>
        </div>

        <div className="mt-4 rounded-[16px] border border-white/[.06] bg-black/15 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="control-small cursor-pointer"><ImageIcon size={12}/>{busy === "upload" ? "Загрузка…" : "Загрузить фото"}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void uploadImage(event.target.files?.[0] || null)}/></label>
            <button onClick={() => { setAttachmentType("document"); setAttachmentUrl(""); }} className="control-small"><FileUp size={12}/>Документ URL</button>
            {attachmentType !== "none" ? <button onClick={() => { setAttachmentType("none"); setAttachmentUrl(""); }} className="control-small"><X size={12}/>Без вложения</button> : null}
          </div>
          {attachmentType !== "none" ? <input value={attachmentUrl} onChange={(event) => setAttachmentUrl(event.target.value)} className="control-input mt-2" placeholder="https://…"/> : null}
        </div>

        <div className="mt-4 rounded-[16px] border border-white/[.06] bg-black/15 p-3">
          <div className="flex items-center justify-between"><div className="text-[10px] font-medium">Inline-кнопки</div><button onClick={() => buttons.length < 8 && setButtons((current) => [...current, { text: "", url: "" }])} className="control-small"><Plus size={11}/>Кнопка</button></div>
          <div className="mt-2 space-y-2">{buttons.map((button, index) => <div key={index} className="grid gap-2 sm:grid-cols-[.6fr_1fr_32px]"><input value={button.text} onChange={(event) => setButtons((rows) => rows.map((row, i) => i === index ? { ...row, text: event.target.value } : row))} className="control-input" placeholder="Текст"/><input value={button.url} onChange={(event) => setButtons((rows) => rows.map((row, i) => i === index ? { ...row, url: event.target.value } : row))} className="control-input" placeholder="https://…"/><button onClick={() => setButtons((rows) => rows.filter((_, i) => i !== index))} className="control-icon !h-8 !w-8"><Trash2 size={12}/></button></div>)}</div>
        </div>

        {error ? <div className="control-alert control-alert-error mt-4">{error}</div> : null}
        {notice ? <div className="control-alert control-alert-ok mt-4">{notice}</div> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={Boolean(busy)} onClick={() => void testSend()} className="control-small !min-h-9"><TestTube2 size={13}/>Тест себе</button>
          {audience === "players" ? <button disabled={Boolean(busy)} onClick={() => void startPlayers()} className="control-primary"><Send size={13}/>Запустить рассылку</button> : <button disabled={Boolean(busy)} onClick={() => void sendChannel()} className="control-primary"><Send size={13}/>Опубликовать в канал</button>}
        </div>
      </section>

      <section className="rounded-[20px] border border-white/[.07] bg-[#0b0e12] p-4">
        <div className="flex items-center justify-between"><h3 className="text-[11px] font-semibold">История рассылок</h3><button onClick={() => void load()} className="control-small">Обновить</button></div>
        <div className="mt-3 space-y-2">{data?.campaigns?.length ? data.campaigns.map((campaign) => {
          const done = Number(campaign.sent_count || 0) + Number(campaign.failed_count || 0) + Number(campaign.skipped_count || 0);
          const progress = pct(done, Number(campaign.total_recipients || 0));
          return <article key={campaign.id} className="rounded-[14px] border border-white/[.055] bg-black/15 p-3"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-medium text-white/85">{campaign.audience === "channel" ? campaign.channel_target || "Канал" : campaign.segment === "all" ? "Все игроки" : campaign.segment}</span><span className="rounded-md bg-white/[.05] px-1.5 py-0.5 text-[8px] text-white/40">{campaign.status}</span><span className="ml-auto text-[8px] text-white/25">{date(campaign.created_at)}</span></div><p className="mt-1 line-clamp-2 text-[9px] leading-4 text-white/35">{campaign.message || `[${campaign.attachment_type}]`}</p>{campaign.audience === "players" ? <><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.05]"><div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${progress}%` }}/></div><div className="mt-1 flex gap-3 text-[8px] text-white/30"><span>{campaign.sent_count} доставлено</span><span>{campaign.failed_count} ошибок</span><span>{progress}%</span>{campaign.status === "sending" || campaign.status === "queued" ? <span className="ml-auto flex gap-1"><button onClick={() => void pumpCampaign(campaign.id)} className="text-white/60"><Play size={10}/></button><button onClick={() => void cancelCampaign(campaign.id)} className="text-white/40"><X size={10}/></button></span> : null}</div></> : null}{campaign.last_error ? <p className="mt-2 text-[8px] text-[var(--negative)]">{campaign.last_error}</p> : null}</article>;
        }) : <div className="py-8 text-center text-[10px] text-white/30">Рассылок ещё не было</div>}</div>
      </section>
    </div>

    <aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
      <section className="rounded-[20px] border border-white/[.07] bg-[#0b0e12] p-4"><div className="flex items-center gap-2 text-[11px] font-semibold"><Megaphone size={14}/>Telegram preview</div><div className="mt-4 rounded-[18px] bg-[#18222d] p-3 shadow-[0_14px_40px_rgba(0,0,0,.18)]"><div className="max-w-[92%] rounded-[14px_14px_14px_5px] bg-[#253445] px-3 py-2.5 text-[11px] leading-5 text-white/90 whitespace-pre-wrap">{attachmentType === "photo" && attachmentUrl ? <img src={attachmentUrl} alt="Вложение" className="mb-2 max-h-[220px] w-full rounded-[10px] object-cover"/> : null}{attachmentType === "document" && attachmentUrl ? <div className="mb-2 flex items-center gap-2 rounded-[10px] bg-black/15 p-2 text-[9px]"><FileUp size={14}/><span className="truncate">{attachmentUrl.split("/").pop() || "document"}</span></div> : null}{message ? previewText : <span className="text-white/30">Предпросмотр сообщения</span>}{buttons.filter((button) => button.text && button.url).length ? <div className="mt-2 grid gap-1">{buttons.filter((button) => button.text && button.url).map((button, index) => <div key={index} className="rounded-[8px] bg-white/[.07] px-2 py-1.5 text-center text-[9px] text-[#8fc8ff]">{button.text}</div>)}</div> : null}</div></div></section>
      <section className="rounded-[20px] border border-white/[.07] bg-[#0b0e12] p-4"><h3 className="text-[11px] font-semibold">Безопасная отправка</h3><div className="mt-3 space-y-2 text-[9px] leading-4 text-white/35"><p>1. Сначала отправьте тест себе.</p><p>2. Массовая рассылка идёт пакетами, поэтому интерфейс не зависает.</p><p>3. Заблокировавшие бота пользователи считаются ошибками доставки, но не останавливают кампанию.</p><p>4. Кампанию можно остановить или продолжить позже.</p></div>{busy ? <div className="mt-3 flex items-center gap-2 text-[9px] text-white/45"><LoaderCircle size={12} className="animate-spin"/>Выполняется операция…</div> : null}</section>
    </aside>
  </div>;
}
