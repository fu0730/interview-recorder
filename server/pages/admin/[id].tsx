import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { getSupabase } from '../../lib/supabase';

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const id = String(ctx.params?.id);
  const supabase = getSupabase();

  const { data: session, error: sErr } = await supabase
    .from('sessions')
    .select('id, created_at, client_name, created_by')
    .eq('id', id)
    .single();
  if (sErr) return { notFound: true };

  const { data: sheet } = await supabase
    .from('sheets')
    .select('session_id, summary, strengths, acquisition, tags, next_actions, strengths_detail, acquisition_detail, markdown')
    .eq('session_id', id)
    .maybeSingle();

  const { data: turns } = await supabase
    .from('turns')
    .select('step, type, question, answer')
    .eq('session_id', id)
    .order('step', { ascending: true });

  return { props: { session, sheet: sheet ?? null, turns: turns ?? [] } };
};

export default function AdminDetail({ session, sheet, turns }: any) {
  const dt = new Date(session.created_at).toLocaleString('ja-JP');
  return (
    <>
      <Head>
        <title>Session {session.id} | Admin</title>
      </Head>
      <main style={{ maxWidth: 980, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif, system-ui, -apple-system' }}>
        <Link href="/admin" style={{ textDecoration: 'none', color: '#2F6F5F' }}>← 一覧に戻る</Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 4px' }}>セッション詳細</h1>
        <p style={{ margin: 0, color: '#19493b' }}>{dt} / 顧客: {session.client_name || '不明'} / 作成: {session.created_by || '-'}</p>

        {sheet ? (
          <section style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>ヒアリングシート</h2>
            <p style={{ whiteSpace: 'pre-wrap', background: '#F6FBF9', border: '1px solid #E6EEF0', padding: 12, borderRadius: 8 }}>{sheet.summary || '-'}</p>

            <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>強み</h3>
            <ul>
              {(sheet.strengths || []).map((s: string, i: number) => (
                <li key={i}>{s}</li>
              ))}
            </ul>

            <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>集客 / 改善アイデア</h3>
            <ul>
              {(sheet.acquisition?.ideas || []).map((s: string, i: number) => (
                <li key={i}>{s}</li>
              ))}
            </ul>

            <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>タグ</h3>
            <p>{(sheet.tags || []).join(' ') || '-'}</p>

            {sheet.next_actions?.length ? (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>次の一歩</h3>
                <ul>
                  {sheet.next_actions.map((s: string, i: number) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {sheet.strengths_detail?.length ? (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>強み（詳細）</h3>
                <ul>
                  {sheet.strengths_detail.map((s: any, i: number) => (
                    <li key={i}>
                      <strong>{s.title}</strong> — {s.how_to_use || '-'} / 根拠: {s.evidence || '-'}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {sheet.acquisition_detail?.ideas?.length ? (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>改善アイデア（詳細）</h3>
                <ul>
                  {sheet.acquisition_detail.ideas.map((i: any, idx: number) => (
                    <li key={idx}>
                      <strong>{i.what}</strong> — 理由: {i.why || '-'} / 影響: {i.impact || '-'} / 工数: {i.effort || '-'}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : (
          <p style={{ marginTop: 20 }}>シートが見つかりません。</p>
        )}

        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>原文ログ</h2>
          <div style={{ background: '#FFF', border: '1px solid #E6EEF0', borderRadius: 8 }}>
            {(turns || []).map((t: any) => (
              <div key={t.step} style={{ padding: 10, borderTop: '1px solid #EEF5F6' }}>
                <div style={{ fontSize: 12, color: '#3c6', marginBottom: 4 }}>
                  Q{t.step} {t.type === 'base' ? '(基本)' : '(深掘り)'}
                </div>
                <div style={{ fontWeight: 600 }}>{t.question}</div>
                <div style={{ whiteSpace: 'pre-wrap', color: '#222' }}>{t.answer || '-'}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}