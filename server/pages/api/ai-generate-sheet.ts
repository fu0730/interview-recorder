// server/pages/api/ai-generate-sheet.ts
import type { NextApiRequest, NextApiResponse } from "next";

// Helper to safely extract and parse JSON from model output
function extractJson(input: string): any {
  const trimmed = input.trim();
  // remove code fences if present
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/m;
  const fenced = fence.exec(trimmed);
  const raw = fenced ? fenced[1] : trimmed;
  // try direct parse first
  try { return JSON.parse(raw); } catch {}
  // fallback: find first { ... } block
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = raw.slice(start, end + 1);
    try { return JSON.parse(slice); } catch {}
  }
  throw new Error('Failed to parse JSON from model response');
}

function coerceArray<T>(v: any, fallback: T[] = []): T[] {
  return Array.isArray(v) ? v : fallback;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).send("OPENAI_API_KEY not set");

  const { transcript } = req.body as { transcript?: string };
  if (!transcript) return res.status(400).send("transcript is required");

  try {
    // Cap transcript length (roughly) to avoid oversized prompts
    const MAX_CHARS = 12000;
    const clipped = transcript.length > MAX_CHARS ? transcript.slice(0, MAX_CHARS) + "\n... (truncated)" : transcript;

    const prompt = `
あなたは優秀なヒアリングライターです。
以下のインタビュー回答をもとに、実務で役立つヒアリングシートをJSON形式で作成してください。
出力はJSONのみで、説明文や補足は不要です。必ず次のスキーマに従ってください。

{
  "summary": "100文字以内の全体要約",
  "strengths": [
    { "title": "強みタイトル", "evidence": "根拠となる発言（引用可）", "how_to_use": "活かし方" }
  ],
  "acquisition": {
    "channels": ["主要チャネル"],
    "issues": ["課題"],
    "ideas": [
      { "what": "改善提案", "why": "理由", "impact": "高/中/低", "effort": "高/中/低" }
    ]
  },
  "tags": ["#関連タグ"],
  "next_actions": ["次の一歩（100字以内）"]
}

制約:
- summary は100文字以内。
- strengths は最大3件。各要素は title/evidence/how_to_use を必須。
- ideas は最大3件。各要素は what/why/impact/effort を必須。
- tags は 1〜5 件程度。
- next_actions は 1〜3 件。

インタビュー回答:
${clipped}
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "あなたは構造的なライティングが得意な編集者です。出力は必ず有効なJSONのみ。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 600,
        response_format: { type: "json_object" }
      }),
    });

    const data = await r.json();
    const content = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!content) throw new Error('Empty response from OpenAI');

    const json = extractJson(content);
    const summary = typeof json.summary === 'string' ? json.summary : '';

    // strengths: detailed objects → titles for backward compatibility, plus strengths_detail
    const strengthsDetail = coerceArray<any>(json.strengths)
      .map((s) => ({
        title: typeof s?.title === 'string' ? s.title : '',
        evidence: typeof s?.evidence === 'string' ? s.evidence : '',
        how_to_use: typeof s?.how_to_use === 'string' ? s.how_to_use : ''
      }))
      .filter((s) => s.title);
    const strengths = strengthsDetail.map((s) => s.title);

    // acquisition
    const acquisitionRaw = json.acquisition || {};
    const channels = coerceArray<string>(acquisitionRaw.channels);
    const issues = coerceArray<string>(acquisitionRaw.issues);
    const ideasDetail = coerceArray<any>(acquisitionRaw.ideas)
      .map((i) => ({
        what: typeof i?.what === 'string' ? i.what : '',
        why: typeof i?.why === 'string' ? i.why : '',
        impact: typeof i?.impact === 'string' ? i.impact : '',
        effort: typeof i?.effort === 'string' ? i.effort : ''
      }))
      .filter((i) => i.what);
    // collapse ideas to strings for current client UI
    const ideas = ideasDetail.map((i) => i.why ? `${i.what}（理由: ${i.why}）` : i.what);

    const tags = coerceArray<string>(json.tags);
    const next_actions = coerceArray<string>(json.next_actions);

    res.status(200).json({
      summary,
      strengths,
      acquisition: { channels, issues, ideas },
      tags,
      next_actions,
      // detailed fields for future UI updates
      strengths_detail: strengthsDetail,
      acquisition_detail: { channels, issues, ideas: ideasDetail }
    });
  } catch (e: any) {
    console.error("AI sheet generation error:", e);
    res.status(500).json({ error: e.message || "AI sheet generation failed" });
  }
}