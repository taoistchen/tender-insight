import { useEffect, useState, useMemo } from "react";

/* ─── API Types ─── */

type Decision =
  | "recommended"
  | "watch"
  | "manual_review"
  | "not_recommended"
  | "rejected";

interface ApiTender {
  city: string;
  url: string;
  title: string;
  budgetAmount: number | null;
  deadlineTime: string;
  qualificationRequirements: { name: string; level: string }[];
  personnelRequirements: string[];
  performanceRequirements: string[];
  analysis: {
    decision: Decision;
    matchScore: number;
    matchedPoints: string[];
    riskPoints: string[];
    manualReviewRequired: boolean;
  };
}

interface ApiCompanyProfile {
  companyName: string;
  preferredRegions: string[];
  preferredProjectTypes: string[];
  excludedKeywords: string[];
  maxProjectAmount: number;
  minRemainingDays: number;
  qualifications: {
    name: string;
    level: string;
    validTo: string;
  }[];
}

/* ─── Display helpers ─── */

const DECISION_LABELS: Record<Decision, string> = {
  recommended: "推荐参与",
  watch: "可关注",
  manual_review: "需人工确认",
  not_recommended: "不建议",
  rejected: "明确不满足"
};

const DECISION_CLASS: Record<Decision, string> = {
  recommended: "decision--recommended",
  watch: "decision--watch",
  manual_review: "decision--manual_review",
  not_recommended: "decision--not_recommended",
  rejected: "decision--rejected"
};

type LoadingState = "idle" | "loading" | "error" | "ready";

function formatAmount(yuan: number | null | undefined): string {
  if (yuan == null) return "未披露";
  if (yuan >= 10_000) return `${(yuan / 10_000).toLocaleString()} 万元`;
  return `${yuan.toLocaleString()} 元`;
}

function formatDeadline(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function scoreClass(score: number): string {
  if (score >= 85) return "score--high";
  if (score >= 70) return "score--mid";
  return "score--low";
}

/* ─── Components ─── */

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="metric">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
    </article>
  );
}

function DecisionBadge({ decision }: { decision: Decision }) {
  return (
    <span className={`decision ${DECISION_CLASS[decision]}`}>
      {DECISION_LABELS[decision]}
    </span>
  );
}

