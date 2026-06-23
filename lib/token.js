const fs   = require('fs');
const path = require('path');

const TOKEN_ENDPOINT  = 'https://hosted-kimlik.vestel.com.tr/oauth2/token';
const CACHE_FILE      = path.join(__dirname, '../data/token-cache.json');
const REFRESH_FILE    = path.join(__dirname, '../data/refresh-token.txt');

let cache = { idToken: null, expiresAt: 0 };

function getRefreshToken() {
  if (!fs.existsSync(REFRESH_FILE)) throw new Error('Refresh token bulunamadı. Setup tamamlandı mı?');
  return fs.readFileSync(REFRESH_FILE, 'utf8').trim();
}

async function refreshIdToken() {
  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.OAUTH_CLIENT_ID,
    client_secret: process.env.OAUTH_CLIENT_SECRET,
    refresh_token: getRefreshToken(),
  });

  const res  = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params,
  });
  const data = await res.json();

  if (!res.ok) throw new Error(`Token yenileme başarısız: ${JSON.stringify(data)}`);

  cache = { idToken: data.id_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return cache.idToken;
}

async function getIdToken() {
  if (cache.idToken && cache.expiresAt > Date.now() + 60_000) return cache.idToken;

  if (fs.existsSync(CACHE_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (saved.idToken && saved.expiresAt > Date.now() + 60_000) {
        cache = saved;
        return cache.idToken;
      }
    } catch { /* disk cache okunamadı, refresh dene */ }
  }

  return refreshIdToken();
}

function saveTokens(idToken, refreshToken, expiresIn) {
  cache = { idToken, expiresAt: Date.now() + expiresIn * 1000 };
  fs.writeFileSync(CACHE_FILE,   JSON.stringify(cache));
  fs.writeFileSync(REFRESH_FILE, refreshToken);
}

module.exports = { getIdToken, saveTokens };
