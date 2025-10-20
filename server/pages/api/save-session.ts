// whisper-proxy/pages/api/save-session.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// Types from the app (loose to keep compatibility)
type Turn = {
  step: number; // 1..n
  type: 'base' | 'followup';
  question: string;
  answer?: string;
};

type SheetData = {
  summary: string;
  strengths: string[];
  acquisition: {
    channels: string[];
    issues: string[];
    ideas: string[];
  };
  tags: string[];
  next_actions?: string[];
  // for future detailed fields
  strengths_detail?: any[];
  acquisition_detail?: any;
  markdown?: string; // optional, if the client provides a pre-rendered MD
};

type Payload = {
  session?: { client_name?: string | null; created_by?: string | null };
  turns: Turn[];
  sheet: SheetData;
};

// Lazy import supabase so local dev without deps doesn't crash
async function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supabase = await getSupabase();
  if (!supabase) {
    // Allow running the app even if Supabase is not configured
    return res.status(501).json({
      error: 'Supabase is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE on Vercel).',
    });
  }

  try {
    const body = req.body as Payload;
    if (!body || !Array.isArray(body.turns) || !body.sheet) {
      return res.status(400).json({ error: 'Invalid payload: { turns, sheet } are required.' });
    }

    const sessionId = (globalThis as any).crypto?.randomUUID?.() || require('crypto').randomUUID();
    const createdBy = body.session?.created_by ?? null;
    const clientName = body.session?.client_name ?? null;

    // 1) sessions
    {
      const { error } = await supabase.from('sessions').insert({
        id: sessionId,
        client_name: clientName,
        created_by: createdBy,
      });
      if (error) throw new Error(`insert sessions failed: ${error.message}`);
    }

    // 2) turns (bulk)
    if (body.turns.length) {
      const rows = body.turns.map((t) => ({
        session_id: sessionId,
        step: t.step,
        type: t.type,
        question: t.question,
        answer: t.answer ?? null,
      }));
      const { error } = await supabase.from('turns').insert(rows);
      if (error) throw new Error(`insert turns failed: ${error.message}`);
    }

    // 3) sheets
    {
      const { summary, strengths, acquisition, tags, next_actions, strengths_detail, acquisition_detail, markdown } = body.sheet;
      const { error } = await supabase.from('sheets').insert({
        session_id: sessionId,
        summary,
        strengths,
        acquisition,
        tags,
        next_actions: next_actions ?? [],
        strengths_detail: strengths_detail ?? null,
        acquisition_detail: acquisition_detail ?? null,
        markdown: markdown ?? null,
      });
      if (error) throw new Error(`insert sheets failed: ${error.message}`);
    }

    return res.status(200).json({ ok: true, session_id: sessionId });
  } catch (e: any) {
    console.error('save-session error', e);
    return res.status(500).json({ error: e?.message ?? 'save-session failed' });
  }
}