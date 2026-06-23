const express    = require('express');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const { saveTokens } = require('../lib/token');

const router    = express.Router();
const TOKEN_EP  = 'https://hosted-kimlik.vestel.com.tr/oauth2/token';
const AUTH_EP   = 'https://hosted-kimlik.vestel.com.tr/oauth2/authorize';
const PKCE_FILE = path.join(__dirname, '../data/pkce-state.json');

function redirectUri() {
  return process.env.REDIRECT_URI || 'http://localhost:3000';
}

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/setup/index.html'));
});

router.post('/start', (req, res) => {
  const verifier  = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const apiKey    = req.body.apiKey ?? '';

  fs.writeFileSync(PKCE_FILE, JSON.stringify({ verifier, apiKey, ts: Date.now() }));

  const authUrl = AUTH_EP + '?' + new URLSearchParams({
    client_id:             process.env.OAUTH_CLIENT_ID,
    response_type:         'code',
    scope:                 'openid email profile',
    redirect_uri:          redirectUri(),
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });

  res.json({ authUrl });
});

async function exchangeCode(req, res) {
  const { code, error } = req.query;

  if (error) return res.redirect('/setup/?error=' + encodeURIComponent(error));
  if (!code)  return null; // code yoksa bu bir setup callback değil, devam et

  if (!fs.existsSync(PKCE_FILE)) return res.redirect('/setup/?error=no_pkce_state');

  try {
    const pkce = JSON.parse(fs.readFileSync(PKCE_FILE, 'utf8'));
    if (Date.now() - pkce.ts > 600_000) return res.redirect('/setup/?error=pkce_expired');

    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     process.env.OAUTH_CLIENT_ID,
      client_secret: process.env.OAUTH_CLIENT_SECRET,
      redirect_uri:  redirectUri(),
      code,
      code_verifier: pkce.verifier,
    });

    const resp = await fetch(TOKEN_EP, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params,
    });

    const data = await resp.json();
    if (!resp.ok) return res.redirect('/setup/?error=' + encodeURIComponent(JSON.stringify(data)));

    saveTokens(data.id_token, data.refresh_token, data.expires_in ?? 3600);
    const { apiKey } = pkce;
    fs.unlinkSync(PKCE_FILE);

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>
      ${apiKey ? `localStorage.setItem('vac_key', ${JSON.stringify(apiKey)});` : ''}
      location.href = '/';
    </script></body></html>`);
  } catch (e) {
    res.redirect('/setup/?error=' + encodeURIComponent(e.message));
  }
}

router.post('/callback', async (req, res) => {
  const { callbackUrl, apiKey } = req.body;
  let code;
  try {
    code = new URL(callbackUrl).searchParams.get('code');
  } catch {
    return res.status(400).json({ error: 'Geçersiz URL' });
  }
  if (!code) return res.status(400).json({ error: "URL'de code parametresi bulunamadı" });
  if (!fs.existsSync(PKCE_FILE)) return res.status(400).json({ error: 'PKCE state bulunamadı. Önce Giriş Yap butonuna tıkla.' });

  try {
    const pkce = JSON.parse(fs.readFileSync(PKCE_FILE, 'utf8'));
    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     process.env.OAUTH_CLIENT_ID,
      client_secret: process.env.OAUTH_CLIENT_SECRET,
      redirect_uri:  redirectUri(),
      code,
      code_verifier: pkce.verifier,
    });
    const resp = await fetch(TOKEN_EP, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params,
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(400).json({ error: JSON.stringify(data) });
    saveTokens(data.id_token, data.refresh_token, data.expires_in ?? 3600);
    fs.unlinkSync(PKCE_FILE);
    res.json({ ok: true, apiKey: pkce.apiKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/token', async (req, res) => {
  const { refreshToken, apiKey } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken gerekli' });

  try {
    const params = new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.OAUTH_CLIENT_ID,
      client_secret: process.env.OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken.trim(),
    });

    const resp = await fetch(TOKEN_EP, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params,
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(400).json({ error: JSON.stringify(data) });

    saveTokens(data.id_token, refreshToken.trim(), data.expires_in ?? 3600);
    if (apiKey) res.setHeader('Set-Cookie', ''); // apiKey localStorage'a JS ile yazılır
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.exchangeCode = exchangeCode;
