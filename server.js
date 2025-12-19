const express = require('express');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Load OAuth credentials
const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
const { client_id, client_secret, redirect_uris } = credentials.web;

// Determine redirect URI based on environment
const getRedirectUri = (req) => {
  const host = req.get('host');
  if (host && host.includes('vercel.app')) {
    return `https://${host}/auth/callback`;
  }
  return 'http://localhost:3000/auth/callback';
};

// Create OAuth2 client (will update redirect URI per request)
const oauth2Client = new OAuth2Client(
  client_id,
  client_secret
);

// Middleware
app.use(express.json());
app.use(express.static('.')); // Serve static files from current directory

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.VERCEL === '1', // Use secure cookies on Vercel (HTTPS)
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Generate OAuth URL
app.get('/auth/google', (req, res) => {
  const redirectUri = getRedirectUri(req);
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
  res.json({ url: authorizeUrl });
});

// OAuth callback handler
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  try {
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
    req.session.user = {
      email: userEmail,
      name: userName,
      authenticated: true
    };

    // Redirect back to the app
    res.redirect('/?authenticated=true');
  } catch (error) {
    console.error('Error during authentication:', error);
    res.redirect('/?error=auth_failed');
  }
});

// Check authentication status
app.get('/auth/status', (req, res) => {
  if (req.session.user && req.session.user.authenticated) {
    res.json({
      authenticated: true,
      email: req.session.user.email,
      name: req.session.user.name
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout endpoint
app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// Start server (only if not on Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`\nTo start the app:`);
    console.log(`1. Make sure you've run: npm install`);
    console.log(`2. Visit: http://localhost:${PORT}/index.html`);
  });
}

// Export for Vercel serverless functions
module.exports = app;
