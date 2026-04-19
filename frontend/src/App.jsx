import React, { useState } from "react";
import "./App.css";

export default function App() {
  const [query, setQuery] = useState("");
  const [disease, setDisease] = useState("");
  const [patientName, setPatientName] = useState("");
  const [location, setLocation] = useState("");
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("research");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [chatLog, setChatLog] = useState([]);

  const send = async () => {
    if (!query) return;
    setLoading(true);

    const userEntry = { role: "user", content: query };

    try {
      const res = await fetch(`https://curalink-d6hp.onrender.com/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, disease, patientName, location, history })
      });

      const d = await res.json();

      if (d.error) {
        alert("Error: " + d.error);
        setLoading(false);
        return;
      }

      // Update conversation history for multi-turn
      const newHistory = [...history, userEntry, d.assistantMessage];
      setHistory(newHistory);
      setChatLog(prev => [...prev, { query, expandedQuery: d.expandedQuery, papersAnalyzed: d.papersAnalyzed, trialsAnalyzed: d.trialsAnalyzed }]);
      setData(d);
      setQuery("");

    } catch {
      alert("Network error — please check your connection.");
    }

    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") send();
  };

  const clearContext = () => {
    setHistory([]);
    setChatLog([]);
    setData(null);
  };

  return (
    <div className="container">

      <h1 className="title">🧠 Curalink AI</h1>
      <p className="subtitle">AI-Powered Medical Research Assistant</p>

      {/* Patient Context */}
      <div className="context-box">
        <h3>📋 Patient Context</h3>
        <div className="context-grid">
          <input
            value={patientName}
            onChange={e => setPatientName(e.target.value)}
            placeholder="Patient Name (optional)"
            className="context-input"
          />
          <input
            value={disease}
            onChange={e => setDisease(e.target.value)}
            placeholder="Disease of Interest (e.g. Parkinson's)"
            className="context-input"
          />
          <input
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className="context-input"
          />
        </div>
      </div>

      {/* Chat History */}
      {chatLog.length > 0 && (
        <div className="chat-log">
          {chatLog.map((c, i) => (
            <div key={i} className="chat-entry">
              <span className="chat-query">🗨️ {c.query}</span>
              <span className="chat-meta">→ Expanded: "{c.expandedQuery}" | {c.papersAnalyzed} papers, {c.trialsAnalyzed} trials analyzed</span>
            </div>
          ))}
        </div>
      )}

      {/* Search Bar */}
      <div className="search-bar">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={history.length > 0 ? "Ask a follow-up question..." : "Ask a medical research question..."}
          className="search-input"
        />
        <button onClick={send} disabled={loading} className="search-button">
          {loading ? "Loading..." : history.length > 0 ? "Follow Up" : "Ask"}
        </button>
        {history.length > 0 && (
          <button onClick={clearContext} className="clear-button">
            New Chat
          </button>
        )}
      </div>

      {/* Results */}
      {data && data.result && (
        <div>
          <div className="overview-box">
            <h3>📌 Overview</h3>
            <p>{data.result.overview}</p>
            <div className="meta-row">
              <span><b>Confidence:</b> {data.result.confidence}</span>
              <span><b>Papers analyzed:</b> {data.papersAnalyzed}</span>
              <span><b>Trials analyzed:</b> {data.trialsAnalyzed}</span>
            </div>
            {data.expandedQuery && (
              <p className="expanded-query">🔍 Expanded query: <i>"{data.expandedQuery}"</i></p>
            )}
          </div>

          <div className="tabs">
            {["research", "trials", "sources"].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`tab-button ${tab === t ? "active" : ""}`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {tab === "research" && (
            <div>
              {data.result.researchInsights?.length > 0
                ? data.result.researchInsights.map((r, i) => (
                  <div key={i} className="card">
                    <p>{r.finding}</p>
                    {r.source && <small>📄 {r.source} {r.year ? `(${r.year})` : ""}</small>}
                  </div>
                ))
                : <p className="empty">No research insights found.</p>
              }
            </div>
          )}

          {tab === "trials" && (
            <div>
              {data.result.clinicalTrials?.length > 0
                ? data.result.clinicalTrials.map((t, i) => (
                  <div key={i} className="card">
                    <p><b>{t.title}</b></p>
                    <div className="trial-meta">
                      <span className={`status-badge ${t.status?.toLowerCase()}`}>{t.status}</span>
                      {t.phase && t.phase !== "N/A" && <span className="phase-badge">Phase: {t.phase}</span>}
                    </div>
                    {t.location && <small>📍 {t.location}</small>}
                    {t.eligibility && <p className="eligibility">📋 {t.eligibility}</p>}
                    {t.contact && <small>📞 Contact: {t.contact}</small>}
                  </div>
                ))
                : <p className="empty">No clinical trials found.</p>
              }
            </div>
          )}

          {tab === "sources" && (
            <div>
              {data.result.sources?.length > 0
                ? data.result.sources.map((s, i) => (
                  <div key={i} className="card">
                    <p><b>{s.title}</b></p>
                    {s.authors && <small>👤 {s.authors}</small>}
                    <div className="source-meta">
                      {s.year && <span>📅 {s.year}</span>}
                      {s.platform && <span>🔬 {s.platform}</span>}
                    </div>
                    {s.snippet && <p className="snippet">{s.snippet}</p>}
                    {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer">View Source →</a>}
                  </div>
                ))
                : <p className="empty">No sources found.</p>
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
