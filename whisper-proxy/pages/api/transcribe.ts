// Note: 初回のみ `npm i formidable` を whisper-proxy ディレクトリで実行してください
import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File as FormidableFile } from 'formidable';
import fs from 'fs';
import os from 'os';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });

  try {
    // 1) multipart を解析（一時保存先を明示）
    const form = formidable({ multiples: false, keepExtensions: true, uploadDir: os.tmpdir() });
    const { fields, files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });

    // 2) audio フィールド優先でファイルを取得
    const pickAny = (v: any) => (Array.isArray(v) ? v[0] : v);
    const anyFiles: any = files as any;
    const file: FormidableFile | undefined = pickAny(anyFiles.audio) || pickAny(anyFiles.file) || pickAny(Object.values(anyFiles)[0]);

    if (!file) {
      return res.status(400).json({ error: 'audio file not received', debug: Object.keys(anyFiles) });
    }

    // 3) できる限り多くの候補からパスを取得
    const anyFile: any = file as any;
    const json = typeof anyFile.toJSON === 'function' ? anyFile.toJSON() : undefined;
    const filePath: string | undefined =
      (anyFile.filepath as string | undefined) ||
      (anyFile.path as string | undefined) ||
      (anyFile._writeStream?.path as string | undefined) ||
      (anyFile._writeStream?.opts?.path as string | undefined) ||
      (json && ((json as any).filepath || (json as any).path));

    if (!filePath) {
      return res.status(400).json({ error: 'file path missing', debug: { json, keys: Object.keys(anyFile || {}) } });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ error: `file not found on disk: ${filePath}` });
    }

    // 4) Whisper へ転送
    const buffer = await fs.promises.readFile(filePath);
    const fd = new FormData();
    fd.append('file', new Blob([buffer], { type: 'audio/m4a' }), file.originalFilename || 'audio.m4a');
    fd.append('model', 'whisper-1');
    fd.append('language', 'ja');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: errText });
    }

    const jsonResp = await resp.json();
    return res.status(200).json({ text: jsonResp.text || '' });
  } catch (e: any) {
    console.error('transcribe error', e);
    return res.status(500).json({ error: e?.message ?? 'transcribe error' });
  }
}