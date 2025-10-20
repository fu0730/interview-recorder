import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { getSupabase } from '../../lib/supabase';

export type SessionRow = { id: string; created_at: string; client_name: string | null; created_by: string | null };
export type SheetRow = { session_id: string; summary: string | null; strengths: string[] | null; tags: string[] | null };

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const supabase = getSupabase();

  // クエリパラメータを取得 (?q=顧客名&by=作成者)
  const q = typeof ctx.query.q === 'string' ? ctx.query.q.trim() : '';
  const by = typeof ctx.query.by === 'string' ? ctx.query.by.trim() : '';

  let sQuery = supabase
    .from('sessions')
    .select('id, created_at, client_name, created_by')
    .order('created_at', { ascending: false })
    .limit(100);

  if (q) sQuery = sQuery.ilike('client_name', `%${q}%`);
  if (by) sQuery = sQuery.ilike('created_by', `%${by}%`);

  const { data: sessions, error: sErr } = await sQuery;
  if (sErr) throw sErr;

  const ids = (sessions ?? []).map((s) => s.id);
  const { data: sheets, error: shErr } = await supabase
    .from('sheets')
    .select('session_id, summary, strengths, tags')
    .in('session_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (shErr) throw shErr;

  const sheetMap = new Map<string, SheetRow>();
  (sheets ?? []).forEach((r) => sheetMap.set(r.session_id, r as SheetRow));

  const rows = (sessions ?? []).map((s) => ({ ...s, sheet: sheetMap.get(s.id) || null }));

  return { props: { rows, q, by } };
};

export default function AdminList({ rows, q, by }: { rows: (SessionRow & { sheet: SheetRow | null })[]; q?: string; by?: string }) {
  return (
    <>
      <Head>
        <title>Admin | Interview Sessions</title>
      </Head>
      <main style={{ maxWidth: 980, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif, system-ui, -apple-system' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>インタビュー一覧（最新100件）</h1>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <Link href="/" style={{ textDecoration: 'none', color: '#2F6F5F' }}>← トップへ</Link>
          <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 13 }}>顧客名
              <input name="q" defaultValue={q || ''} placeholder="例: 山田" style={input} />
            </label>
            <label style={{ fontSize: 13 }}>作成者
              <input name="by" defaultValue={by || ''} placeholder="例: fu" style={input} />
            </label>
            <button type="submit" style={btn}>検索</button>
            {(q || by) ? <Link href="/admin" style={{ color: '#666', fontSize: 13 }}>クリア</Link> : null}
          </form>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F6FBF9' }}>
              <th style={th}>日時</th>
              <th style={th}>顧客名</th>
              <th style={th}>作成者</th>
              <th style={th}>強み（抜粋）</th>
              <th style={th}>タグ</th>
              <th style={th}>詳細</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const strengths = r.sheet?.strengths?.slice(0, 3).join(' / ') || '-';
              const tags = r.sheet?.tags?.slice(0, 4).join(' ') || '-';
              const dt = new Date(r.created_at).toLocaleString('ja-JP');
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #E6EEF0' }}>
                  <td style={td}>{dt}</td>
                  <td style={td}>{r.client_name || '不明'}</td>
                  <td style={td}>{r.created_by || '-'}</td>
                  <td style={td}>{strengths}</td>
                  <td style={td}>{tags}</td>
                  <td style={td}><Link href={`/admin/${r.id}`} style={{ color: '#2F6F5F' }}>開く</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && <p style={{ marginTop: 16 }}>条件に合致するデータがありません。</p>}
      </main>
    </>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', fontWeight: 700, fontSize: 13, color: '#0f3c2f' };
const td: React.CSSProperties = { padding: '10px 8px', fontSize: 13, verticalAlign: 'top' };
const input: React.CSSProperties = { marginLeft: 6, padding: '6px 8px', border: '1px solid #D3EEE5', borderRadius: 6, fontSize: 13 };
const btn: React.CSSProperties = { padding: '6px 12px', border: '1px solid #2F6F5F', borderRadius: 6, background: '#2F6F5F', color: '#fff', fontSize: 13, cursor: 'pointer' };