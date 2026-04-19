import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// ─── 1. QUERY EXPANSION ───────────────────────────────────────────────────────
function expandQuery(disease, query) {
  if (!disease) return query;
  if (query.toLowerCase().includes(disease.toLowerCase())) return query;
  return `${query} ${disease}`;
}

// ─── 2. FETCH OPENALEX (up to 100 results) ───────────────────────────────────
async function fetchOpenAlex(query) {
  try {
    const res = await fetch(
      `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=100&sort=cited_by_count:desc`
    );
    const data = await res.json();
    return (data.results || []).map(p => ({
      title: p.title || "Unknown Title",
      abstract: p.abstract_inverted_index
        ? Object.keys(p.abstract_inverted_index).slice(0, 40).join(" ") + "..."
        : "Abstract not available",
      authors: (p.authorships || []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(", ") || "Unknown Authors",
      year: p.publication_year || "N/A",
      source: "OpenAlex",
      url: p.id || "#",
      citations: p.cited_by_count || 0
    }));
  } catch (err) {
    console.error("OpenAlex error:", err.message);
    return [];
  }
}

// ─── 3. FETCH PUBMED (up to 100 results) ─────────────────────────────────────
async function fetchPubMed(query) {
  try {
    const searchRes = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=100&retmode=json&sort=relevance`
    );
    const searchData = await searchRes.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

    const summaryRes = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`
    );
    const summaryData = await summaryRes.json();

    return ids.map(id => {
      const article = summaryData.result?.[id];
      return {
        title: article?.title || "Unknown Title",
        abstract: article?.summary || "Abstract not available",
        authors: (article?.authors || []).slice(0, 3).map(a => a.name).join(", ") || "Unknown Authors",
        year: article?.pubdate?.split(" ")[0] || "N/A",
        source: "PubMed",
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        citations: 0
      };
    });
  } catch (err) {
    console.error("PubMed error:", err.message);
    return [];
  }
}

// ─── 4. FETCH CLINICAL TRIALS (up to 100 results) ────────────────────────────
async function fetchTrials(query) {
  try {
    const res = await fetch(
      `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=100&sort=LastUpdatePostDate`
    );
    const data = await res.json();
    return (data.studies || []).map(t => {
      const id = t.protocolSection;
      return {
        title: id?.identificationModule?.briefTitle || "Unknown Trial",
        status: id?.statusModule?.overallStatus || "Unknown",
        eligibility: id?.eligibilityModule?.eligibilityCriteria?.slice(0, 300) + "..." || "Not available",
        location: (id?.contactsLocationsModule?.locations || [])
          .slice(0, 2)
          .map(l => `${l.city || ""}, ${l.country || ""}`)
          .join(" | ") || "Not specified",
        contact: id?.contactsLocationsModule?.centralContacts?.[0]?.name || "Not available",
        phase: id?.designModule?.phases?.[0] || "N/A"
      };
    });
  } catch (err) {
    console.error("Trials error:", err.message);
    return [];
  }
}

// ─── 5. RE-RANKING ────────────────────────────────────────────────────────────
function rankPapers(papers, query) {
  const keywords = query.toLowerCase().split(" ");
  return papers
    .map(p => {
      let score = 0;
      const text = `${p.title} ${p.abstract}`.toLowerCase();
      keywords.forEach(k => { if (text.includes(k)) score += 2; });
      score += Math.min((p.citations || 0) / 100, 5);
      const year = parseInt(p.year);
      if (year >= 2020) score += 3;
      else if (year >= 2015) score += 1;
      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function rankTrials(trials) {
  const priority = ["RECRUITING", "ACTIVE_NOT_RECRUITING", "COMPLETED"];
  return trials
    .sort((a, b) => {
      const ai = priority.indexOf(a.status);
      const bi = priority.indexOf(b.status);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .slice(0, 8);
}

// ─── 6. LLM CALL ─────────────────────────────────────────────────────────────
async function callLLM(messages) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3-70b-instruct",
      messages,
      max_tokens: 8000
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "{}";
}

// ─── 7. MAIN QUERY ENDPOINT ───────────────────────────────────────────────────
app.post("/api/query", async (req, res) => {
  const { query, disease, patientName, location, history = [] } = req.body;

  if (!query) return res.status(400).send("Query required");

  try {
    const expandedQuery = expandQuery(disease, query);
    console.log("Expanded query:", expandedQuery);

    const [rawPapers1, rawPapers2, rawTrials] = await Promise.all([
      fetchOpenAlex(expandedQuery),
      fetchPubMed(expandedQuery),
      fetchTrials(expandedQuery)
    ]);

    const allRawPapers = [...rawPapers1, ...rawPapers2];
    console.log(`Fetched ${allRawPapers.length} papers, ${rawTrials.length} trials`);

    const topPapers = rankPapers(allRawPapers, expandedQuery);
    const topTrials = rankTrials(rawTrials);

    const systemPrompt = {
      role: "system",
      content: `You are a medical research assistant. Always respond with ONLY valid JSON. No markdown, no backticks, no explanation.
You MUST include exactly 6-8 researchInsights and 6-8 sources in your response.
${patientName ? `Patient: ${patientName}` : ""}
${disease ? `Disease of Interest: ${disease}` : ""}
${location ? `Location: ${location}` : ""}

Return this exact JSON structure:
{
  "overview": "2-3 sentence condition overview personalized to the patient",
  "researchInsights": [
    { "finding": "key insight from the papers", "source": "paper title", "year": "year" }
  ],
  "clinicalTrials": [
    { "title": "trial title", "status": "status", "phase": "phase", "location": "location", "eligibility": "brief eligibility", "contact": "contact" }
  ],
  "confidence": "High / Medium / Low",
  "sources": [
    { "title": "title", "authors": "authors", "year": "year", "platform": "PubMed/OpenAlex", "url": "url", "snippet": "brief snippet" }
  ]
}`
    };

    const userMessage = {
      role: "user",
      content: `Query: ${query}
Expanded Query: ${expandedQuery}
Top Papers (${topPapers.length}): ${JSON.stringify(topPapers)}
Top Trials (${topTrials.length}): ${JSON.stringify(topTrials)}

Generate a personalized research-backed response. You MUST return at least 6 researchInsights and 6 sources array items. Do not return less than 6 items in each array.`
    };

    const messages = [systemPrompt, ...history, userMessage];

    const response = await callLLM(messages);
    console.log("LLM RAW RESPONSE:", response.slice(0, 300));

    let parsed;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const cleanJson = jsonMatch ? jsonMatch[0] : "{}";
      parsed = JSON.parse(cleanJson);
    } catch {
      parsed = {
        overview: "Could not parse AI response. Please try again.",
        researchInsights: [],
        clinicalTrials: [],
        confidence: "Unknown",
        sources: []
      };
    }

    res.json({
      result: parsed,
      papersAnalyzed: allRawPapers.length,
      trialsAnalyzed: rawTrials.length,
      expandedQuery,
      assistantMessage: { role: "assistant", content: response }
    });

  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Something went wrong: " + err.message });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));