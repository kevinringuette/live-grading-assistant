const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

// Load OAuth credentials
const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, '../credentials.json'), 'utf8'));
const { client_id, client_secret } = credentials.web;

// Determine redirect URI based on environment
const getRedirectUri = (req) => {
  const host = req.headers.host;
  if (host && host.includes('vercel.app')) {
    return `https://${host}/auth/callback`;
  }
  return 'http://localhost:3000/auth/callback';
};

// Create OAuth2 client
const oauth2Client = new OAuth2Client(
  client_id,
  client_secret
);

// In-memory session store (for demo - use Redis/database in production)
const sessions = new Map();

// Helper to get session
const getSession = (req) => {
  const sessionId = req.headers.cookie?.match(/sessionId=([^;]+)/)?.[1];
  return sessionId ? sessions.get(sessionId) : null;
};

// Helper to set session
const setSession = (res, sessionData) => {
  const sessionId = Math.random().toString(36).substring(7);
  sessions.set(sessionId, {
    ...sessionData,
    createdAt: Date.now()
  });
  res.setHeader('Set-Cookie', `sessionId=${sessionId}; Path=/; HttpOnly; Max-Age=86400; SameSite=Lax`);
  return sessionId;
};

// Helper to destroy session
const destroySession = (req, res) => {
  const sessionId = req.headers.cookie?.match(/sessionId=([^;]+)/)?.[1];
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.setHeader('Set-Cookie', 'sessionId=; Path=/; HttpOnly; Max-Age=0');
};

module.exports = async (req, res) => {
  const { url, method } = req;
  const pathname = url.split('?')[0];

  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Route: /auth/google - Generate OAuth URL
    if (pathname === '/auth/google' && method === 'GET') {
      const redirectUri = getRedirectUri(req);
      console.log('[OAuth] Host:', req.headers.host);
      console.log('[OAuth] Redirect URI:', redirectUri);
      oauth2Client.redirectUri = redirectUri;

      const authorizeUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile'
        ],
        prompt: 'select_account',
        redirect_uri: redirectUri
      });

      console.log('[OAuth] Generated URL:', authorizeUrl);
      return res.status(200).json({ url: authorizeUrl });
    }

    // Route: /auth/callback - OAuth callback handler
    if (pathname === '/auth/callback' && method === 'GET') {
      const code = new URL(url, `http://${req.headers.host}`).searchParams.get('code');

      if (!code) {
        res.setHeader('Location', '/?error=no_code');
        return res.status(302).end();
      }

      const redirectUri = getRedirectUri(req);
      oauth2Client.redirectUri = redirectUri;

      // Exchange authorization code for tokens
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get user info
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: client_id
      });

      const payload = ticket.getPayload();
      const userEmail = payload.email;
      const userName = payload.name;

      // Store user info in session
      setSession(res, {
        email: userEmail,
        name: userName,
        authenticated: true
      });

      // Redirect back to the app
      res.setHeader('Location', '/?authenticated=true');
      return res.status(302).end();
    }

    // Route: /auth/status - Check authentication status
    if (pathname === '/auth/status' && method === 'GET') {
      const session = getSession(req);

      if (session && session.authenticated) {
        return res.status(200).json({
          authenticated: true,
          email: session.email,
          name: session.name
        });
      } else {
        return res.status(200).json({ authenticated: false });
      }
    }

    // Route: /auth/logout - Logout endpoint
    if (pathname === '/auth/logout' && method === 'POST') {
      destroySession(req, res);
      return res.status(200).json({ success: true });
    }

    // 404 for unknown routes
    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};
