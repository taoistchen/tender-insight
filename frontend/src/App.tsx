export function App() {
  const metrics = [
    ["今日新增公告", "18"],
    ["推荐参与", "3"],
    ["需人工确认", "5"],
    ["即将截止", "2"]
  ];

  const tenders = [
    {
      title: "某办公楼装修改造工程施工招标公告",
      city: "南京",
      amount: "300 万元",
      deadline: "2026-07-15 09:30",
      score: 95,
      decision: "推荐参与"
    },
    {
      title: "某综合楼消防设施改造工程",
      city: "南京",
      amount: "518.6 万元",
      deadline: "2026-07-18 10:00",
      score: 88,
      decision: "推荐参与"
    },
    {
      title: "某道路工程监理招标公告",
      city: "南京",
      amount: "未披露",
      deadline: "2026-07-10 09:00",
      score: 0,
      decision: "明确不满足"
    }
  ];

  const qualifications = [
    "建筑工程施工总承包 二级",
    "消防设施工程专业承包 二级",
    "防水防腐保温工程专业承包 二级",
    "建筑装修装饰工程专业承包 二级",
    "特种工程（结构补强）专业承包 不分等级"
  ];

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">工程投标智能分析平台</p>
          <h1>Tender Insight</h1>
        </div>
        <span className="status">MVP</span>
      </section>

      <section className="metrics-grid" aria-label="概览指标">
        {metrics.map(([label, value]) => (
          <article className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="content-grid">
        <article className="panel tenders-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">南京建设工程</p>
              <h2>招标公告初筛</h2>
            </div>
            <button type="button">刷新</button>
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
                  <th>判断</th>
                </tr>
              </thead>
              <tbody>
                {tenders.map((tender) => (
                  <tr key={tender.title}>
                    <td>{tender.title}</td>
                    <td>{tender.city}</td>
                    <td>{tender.amount}</td>
                    <td>{tender.deadline}</td>
                    <td>{tender.score}</td>
                    <td>
                      <span className="decision">{tender.decision}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="panel">
          <p className="eyebrow">公司能力库</p>
          <h2>江苏亚亿建设集团有限公司</h2>
          <ul className="qualification-list">
            {qualifications.map((qualification) => (
              <li key={qualification}>{qualification}</li>
            ))}
          </ul>
        </aside>
      </section>
    </main>
  );
}
