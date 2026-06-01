"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  Eraser,
  Gauge,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquareText,
  Plus,
  Send,
  Shield,
  Sparkles,
  UserRound,
  UsersRound
} from "lucide-react";
import { PUBLIC_MODELS } from "@/lib/models";

type Role = "user" | "admin";
type Status = "active" | "disabled";

type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: Status;
  dailyLimit: number;
  dailyUsed: number;
  quotaTotal: number;
  quotaUsed: number;
  remainingDaily: number;
  remainingTotal: number;
  allowedModels: string[];
  createdAt: string;
  lastLoginAt?: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

type InviteRecord = {
  code: string;
  note: string;
  maxUses: number;
  used: number;
  createdAt: string;
  disabled?: boolean;
};

type AdminStats = {
  userCount: number;
  requests: number;
  promptChars: number;
  completionChars: number;
  recent: Array<{
    email: string;
    model: string;
    at: string;
    elapsedMs: number;
    completionChars: number;
  }>;
  upstreamRecent?: Array<{
    keyLabel?: string;
    model?: string;
    ok?: boolean;
    status?: number;
    elapsedMs?: number;
  }>;
};

const examples = [
  { title: "整理资料", text: "把下面内容整理成结构清晰的要点，并给出行动建议：" },
  { title: "代码排错", text: "帮我分析这个报错的原因，并给出最小修改方案：" },
  { title: "深度问答", text: "请从多个角度分析这个问题，先给结论再解释：" },
  { title: "写作润色", text: "把下面文字改得更清楚、更有说服力，保留原意：" }
];

function parseSseChunk(chunk: string) {
  const output: string[] = [];
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const payload = JSON.parse(data);
      const text = payload?.choices?.[0]?.delta?.content;
      if (typeof text === "string") output.push(text);
    } catch {
      // Ignore incomplete fragments.
    }
  }
  return output.join("");
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload?.error || `请求失败：${response.status}`);
  }
  return payload;
}

