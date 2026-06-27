import type { ReactNode } from "react";

/* ─── Types ─── */

type Decision =
  | "recommended"
  | "watch"
  | "manual_review"
  | "not_recommended"
  | "rejected";

interface TenderRow {
  title: string;
  city: string;
  amount: string;
  deadline: string;
  score: number;
  decision: Decision;
  riskCount: number;
}

interface MetricCard {
  label: string;
  value: string;
}

interface Qualification {
  name: string;
  level: string;
  validTo: string;
  expiringSoon: boolean;
}

/* ─── Constants ─── */

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

/* ─── Sample Data ─── */

const METRICS: MetricCard[] = [
  { label: "今日新增公告", value: "18" },
  { label: "推荐参与", value: "3" },
  { label: "需人工确认", value: "5" },
  { label: "即将截止", value: "2" }
];

const TENDERS: TenderRow[] = [
  {
    title: "某办公楼装修改造工程施工招标公告",
    city: "南京",
    amount: "300 万元",
    deadline: "2026-07-15 09:30",
    score: 95,
    decision: "recommended",
    riskCount: 0
  },
  {
    title: "某综合楼消防设施改造工程施工",
    city: "南京",
    amount: "518.6 万元",
    deadline: "2026-07-18 10:00",
    score: 88,
    decision: "recommended",
    riskCount: 0
  },
  {
    title: "某片区雨污分流及道路改造工程",
    city: "南京",
    amount: "1,200 万元",
    deadline: "2026-07-12 09:00",
    score: 72,
    decision: "watch",
    riskCount: 1
  },
  {
    title: "某市政道路工程监理招标公告",
    city: "南京",
    amount: "未披露",
    deadline: "2026-07-10 09:00",
    score: 0,
    decision: "rejected",
    riskCount: 1
  }
];

const QUALIFICATIONS: Qualification[] = [
  {
    name: "建筑工程施工总承包",
    level: "二级",
    validTo: "2030-03-12",
    expiringSoon: false
  },
  {
    name: "消防设施工程专业承包",
    level: "二级",
    validTo: "2027-04-20",
    expiringSoon: false
  },
  {
    name: "防水防腐保温工程专业承包",
    level: "二级",
    validTo: "2027-04-20",
    expiringSoon: false
  },
  {
    name: "建筑装修装饰工程专业承包",
    level: "二级",
    validTo: "2027-04-20",
    expiringSoon: false
  },
  {
    name: "特种工程（结构补强）专业承包",
    level: "不分等级",
    validTo: "2027-04-20",
    expiringSoon: false
  }
];

const PREFERRED_REGIONS = ["南京", "淮安", "镇江", "连云港"];
const PREFERRED_TYPES = ["建筑", "消防", "装修", "防水", "防腐", "保温", "结构补强", "改造"];
const EXCLUDED_KEYWORDS = ["监理", "设计", "勘察", "审计", "造价咨询"];

/* ─── Helpers ─── */

function scoreClass(score: number): string {
  if (score >= 85) return "score--high";
  if (score >= 70) return "score--mid";
  return "score--low";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ─── Components ─── */

function MetricCard({ label, value }: MetricCard) {
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

function ScoreCell({ score }: { score: number }) {
  return (
    <td className={`col-num score ${scoreClass(score)}`}>
      {score}
    </td>
  );
}

/* ─── App ─── */

export function App() {
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
        {METRICS.map((m) => (
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
            <button type="button" className="btn btn-primary">
              刷新
            </button>
          </div>

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
                {TENDERS.map((t) => (
                  <tr key={t.title}>
                    <td className="col-title">
                      {t.riskCount > 0 && <span className="risk-dot" />}
                      {t.title}
                    </td>
                    <td className="col-city">{t.city}</td>
                    <td className="col-num">{t.amount}</td>
                    <td className="col-date">{t.deadline}</td>
                    <ScoreCell score={t.score} />
                    <td style={{ textAlign: "center" }}>
                      <DecisionBadge decision={t.decision} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        {/* ── Company Panel ── */}
        <aside className="panel company-panel">
          <p className="panel-eyebrow">公司能力库</p>
          <h2>江苏亚亿建设集团有限公司</h2>
          <p className="company-name">Jiangsu Yayi Construction Group</p>

          <p className="qualification-section-title">企业资质</p>
          <ul className="qualification-list">
            {QUALIFICATIONS.map((q) => (
              <li key={q.name}>
                <span className="qualification-level-tag">{q.level}</span>
                <div>
                  <div>{q.name}</div>
                  <div
                    className={`qualification-expiry ${q.expiringSoon ? "qualification-expiry--warn" : ""}`}
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
              {PREFERRED_REGIONS.map((r) => (
                <span key={r} className="preference-tag">{r}</span>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>
              项目类型
            </div>
            <div className="preference-tags">
              {PREFERRED_TYPES.map((t) => (
                <span key={t} className="preference-tag">{t}</span>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>
              排除关键词
            </div>
            <div className="preference-tags">
              {EXCLUDED_KEYWORDS.map((k) => (
                <span key={k} className="preference-tag preference-tag--exclude">{k}</span>
              ))}
            </div>
          </div>

          <p className="qualification-section-title">承接能力</p>
          <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-slate)" }}>
            <div>最大承接金额：<strong>2,000 万元</strong></div>
            <div>最低准备天数：<strong>5 天</strong></div>
          </div>
        </aside>
      </section>
    </main>
  );
}
