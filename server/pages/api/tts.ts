import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: true } };

/**
 * POST /api/tts
 * body: { text: string, voiceId?: string, modelId?: string, stability?: number, similarity_boost?: number }
 * returns: audio/mpeg (MP3 bytes)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const apiKey = process.env.ELEVEN_API_KEY;
  const defaultVoiceId = process.env.ELEVEN_VOICE_ID; // 例: "21m00Tcm4TlvDq8ikWAM"
  if (!apiKey || !defaultVoiceId) {
    return res.status(500).send('Missing ELEVEN_API_KEY or ELEVEN_VOICE_ID');
  }

  try {
    const {
      text,
      voiceId,
      modelId = 'eleven_multilingual_v2',
      stability = 0.35,
      similarity_boost = 0.75,
    } = (req.body || {}) as {
      text?: string;
      voiceId?: string;
      modelId?: string;
      stability?: number;
      similarity_boost?: number;
    };

    if (!text || typeof text !== 'string') {
      return res.status(400).send('text is required');
    }

    const vid = (voiceId || defaultVoiceId).trim();

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability, similarity_boost },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).send(`ElevenLabs error: ${errText}`);
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buf);
  } catch (e: any) {
    res.status(500).send(e?.message ?? 'TTS error');
  }
}