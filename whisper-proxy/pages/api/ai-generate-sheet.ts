// whisper-proxy/pages/api/ai-generate-sheet.ts
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
以下のインタビュー回答をもとに、ヒアリングシートをMarkdown形式のJSON構造で作成してください。
出力はJSONのみで、説明文や補足を付けず、次の構造に従ってください。

{
  "summary": "全体の要約（100文字以内）",
  "strengths": ["強み1", "強み2"],
  "acquisition": {
    "channels": ["主要チャネル"],
    "issues": ["課題"],
    "ideas": ["改善アイデア1", "改善アイデア2"]
  },
  "tags": ["#関連タグ1", "#関連タグ2"]
}

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
    const strengths = coerceArray<string>(json.strengths);
    const acquisitionRaw = json.acquisition || {};
    const acquisition = {
      channels: coerceArray<string>(acquisitionRaw.channels),
      issues: coerceArray<string>(acquisitionRaw.issues),
      ideas: coerceArray<string>(acquisitionRaw.ideas),
    };
    const tags = coerceArray<string>(json.tags);

    res.status(200).json({ summary, strengths, acquisition, tags });
  } catch (e: any) {
    console.error("AI sheet generation error:", e);
    res.status(500).json({ error: e.message || "AI sheet generation failed" });
  }
}