function Spinner() {
  return (
    <div className="loading-state">
      <div className="spinner" />
      <p>正在加载数据…</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-state">
      <p className="error-icon">⚠</p>
      <p className="error-message">{message}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

/* ─── App ─── */

const API_BASE = "/api";

export function App() {
  const [tenders, setTenders] = useState<ApiTender[]>([]);
  const [company, setCompany] = useState<ApiCompanyProfile | null>(null);
  const [tenderState, setTenderState] = useState<LoadingState>("idle");
  const [companyState, setCompanyState] = useState<LoadingState>("idle");

  async function fetchTenders() {
    setTenderState("loading");
    try {
      const res = await fetch(`${API_BASE}/tenders`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiTender[] = await res.json();
      setTenders(data);
      setTenderState("ready");
    } catch (err) {
      console.error("Failed to fetch tenders:", err);
      setTenderState("error");
    }
  }

  async function fetchCompany() {
    setCompanyState("loading");
    try {
      const res = await fetch(`${API_BASE}/company/profile`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiCompanyProfile = await res.json();
      setCompany(data);
      setCompanyState("ready");
    } catch (err) {
      console.error("Failed to fetch company profile:", err);
      setCompanyState("error");
    }
  }

  useEffect(() => {
    fetchTenders();
    fetchCompany();
  }, []);

  const metrics = useMemo(() => {
    const now = Date.now();
    const soon = now + 3 * 24 * 60 * 60 * 1000; // 3 days
    return [
      { label: "今日新增公告", value: tenders.length },
      {
        label: "推荐参与",
        value: tenders.filter((t) => t.analysis.decision === "recommended").length
      },
      {
        label: "需人工确认",
        value: tenders.filter((t) => t.analysis.decision === "manual_review").length
      },
      {
        label: "即将截止",
        value: tenders.filter((t) => {
          if (!t.deadlineTime) return false;
          const d = new Date(t.deadlineTime).getTime();
          return d > now && d <= soon;
        }).length
      }
    ];
  }, [tenders]);

  const isLoading =
    tenderState === "loading" || companyState === "loading";
  const hasError =
    tenderState === "error" || companyState === "error";

  return (
    <main className="app-shell">
      {/* ── Top Bar ── */}
      <header className="topbar">
        <div className="topbar-brand">
          <p className="topbar-eyebrow">工程投标智能分析平台</p>
          <h1>Tender Insight</h1>
        </div>
        <span className="mvp-badge" title="Minimum Viable Product">
          MVP
        </span>
      </header>

      {/* ── Metrics ── */}
      <section className="metrics-grid" aria-label="概览指标">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </section>

      {/* ── Main Content ── */}
      <section className="content-grid">
        {/* ── Tender List ── */}
        <article className="panel tenders-panel">
          <div className="panel-header">
            <div>
              <p className="panel-eyebrow">南京 · 建设工程</p>
              <h2>招标公告初筛</h2>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={fetchTenders}
              disabled={tenderState === "loading"}
            >
              刷新
            </button>
          </div>

          {tenderState === "loading" && tenders.length === 0 && <Spinner />}
          {tenderState === "error" && tenders.length === 0 && (
            <ErrorState message="无法加载招标公告数据" onRetry={fetchTenders} />
          )}
          {tenderState === "ready" && tenders.length === 0 && (
            <div className="empty-state-full">
              <p>暂无招标公告</p>
              <p className="empty-hint">采集器运行后将自动填充数据</p>
            </div>
          )}

          {tenders.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>项目名称</th>
                    <th>城市</th>
                    <th>金额</th>
                    <th>截止时间</th>
                    <th>匹配分</th>
                    <th>判断结果</th>
                  </tr>
                </thead>
                <tbody>
                  {tenders.map((t, i) => (
                    <tr key={t.url + i}>
                      <td className="col-title">
                        {t.analysis.riskPoints.length > 0 && (
                          <span className="risk-dot" />
                        )}
                        <a
                          className="tender-link"
                          href={t.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`查看公告原文：${t.title}`}
                        >
                          {t.title}
                        </a>
                      </td>
                      <td className="col-city">{t.city}</td>
                      <td className="col-num">{formatAmount(t.budgetAmount)}</td>
                      <td className="col-date">{formatDeadline(t.deadlineTime)}</td>
                      <td className={`col-num score ${scoreClass(t.analysis.matchScore)}`}>
                        {t.analysis.matchScore}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <DecisionBadge decision={t.analysis.decision} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tenderState === "error" && tenders.length > 0 && (
            <div className="stale-data-banner">
              ⚠ 显示的是缓存数据，刷新失败
            </div>
          )}
        </article>

        {/* ── Company Panel ── */}
        <aside className="panel company-panel">
          {companyState === "loading" && <Spinner />}
          {companyState === "error" && (
            <ErrorState message="无法加载公司数据" onRetry={fetchCompany} />
          )}

          {company && (
            <>
              <p className="panel-eyebrow">公司能力库</p>
              <h2>{company.companyName}</h2>
              <p className="company-name">Engineering Construction Group</p>

              <p className="qualification-section-title">企业资质</p>
              <ul className="qualification-list">
                {company.qualifications.map((q) => (
                  <li key={q.name}>
                    <span className="qualification-level-tag">{q.level}</span>
                    <div>
                      <div>{q.name}</div>
                      <div
                        className={`qualification-expiry ${
                          new Date(q.validTo).getTime() - Date.now() <
                          365 * 24 * 60 * 60 * 1000
                            ? "qualification-expiry--warn"
                            : ""
                        }`}
                      >
                        有效期至 {formatDate(q.validTo)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="qualification-section-title">投标偏好</p>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>
                  可投城市
                </div>
                <div className="preference-tags">
                  {company.preferredRegions.map((r) => (
                    <span key={r} className="preference-tag">{r}</span>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>
                  项目类型
                </div>
                <div className="preference-tags">
                  {company.preferredProjectTypes.map((t) => (
                    <span key={t} className="preference-tag">{t}</span>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>
                  排除关键词
                </div>
                <div className="preference-tags">
                  {company.excludedKeywords.map((k) => (
                    <span key={k} className="preference-tag preference-tag--exclude">{k}</span>
                  ))}
                </div>
              </div>

              <p className="qualification-section-title">承接能力</p>
              <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-slate)" }}>
                <div>最大承接金额：<strong>{formatAmount(company.maxProjectAmount)}</strong></div>
                <div>最低准备天数：<strong>{company.minRemainingDays} 天</strong></div>
              </div>
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
