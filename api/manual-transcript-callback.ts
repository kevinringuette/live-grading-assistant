import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pushResult, popAll } from './_kv';

function withCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shared-Secret');
}

function ok(res: VercelResponse, body: any = { ok: true }) {
  withCors(res);
  return res.status(200).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    withCors(res);
    return res.status(204).end();
  }

  if (req.method === 'POST') {
    try {
      const sharedSecret = req.headers['x-shared-secret'];
      if (process.env.MANUAL_TRANSCRIPT_SECRET) {
        const expected = process.env.MANUAL_TRANSCRIPT_SECRET;
        const provided = Array.isArray(sharedSecret) ? sharedSecret[0] : sharedSecret;
        if (expected && expected.length > 0 && provided !== expected) {
          withCors(res);
          return res.status(401).json({ error: 'unauthorized' });
        }
      }

      const payload = req.body;
      const sessionId = String(payload?.sessionId || '').trim();
      if (!sessionId) {
        withCors(res);
        return res.status(400).json({ error: 'sessionId required' });
      }

      await pushResult(sessionId, payload);

      return ok(res);
    } catch (err: any) {
      console.error('[manual-transcript] POST handler error', err);
      withCors(res);
      return res.status(400).json({ error: err?.message || 'bad request' });
    }
  }

  if (req.method === 'GET') {
    try {
      const sessionIdRaw = req.query.sessionId;
      const sessionId = Array.isArray(sessionIdRaw) ? sessionIdRaw[0] : sessionIdRaw;
      if (!sessionId) {
        withCors(res);
        return res.status(400).json({ error: 'sessionId required' });
      }

      const items = await popAll(String(sessionId));
      return ok(res, { data: items });
    } catch (err: any) {
      console.error('[manual-transcript] GET handler error', err);
      withCors(res);
      return res.status(400).json({ error: err?.message || 'bad request' });
    }
  }

  withCors(res);
  return res.status(405).json({ error: 'method not allowed' });
}
