import { useEffect, useState, useMemo, useRef, useCallback } from "react";

/* ─── Types ─── */

type Decision =
  | "recommended" | "watch" | "manual_review" | "not_recommended" | "rejected";

interface ApiTender {
  city: string; url: string; title: string;
  budgetAmount: number | null; deadlineTime: string;
  qualificationRequirements: { name: string; level: string }[];
  personnelRequirements: string[]; performanceRequirements: string[];
  analysis: { decision: Decision; matchScore: number; matchedPoints: string[]; riskPoints: string[]; manualReviewRequired: boolean; };
}

interface CompanyProfile {
  id: number; companyName: string; maxProjectAmount: number; minProjectAmount: number; minRemainingDays: number;
  preferredRegions: string[]; preferredProjectTypes: string[]; excludedKeywords: string[];
  qualifications?: Qualification[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EditTarget = Record<string, any>;

interface Qualification { id: number; name: string; level: string; validTo: string | null; }
interface Personnel { id: number; personName: string; certificateType: string | null; major: string | null; level: string | null; validTo: string | null; }
interface Performance { id: number; projectName: string; projectType: string | null; amount: number | null; completionDate: string | null; }

/* ─── Constants ─── */

const DECISION_LABELS: Record<Decision, string> = {
  recommended: "推荐参与", watch: "可关注", manual_review: "需人工确认", not_recommended: "不建议", rejected: "明确不满足"
};
const DECISION_CLASS: Record<Decision, string> = {
  recommended: "decision--recommended", watch: "decision--watch", manual_review: "decision--manual_review",
  not_recommended: "decision--not_recommended", rejected: "decision--rejected"
};
const DECISION_SORT: Record<Decision, number> = { recommended: 0, watch: 1, manual_review: 2, not_recommended: 3, rejected: 4 };

const API = "/api"; const PAGE_SIZE = 10;
type LoadingState = "idle" | "loading" | "error" | "ready";
type SortKey = "decision" | "score" | "deadline" | "amount";
type AdminTab = "qualifications" | "personnel" | "performances" | "preferences";

/* ─── Helpers ─── */

function formatAmount(y: number | null | undefined): string {
  if (y == null) return "未披露";
  if (y >= 10_000) return `${(y / 10_000).toLocaleString()} 万元`;
  return `${y.toLocaleString()} 元`;
}
function formatDeadline(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function scoreClass(s: number): string { return s >= 85 ? "score--high" : s >= 70 ? "score--mid" : "score--low"; }

/* ─── Small Components ─── */

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return <article className="metric"><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong></article>;
}
function DecisionBadge({ decision }: { decision: Decision }) {
  return <span className={`decision ${DECISION_CLASS[decision]}`}>{DECISION_LABELS[decision]}</span>;
}
function Spinner() {
  return <div className="loading-state"><div className="spinner" /><p>正在加载…</p></div>;
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-state"><p className="error-icon">⚠</p><p className="error-message">{message}</p><button className="btn btn-primary" onClick={onRetry}>重试</button></div>;
}

/* ─── Modal ─── */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ─── Upload Zone ─── */

function UploadZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/") || f.type === "application/pdf");
    if (files.length) onFiles(files);
  }, [onFiles]);

  return (
    <div
      className={`upload-zone ${dragging ? "upload-zone--active" : ""}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" style={{ display: "none" }}
        onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) onFiles(files); }} />
      <p className="upload-zone-icon">📄</p>
      <p>拖拽资质证书文件到此处，或点击选择</p>
      <p className="upload-zone-hint">支持 JPG/PNG/PDF，可多选，单文件 ≤ 10MB</p>
    </div>
  );
}

/* ─── Admin Form Components ─── */

function AdminForm({ onSubmit, initial, onCancel, fields }: {
  onSubmit: (data: Record<string, string>) => void;
  initial?: Record<string, string>;
  onCancel: () => void;
  fields: { key: string; label: string; type?: string }[];
}) {
  const [form, setForm] = useState<Record<string, string>>(initial ?? {});
  useEffect(() => { if (initial) setForm(initial); }, [initial]);
  return (
    <form className="admin-form" onSubmit={e => { e.preventDefault(); onSubmit(form); }}>
      {fields.map(f => (
        <label key={f.key}>
          <span>{f.label}</span>
          <input type={f.type ?? "text"} value={form[f.key] ?? ""}
            onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
        </label>
      ))}
      <div className="admin-form-btns">
        <button type="submit" className="btn btn-primary">保存</button>
        <button type="button" className="btn" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}

function AdminList<T extends { id: number }>({ items, render, onDelete, onEdit, addLabel, adding, onAdd, addForm }: {
  items: T[]; render: (item: T) => React.ReactNode;
  onDelete: (id: number) => void; onEdit: (item: T) => void;
  addLabel: string; adding: boolean; onAdd: () => void;
  addForm?: React.ReactNode;
}) {
  return (
    <div className="admin-list">
      {items.map(item => (
        <div key={item.id} className="admin-row">
          <div className="admin-row-content">{render(item)}</div>
          <div className="admin-row-actions">
            <button className="btn" onClick={() => onEdit(item)}>编辑</button>
            <button className="btn" onClick={() => { if (confirm("确认删除？")) onDelete(item.id); }}>删除</button>
          </div>
        </div>
      ))}
      {!adding && <button className="btn btn-primary" onClick={onAdd}>{addLabel}</button>}
      {adding && addForm}
    </div>
  );
}

/* ─── Main App ─── */

export function App() {
  const [mode, setMode] = useState<"dashboard" | "admin">("dashboard");
  const [adminTab, setAdminTab] = useState<AdminTab>("qualifications");

  // Dashboard state
  const [tenders, setTenders] = useState<ApiTender[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [tenderState, setTenderState] = useState<LoadingState>("idle");
  const [companyState, setCompanyState] = useState<LoadingState>("idle");
  const [sortBy, setSortBy] = useState<SortKey>("decision");
  const [page, setPage] = useState(1);

  // Admin state
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [perfs, setPerfs] = useState<Performance[]>([]);
  const [prefs, setPrefs] = useState<CompanyProfile | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);

  // Upload & AI extraction
  const [uploading, setUploading] = useState(false);
  const [extracted, setExtracted] = useState<{ name: string; level: string; validTo: string | null; confidence: string }[]>([]);
  const [showPrefsModal, setShowPrefsModal] = useState(false);

  async function handleUpload(files: File[]) {
    setUploading(true); setExtracted([]);
    const form = new FormData();
    files.forEach(f => form.append("files", f));
    try {
      const r = await fetch(`${API}/company/qualifications/upload`, { method: "POST", body: form });
      const data = await r.json();
      if (data.extracted) setExtracted(data.extracted);
    } catch (err) { console.error("Upload failed:", err); }
    setUploading(false);
  }

  async function confirmExtracted(items: typeof extracted) {
    if (!items.length) return;
    await fetch(`${API}/company/qualifications/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qualifications: items.map(({ name, level, validTo }) => ({ name, level, validTo })) })
    });
    setExtracted([]); fetchAdmin();
  }

  /* ─── Fetch ─── */

  async function fetchTenders() {
    setTenderState("loading");
    try { const r = await fetch(`${API}/tenders`); if (!r.ok) throw new Error(""); setTenders(await r.json()); setTenderState("ready"); }
    catch { setTenderState("error"); }
  }
  async function fetchCompany() {
    setCompanyState("loading");
    try {
      const r = await fetch(`${API}/company/profile`);
      if (!r.ok) throw new Error("");
      setCompany(await r.json()); setCompanyState("ready");
    } catch { setCompanyState("error"); }
  }
  async function fetchAdmin() {
    setAdminLoading(true);
    try {
      const [q, p, f, pf] = await Promise.all([
        fetch(`${API}/company/qualifications`).then(r => r.json()),
        fetch(`${API}/company/personnel`).then(r => r.json()),
        fetch(`${API}/company/performances`).then(r => r.json()),
        fetch(`${API}/company/profile`).then(r => r.json())
      ]);
      setQuals(q); setPersonnel(p); setPerfs(f); setPrefs(pf);
    } catch { /* ignore */ }
    setAdminLoading(false);
  }

  useEffect(() => { fetchTenders(); fetchCompany(); }, []);
  useEffect(() => { if (mode === "admin") fetchAdmin(); }, [mode]);

  /* ─── Admin actions ─── */

  async function saveItem(url: string, method: string, body: Record<string, unknown>) {
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    fetchAdmin(); setAdding(false); setEditing(null);
  }
  async function deleteItem(url: string) { await fetch(url, { method: "DELETE" }); fetchAdmin(); }

  /* ─── Dashboard computed ─── */

  const sorted = useMemo(() => {
    const s = [...tenders];
    s.sort((a, b) => {
      switch (sortBy) {
        case "decision": return DECISION_SORT[a.analysis.decision] - DECISION_SORT[b.analysis.decision];
        case "score": return b.analysis.matchScore - a.analysis.matchScore;
        case "deadline": return (a.deadlineTime ? new Date(a.deadlineTime).getTime() : 0) - (b.deadlineTime ? new Date(b.deadlineTime).getTime() : 0);
        case "amount": return (b.budgetAmount ?? 0) - (a.budgetAmount ?? 0);
        default: return 0;
      }
    });
    return s;
  }, [tenders, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const metrics = useMemo(() => {
    const now = Date.now(); const soon = now + 3 * 86400000;
    return [
      { label: "公告总数", value: tenders.length },
      { label: "推荐参与", value: tenders.filter(t => t.analysis.decision === "recommended").length },
      { label: "需人工确认", value: tenders.filter(t => t.analysis.decision === "manual_review").length },
      { label: "即将截止", value: tenders.filter(t => { if (!t.deadlineTime) return false; const d = new Date(t.deadlineTime).getTime(); return d > now && d <= soon; }).length },
    ];
  }, [tenders]);

  function handleSort(key: SortKey) { setSortBy(key); setPage(1); }

  /* ─── Render ─── */

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <p className="topbar-eyebrow">工程投标智能分析平台</p>
          <h1>Tender Insight</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className={`btn ${mode === "dashboard" ? "btn-primary" : ""}`} onClick={() => setMode("dashboard")}>仪表盘</button>
          <button className={`btn ${mode === "admin" ? "btn-primary" : ""}`} onClick={() => setMode("admin")}>管理后台</button>
          <span className="mvp-badge" title="MVP">MVP</span>
        </div>
      </header>

      {mode === "dashboard" ? (
        <>
          <section className="metrics-grid">{metrics.map(m => <MetricCard key={m.label} {...m} />)}</section>
          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <div><p className="panel-eyebrow">多城市 · 建设工程</p><h2>招标公告初筛</h2></div>
                <button className="btn btn-primary" onClick={fetchTenders} disabled={tenderState === "loading"}>刷新</button>
              </div>
              {tenderState === "loading" && tenders.length === 0 && <Spinner />}
              {tenderState === "error" && tenders.length === 0 && <ErrorState message="加载失败" onRetry={fetchTenders} />}
              {tenderState === "ready" && tenders.length === 0 && <div className="empty-state-full"><p>暂无招标公告</p></div>}
              {tenders.length > 0 && (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead><tr>
                        <th>项目名称</th><th>城市</th>
                        <th className="sortable" onClick={() => handleSort("amount")}>金额{sortBy === "amount" ? " ▾" : ""}</th>
                        <th className="sortable" onClick={() => handleSort("deadline")}>截止时间{sortBy === "deadline" ? " ▾" : ""}</th>
                        <th className="sortable" onClick={() => handleSort("score")}>匹配分{sortBy === "score" ? " ▾" : ""}</th>
                        <th className="sortable" onClick={() => handleSort("decision")}>判断{sortBy === "decision" ? " ▾" : ""}</th>
                      </tr></thead>
                      <tbody>
                        {paged.map(t => (
                          <tr key={t.url}>
                            <td className="col-title">
                              {t.analysis.riskPoints.length > 0 && <span className="risk-dot" />}
                              <a className="tender-link" href={t.url} target="_blank" rel="noopener noreferrer" title={t.title}>{t.title}</a>
                            </td>
                            <td>{t.city}</td>
                            <td className="col-num">{formatAmount(t.budgetAmount)}</td>
                            <td className="col-date">{formatDeadline(t.deadlineTime)}</td>
                            <td className={`col-num score ${scoreClass(t.analysis.matchScore)}`}>{t.analysis.matchScore}</td>
                            <td style={{ textAlign: "center" }}><DecisionBadge decision={t.analysis.decision} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination">
                    <span className="pagination-info">共 {sorted.length} 条，第 {safePage}/{totalPages} 页</span>
                    <div className="pagination-btns">
                      <button className="btn" disabled={safePage <= 1} onClick={() => setPage(1)}>首页</button>
                      <button className="btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
                      <button className="btn" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>下一页</button>
                      <button className="btn" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>末页</button>
                    </div>
                  </div>
                </>
              )}
            </article>
            <aside className="panel company-panel">
              {companyState === "loading" && <Spinner />}
              {company && <>
                <p className="panel-eyebrow">公司能力库</p>
                <h2>{company.companyName}</h2>
                <p className="qualification-section-title">企业资质</p>
                <ul className="qualification-list">
                  {(company.qualifications ?? []).map((q: Qualification) => (
                    <li key={q.name}><span className="qualification-level-tag">{q.level}</span><div>{q.name}<div className="qualification-expiry">至 {formatDate(q.validTo)}</div></div></li>
                  ))}
                </ul>
                <p className="qualification-section-title">投标偏好</p>
                <div className="preference-tags">{company.preferredRegions?.map(r => <span key={r} className="preference-tag">{r}</span>)}</div>
                <div style={{ fontSize: 12, color: "var(--color-muted)", margin: "6px 0 2px" }}>项目类型</div>
                <div className="preference-tags">{company.preferredProjectTypes?.map(r => <span key={r} className="preference-tag">{r}</span>)}</div>
                <div style={{ fontSize: 12, color: "var(--color-muted)", margin: "6px 0 2px" }}>排除关键词</div>
                <div className="preference-tags">{company.excludedKeywords?.map(r => <span key={r} className="preference-tag preference-tag--exclude">{r}</span>)}</div>
                <p className="qualification-section-title">承接能力</p>
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  金额范围：<strong>{formatAmount(company.minProjectAmount)} ~ {formatAmount(company.maxProjectAmount)}</strong><br/>
                  最低准备：<strong>{company.minRemainingDays} 天</strong>
                </div>
              </>}
            </aside>
          </section>
        </>
      ) : (
        /* ─── Admin Panel ─── */
        <section className="admin-panel">
          <nav className="admin-tabs">
            {(["qualifications", "personnel", "performances", "preferences"] as AdminTab[]).map(tab => (
              <button key={tab} className={`btn ${adminTab === tab ? "btn-primary" : ""}`}
                onClick={() => { setAdminTab(tab); setAdding(false); setEditing(null); }}>
                {{ qualifications: "企业资质", personnel: "人员证书", performances: "历史业绩", preferences: "投标偏好" }[tab]}
              </button>
            ))}
          </nav>

          {adminLoading ? <Spinner /> : (
            <div className="admin-content">
              {/* Qualifications */}
              {adminTab === "qualifications" && (
                <>
                  <UploadZone onFiles={handleUpload} />
                  {uploading && <div className="loading-state"><div className="spinner" /><p>AI 正在识别证书…</p></div>}
                  {extracted.length > 0 && (
                    <div className="extracted-results">
                      <p className="extracted-title">AI 识别结果（请确认后入库）</p>
                      {extracted.map((q, i) => (
                        <div key={i} className="extracted-row">
                          <span><strong>{q.name}</strong> — {q.level}</span>
                          {q.validTo && <span className="admin-meta">有效期至 {q.validTo}</span>}
                          <span className={`confidence confidence--${q.confidence}`}>{q.confidence === "high" ? "高置信" : "中置信"}</span>
                        </div>
                      ))}
                      <div className="extracted-actions">
                        <button className="btn btn-primary" onClick={() => confirmExtracted(extracted)}>全部确认入库</button>
                        <button className="btn" onClick={() => setExtracted([])}>放弃</button>
                      </div>
                    </div>
                  )}
                  <hr style={{ margin: "20px 0", border: "none", borderTop: "1px solid var(--color-border)" }} />
                  <AdminList items={quals} render={q => <><strong>{q.name}</strong> <span className="qualification-level-tag">{q.level}</span> <span className="admin-meta">有效期至 {formatDate(q.validTo)}</span></>}
                    onDelete={id => deleteItem(`${API}/company/qualifications/${id}`)}
                    onEdit={q => { setEditing(q); setAdding(true); }}
                    addLabel="+ 手动新增资质" adding={adding} onAdd={() => { setAdding(true); setEditing(null); }}
                    addForm={<AdminForm
                      fields={[{ key: "name", label: "资质名称" }, { key: "level", label: "等级" }, { key: "validTo", label: "有效期至", type: "date" }]}
                      initial={editing ? { name: editing.name as string, level: editing.level as string, validTo: editing.validTo as string } : undefined}
                      onCancel={() => { setAdding(false); setEditing(null); }}
                      onSubmit={data => {
                        if (editing) saveItem(`${API}/company/qualifications/${editing.id}`, "PUT", data);
                        else saveItem(`${API}/company/qualifications`, "POST", data);
                      }}
                    />}
                  />
                </>
              )}

              {/* Personnel */}
              {adminTab === "personnel" && (
                <AdminList items={personnel} render={p => <><strong>{p.personName}</strong> {p.certificateType && <span>{p.certificateType}</span>} {p.major && <span>{p.major}专业</span>} {p.level && <span className="qualification-level-tag">{p.level}</span>} <span className="admin-meta">至 {formatDate(p.validTo)}</span></>}
                  onDelete={id => deleteItem(`${API}/company/personnel/${id}`)}
                  onEdit={p => { setEditing(p); setAdding(true); }}
                  addLabel="+ 新增人员" adding={adding} onAdd={() => { setAdding(true); setEditing(null); }}
                  addForm={<AdminForm
                    fields={[{ key: "personName", label: "姓名" }, { key: "certificateType", label: "证书类型" }, { key: "major", label: "专业" }, { key: "level", label: "等级" }, { key: "validTo", label: "有效期至", type: "date" }]}
                    initial={editing ? editing as Record<string, string> : undefined}
                    onCancel={() => { setAdding(false); setEditing(null); }}
                    onSubmit={data => {
                      if (editing) saveItem(`${API}/company/personnel/${editing.id}`, "PUT", data);
                      else saveItem(`${API}/company/personnel`, "POST", data);
                    }}
                  />}
                />
              )}

              {/* Performance */}
              {adminTab === "performances" && (
                <AdminList items={perfs} render={p => <><strong>{p.projectName}</strong> {p.projectType && <span className="preference-tag">{p.projectType}</span>} {p.amount && <span>{formatAmount(p.amount)}</span>} <span className="admin-meta">{formatDate(p.completionDate)}</span></>}
                  onDelete={id => deleteItem(`${API}/company/performances/${id}`)}
                  onEdit={p => { setEditing(p); setAdding(true); }}
                  addLabel="+ 新增业绩" adding={adding} onAdd={() => { setAdding(true); setEditing(null); }}
                  addForm={<AdminForm
                    fields={[{ key: "projectName", label: "项目名称" }, { key: "projectType", label: "项目类型" }, { key: "amount", label: "金额(元)" }, { key: "completionDate", label: "完工日期", type: "date" }]}
                    initial={editing ? editing as Record<string, string> : undefined}
                    onCancel={() => { setAdding(false); setEditing(null); }}
                    onSubmit={data => {
                      if (editing) saveItem(`${API}/company/performances/${editing.id}`, "PUT", { ...data, amount: Number(data.amount) || null });
                      else saveItem(`${API}/company/performances`, "POST", { ...data, amount: Number(data.amount) || null });
                    }}
                  />}
                />
              )}

              {/* Preferences */}
              {adminTab === "preferences" && prefs && (
                <div className="admin-list">
                  <div className="admin-row">
                    <div className="admin-row-content">
                      <strong>{prefs.companyName}</strong>
                      <span>最大承接：{formatAmount(prefs.maxProjectAmount)}</span>
                      <span>最低准备：{prefs.minRemainingDays} 天</span>
                    </div>
                    <button className="btn btn-primary" onClick={() => setShowPrefsModal(true)}>设置</button>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>可投城市</p>
                    <div className="preference-tags">{prefs.preferredRegions.map(r => <span key={r} className="preference-tag">{r}</span>)}</div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>项目类型</p>
                    <div className="preference-tags">{prefs.preferredProjectTypes.map(r => <span key={r} className="preference-tag">{r}</span>)}</div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>排除关键词</p>
                    <div className="preference-tags">{prefs.excludedKeywords.map(r => <span key={r} className="preference-tag preference-tag--exclude">{r}</span>)}</div>
                  </div>

                  {showPrefsModal && (
                    <Modal title="设置承接能力与投标偏好" onClose={() => setShowPrefsModal(false)}>
                      <AdminForm
                        fields={[
                          { key: "companyName", label: "公司名称" },
                          { key: "minProjectAmount", label: "最小承接金额(元)" },
                          { key: "maxProjectAmount", label: "最大承接金额(元)" },
                          { key: "minRemainingDays", label: "最低准备天数" },
                          { key: "preferredRegions", label: "可投城市(逗号分隔)" },
                          { key: "preferredProjectTypes", label: "项目类型(逗号分隔)" },
                          { key: "excludedKeywords", label: "排除关键词(逗号分隔)" },
                        ]}
                        initial={{
                          companyName: prefs.companyName,
                          minProjectAmount: String(prefs.minProjectAmount),
                          maxProjectAmount: String(prefs.maxProjectAmount),
                          minRemainingDays: String(prefs.minRemainingDays),
                          preferredRegions: prefs.preferredRegions.join(", "),
                          preferredProjectTypes: prefs.preferredProjectTypes.join(", "),
                          excludedKeywords: prefs.excludedKeywords.join(", "),
                        }}
                        onCancel={() => setShowPrefsModal(false)}
                        onSubmit={data => {
                          saveItem(`${API}/company/profile`, "PUT", {
                            companyName: data.companyName,
                            minProjectAmount: Number(data.minProjectAmount),
                            maxProjectAmount: Number(data.maxProjectAmount),
                            minRemainingDays: Number(data.minRemainingDays),
                            preferredRegions: data.preferredRegions.split(/[,，]+/).map((s: string) => s.trim()).filter(Boolean),
                            preferredProjectTypes: data.preferredProjectTypes.split(/[,，]+/).map((s: string) => s.trim()).filter(Boolean),
                            excludedKeywords: data.excludedKeywords.split(/[,，]+/).map((s: string) => s.trim()).filter(Boolean),
                          });
                          setShowPrefsModal(false);
                        }}
                      />
                    </Modal>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
