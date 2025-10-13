import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { getSupabase } from '../../lib/supabase';

export type SessionRow = { id: string; created_at: string; client_name: string | null; created_by: string | null };
export type SheetRow = { session_id: string; summary: string | null; strengths: string[] | null; tags: string[] | null };

export const getServerSideProps: GetServerSideProps = async () => {
  const supabase = getSupabase();

  // 最新100件のセッション
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, created_at, client_name, created_by')
    .order('created_at', { ascending: false })
    .limit(100);
  if (sErr) throw sErr;

  const ids = (sessions ?? []).map((s) => s.id);
  // sheets をセッションIDで取得
  const { data: sheets, error: shErr } = await supabase
    .from('sheets')
    .select('session_id, summary, strengths, tags')
    .in('session_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (shErr) throw shErr;

  const sheetMap = new Map<string, SheetRow>();
  (sheets ?? []).forEach((r) => sheetMap.set(r.session_id, r as SheetRow));

  const rows = (sessions ?? []).map((s) => ({ ...s, sheet: sheetMap.get(s.id) || null }));

  return { props: { rows } };
};

export default function AdminList({ rows }: { rows: (SessionRow & { sheet: SheetRow | null })[] }) {
  return (
    <>
      <Head><title>Admin | Interview Sessions</title></Head>
      <main style={{ maxWidth: 980, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif, system-ui, -apple-system' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>インタビュー一覧（最新100件）</h1>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Link href="/" style={{ textDecoration: 'none', color: '#2F6F5F' }}>← トップへ</Link>
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

        {rows.length === 0 && <p style={{ marginTop: 16 }}>まだデータがありません。</p>}
      </main>
    </>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', fontWeight: 700, fontSize: 13, color: '#0f3c2f' };
const td: React.CSSProperties = { padding: '10px 8px', fontSize: 13, verticalAlign: 'top' };