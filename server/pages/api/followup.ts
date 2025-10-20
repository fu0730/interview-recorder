// whisper-proxy/pages/api/followup.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).send("OPENAI_API_KEY not set");

  const { answerText, base, purpose } = (req.body || {}) as {
    answerText?: string;
    base?: string;
    purpose?: "acquisition" | "strength" | "acquisition_and_strength" | string;
  };

  if (!answerText || typeof answerText !== "string") {
    return res.status(400).send("answerText is required");
  }

  const focus = (
    purpose === "acquisition" ? "集客（誰に・どこから・導線・阻害要因）" :
    purpose === "strength" ? "強み（差別化・価値・事例）" :
    "集客と強みの両方"
  );

  const sys = `あなたは思いやりのある聞き手です。相手の回答をもとに、偏りのない日本語の深掘り質問を1文だけ作ってください。`;

  const user = `以下の情報を読み、${focus}の観点で、回答を自然に深める**1問だけ**の質問を作成してください。
- 具体的な内容を1つだけ丁寧に聞く
- 40文字以内
- 誘導しない中立的な聞き方
- 相手の語彙を1つ拾って掘る

[基本質問]
${base ?? "(未指定)"}

[回答]
${answerText}

[出力形式]
質問のみを出力。接頭語・解説・引用符は付けない。`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user }
        ],
        temperature: 0.3,
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(500).send(data?.error?.message || "OpenAI error");

    let text = (data.choices?.[0]?.message?.content ?? "").trim();
    // 後処理：改行・引用符を除去し、1文・40字以内に整形して、文末記号を「？」に
    text = text.replace(/["'「」]/g, "").replace(/\s+/g, " ").trim();
    // 句点や改行で最初の文を抽出
    const first = text.split(/(?<=[。！？?])|\n/).filter(Boolean)[0] ?? text;
    let q = first.replace(/[。!！]?$/, ""); // 文末の句点などを削る
    if (q.length > 40) q = q.slice(0, 40);
    if (!/[?？]$/.test(q)) q = q + "？";
    if (!q || q.replace(/[？?]/g, "").trim().length === 0) {
      q = "もう少し具体的に教えていただけますか？";
    }

    res.status(200).json({ question: q });
  } catch (e: any) {
    res.status(500).send(e?.message ?? "followup error");
  }
}