export default function Home() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [storeConfigured, setStoreConfigured] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [view, setView] = useState<"chat" | "admin">("chat");

  const [model, setModel] = useState(PUBLIC_MODELS[0].id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const [adminUsers, setAdminUsers] = useState<PublicUser[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");

  const activeModel = useMemo(
    () => PUBLIC_MODELS.find((item) => item.id === model) ?? PUBLIC_MODELS[0],
    [model]
  );
  const selectedUser = adminUsers.find((item) => item.id === selectedUserId) ?? adminUsers[0];

  useEffect(() => {
    void refreshMe();
  }, []);

  async function refreshMe() {
    const payload = await fetch("/api/auth/me").then(
      (response) => response.json() as Promise<{ user: PublicUser | null; storeConfigured: boolean }>
    );
    setUser(payload.user);
    setStoreConfigured(payload.storeConfigured);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    try {
      const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          name: authName,
          inviteCode
        })
      }).then((response) => readJson<{ user: PublicUser }>(response));
      setUser(payload.user);
      setView("chat");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "认证失败。");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setMessages([]);
    setView("chat");
  }

  async function submitWithText(text: string) {
    const content = text.trim();
    if (!content || isSending || !user) return;

    setError("");
    setInput("");
    const nextMessages: Message[] = [...messages, { role: "user", content }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setIsSending(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: nextMessages }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `请求失败：${response.status}`);
      }

      const quotaHeader = response.headers.get("X-User-Quota");
      if (quotaHeader) setUser(JSON.parse(decodeURIComponent(quotaHeader)) as PublicUser);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let pending = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(pending);
        if (parsed) {
          assistantText += parsed;
          pending = "";
          setMessages([...nextMessages, { role: "assistant", content: assistantText }]);
        }
      }

      if (!assistantText) {
        setMessages([...nextMessages, { role: "assistant", content: "模型没有返回内容，请换一个模型再试。" }]);
      }
      void refreshMe();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "发送失败。");
        setMessages(nextMessages);
      }
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitWithText(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitWithText(input);
    }
  }

  function stopSending() {
    abortRef.current?.abort();
    setIsSending(false);
  }

  function clearChat() {
    stopSending();
    setMessages([]);
    setError("");
  }

  async function copyLastAnswer() {
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    if (last?.content) await navigator.clipboard.writeText(last.content);
  }

  async function loadAdmin() {
    setAdminLoading(true);
    try {
      const [usersPayload, statsPayload, invitePayload] = await Promise.all([
        fetch("/api/admin/users").then((response) => readJson<{ users: PublicUser[] }>(response)),
        fetch("/api/admin/stats").then((response) => readJson<AdminStats>(response)),
        fetch("/api/admin/invites").then((response) => readJson<{ invites: InviteRecord[] }>(response))
      ]);
      setAdminUsers(usersPayload.users);
      setAdminStats(statsPayload);
      setInvites(invitePayload.invites);
      if (!selectedUserId && usersPayload.users[0]) setSelectedUserId(usersPayload.users[0].id);
    } finally {
      setAdminLoading(false);
    }
  }

  async function patchUser(id: string, patch: Partial<PublicUser> & { resetDailyUsed?: boolean; resetTotalUsed?: boolean }) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch })
    }).then((response) => readJson<{ user: PublicUser }>(response));
    await loadAdmin();
  }

  async function createInvite() {
    await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxUses: 1, note: "新用户邀请" })
    }).then((response) => readJson<{ invite: InviteRecord }>(response));
    await loadAdmin();
  }

  async function disableInvite(code: string) {
    await fetch("/api/admin/invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    }).then((response) => readJson<{ invite: InviteRecord }>(response));
    await loadAdmin();
  }

  function toggleSelectedModel(modelId: string) {
    if (!selectedUser) return;
    const set = new Set(selectedUser.allowedModels);
    if (set.has(modelId)) set.delete(modelId);
    else set.add(modelId);
    void patchUser(selectedUser.id, { allowedModels: [...set] });
  }

  useEffect(() => {
    if (view === "admin" && user?.role === "admin") void loadAdmin();
  }, [view, user?.role]);

  if (!storeConfigured) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div className="brand-mark"><Shield size={22} /></div>
          <h1>还没有配置云端存储</h1>
          <p>请在 Vercel 添加 KV/Upstash Redis 的 REST 环境变量。配置后登录、额度和后台才会持久保存。</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div className="brand-mark"><Sparkles size={22} /></div>
          <h1>公益 AI 站</h1>
          <p>登录后使用模型。普通账号和管理员账号分离，注册默认需要邀请码。</p>
          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === "register" ? (
              <>
                <input className="password-input" onChange={(event) => setAuthName(event.target.value)} placeholder="昵称" value={authName} />
                <input className="password-input" onChange={(event) => setInviteCode(event.target.value)} placeholder="邀请码" value={inviteCode} />
              </>
            ) : null}
            <input className="password-input" onChange={(event) => setAuthEmail(event.target.value)} placeholder="账号或邮箱" type="text" value={authEmail} />
            <input className="password-input" onChange={(event) => setAuthPassword(event.target.value)} placeholder="密码" type="password" value={authPassword} />
            <button className="primary-action" disabled={authLoading} type="submit">
              {authLoading ? "处理中..." : authMode === "login" ? "登录" : "注册"}
            </button>
          </form>
          {authError ? <div className="error">{authError}</div> : null}
          <button className="text-action" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")} type="button">
            {authMode === "login" ? "没有账号，使用邀请码注册" : "已有账号，去登录"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <section className="brand">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="brand-mark"><Sparkles size={22} /></div>
            <div>
              <h1 className="brand-title">公益 AI 站</h1>
              <p className="brand-subtitle">{user.name} · {user.role === "admin" ? "管理员" : "普通用户"}</p>
            </div>
          </div>
          <div className="status-pill"><CheckCircle2 size={14} /> 在线</div>
        </section>

        <section className="quota-card">
          <div><span>今日额度</span><strong>{user.dailyLimit < 0 ? "无限" : `${user.dailyUsed}/${user.dailyLimit}`}</strong></div>
          <div><span>总额度</span><strong>{user.quotaTotal < 0 ? "无限" : `${user.quotaUsed}/${user.quotaTotal}`}</strong></div>
        </section>

        <section className="nav-row">
          <button className={view === "chat" ? "nav-button active" : "nav-button"} onClick={() => setView("chat")}><MessageSquareText size={16} /> 聊天</button>
          {user.role === "admin" ? (
            <button className={view === "admin" ? "nav-button active" : "nav-button"} onClick={() => setView("admin")}><LayoutDashboard size={16} /> 后台</button>
          ) : null}
          <button className="nav-button" onClick={logout}><LogOut size={16} /> 退出</button>
        </section>

        <section className="model-list" aria-label="模型列表">
          {PUBLIC_MODELS.map((item) => {
            const allowed = user.role === "admin" || user.allowedModels.includes(item.id);
            return (
              <button className={`model-button${item.id === model ? " active" : ""}`} disabled={!allowed} key={item.id} onClick={() => setModel(item.id)} type="button">
                <div>
                  <div className="model-name"><MessageSquareText size={16} /><span>{item.label}</span></div>
                  <div className="model-meta">{item.vendor} · {allowed ? item.purpose : "未开放"}</div>
                </div>
                <span className="model-badge">{item.badge}</span>
              </button>
            );
          })}
        </section>
      </aside>

      {view === "admin" && user.role === "admin" ? (
        <section className="admin-area">
          <header className="topbar">
            <div><h2>管理后台</h2><p>管理用户、邀请码、额度、模型权限和 key pool 调用状态。</p></div>
            <button className="primary-action small" onClick={loadAdmin} disabled={adminLoading}>刷新</button>
          </header>
          <section className="admin-content">
            <div className="stats-grid">
              <div className="stat-card"><UsersRound size={18} /><span>用户数</span><strong>{adminStats?.userCount ?? "-"}</strong></div>
              <div className="stat-card"><Gauge size={18} /><span>请求数</span><strong>{adminStats?.requests ?? "-"}</strong></div>
              <div className="stat-card"><MessageSquareText size={18} /><span>输出字符</span><strong>{adminStats?.completionChars ?? "-"}</strong></div>
            </div>

            <div className="admin-grid">
              <section className="admin-card">
                <div className="admin-card-head"><h3>邀请码</h3><button onClick={createInvite}><Plus size={14} /> 生成</button></div>
                <div className="invite-list">
                  {invites.map((invite) => (
                    <div className="invite-item" key={invite.code}>
                      <strong>{invite.code}</strong>
                      <span>{invite.used}/{invite.maxUses} · {invite.disabled ? "已停用" : "可用"}</span>
                      {!invite.disabled ? <button onClick={() => disableInvite(invite.code)}>停用</button> : null}
                    </div>
                  ))}
                </div>
              </section>

              <section className="admin-card">
                <h3>用户精细设置</h3>
                {selectedUser ? (
                  <div className="edit-panel">
                    <select className="password-input" value={selectedUser.id} onChange={(event) => setSelectedUserId(event.target.value)}>
                      {adminUsers.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}
                    </select>
                    <div className="edit-row">
                      <input className="password-input" type="number" defaultValue={selectedUser.dailyLimit} id="dailyLimitInput" />
                      <button onClick={() => {
                        const el = document.getElementById("dailyLimitInput") as HTMLInputElement;
                        void patchUser(selectedUser.id, { dailyLimit: Number(el.value) });
                      }}>设置今日额度</button>
                    </div>
                    <div className="edit-row">
                      <input className="password-input" type="number" defaultValue={selectedUser.quotaTotal} id="quotaTotalInput" />
                      <button onClick={() => {
                        const el = document.getElementById("quotaTotalInput") as HTMLInputElement;
                        void patchUser(selectedUser.id, { quotaTotal: Number(el.value) });
                      }}>设置总额度</button>
                    </div>
                    <div className="row-actions">
                      <button onClick={() => patchUser(selectedUser.id, { resetDailyUsed: true })}>清零今日已用</button>
                      <button onClick={() => patchUser(selectedUser.id, { resetTotalUsed: true })}>清零总已用</button>
                      <button onClick={() => patchUser(selectedUser.id, { status: selectedUser.status === "active" ? "disabled" : "active" })}>{selectedUser.status === "active" ? "禁用" : "启用"}</button>
                    </div>
                    <div className="model-checks">
                      {PUBLIC_MODELS.map((item) => (
                        <label key={item.id}>
                          <input checked={selectedUser.allowedModels.includes(item.id)} onChange={() => toggleSelectedModel(item.id)} type="checkbox" />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : <p className="empty-copy">暂无用户。</p>}
              </section>
            </div>

            <div className="table-wrap">
              <table>
                <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>今日</th><th>总额度</th><th>操作</th></tr></thead>
                <tbody>
                  {adminUsers.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.name}</strong><span>{item.email}</span></td>
                      <td>{item.role}</td>
                      <td>{item.status}</td>
                      <td>{item.dailyLimit < 0 ? "无限" : `${item.dailyUsed}/${item.dailyLimit}`}</td>
                      <td>{item.quotaTotal < 0 ? "无限" : `${item.quotaUsed}/${item.quotaTotal}`}</td>
                      <td><div className="row-actions">
                        <button onClick={() => setSelectedUserId(item.id)}>编辑</button>
                        <button onClick={() => patchUser(item.id, { role: item.role === "admin" ? "user" : "admin" })}>切换角色</button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : (
        <section className="chat-area">
          <header className="topbar">
            <div><h2>{activeModel.label}</h2><p>{activeModel.description}</p></div>
            <div className="toolbar">
              <button className="icon-button" onClick={copyLastAnswer} title="复制最后回复" type="button"><Copy size={18} /></button>
              <button className="icon-button" onClick={clearChat} title="清空对话" type="button"><Eraser size={18} /></button>
            </div>
          </header>

          <section className="messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div><h3 className="empty-title">选择一个模型，开始提问。</h3><p className="empty-copy">当前账号会按请求次数扣额度。管理员可以在后台管理邀请码、额度和模型权限。</p></div>
                <div className="prompt-grid">
                  {examples.map((example) => (
                    <button className="prompt-button" key={example.title} onClick={() => setInput(example.text)} type="button">
                      <strong>{example.title}</strong><span>{example.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : messages.map((message, index) => (
              <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                <div className="avatar">{message.role === "user" ? <UserRound size={18} /> : <Bot size={18} />}</div>
                <div className="bubble">{message.content || (isSending && index === messages.length - 1 ? "正在生成..." : "")}</div>
              </article>
            ))}
          </section>

          <footer className="composer">
            <form className="composer-box" onSubmit={onSubmit}>
              <textarea className="composer-input" disabled={isSending} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} placeholder={`发送给 ${activeModel.label}`} rows={2} value={input} />
              {isSending ? (
                <button className="send-button" onClick={stopSending} title="停止生成" type="button"><Loader2 size={20} /></button>
              ) : (
                <button className="send-button" disabled={!input.trim()} title="发送" type="submit"><Send size={20} /></button>
              )}
            </form>
            <div className="composer-note">Enter 发送，Shift + Enter 换行。</div>
            {error ? <div className="composer-note error" role="alert">{error}</div> : null}
          </footer>
        </section>
      )}
    </main>
  );
}
