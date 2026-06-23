const { getIdToken } = require('./token');

const API_BASE = 'https://sh-native-api.homevsmart.com/v1.0';

const MODE = { cool: 1, dry: 2, heat: 4, off: 5 };
const FAN  = { auto: 0, fan1: 1, fan2: 2, fan3: 3, fan4: 4, fan5: 5 };

let deviceCache   = { list: null, expiresAt: 0 };
let fetchInFlight = null;

function buildGensi(mode, fan = 'auto') {
  if (!(mode in MODE)) throw new Error(`Geçersiz mod: ${mode}`);
  if (!(fan  in FAN))  throw new Error(`Geçersiz fan: ${fan}`);
  return `ACGENSI${String((FAN[fan] << 3) | MODE[mode]).padStart(5, '0')}`;
}

function buildTemot(temp) {
  temp = Number(temp);
  if (temp < 18 || temp > 30) throw new Error('Sıcaklık 18-30 arasında olmalı');
  return `ACTEMOT${String(temp + 32736).padStart(5, '0')}`;
}

function buildCode({ cmd, mode = 'cool', fan = 'auto', temp = 22 }) {
  switch (cmd) {
    case 'on':   return buildGensi(mode, fan);
    case 'off':  return buildGensi('off', fan);
    case 'temp': return buildTemot(temp);
    case 'mode': return buildGensi(mode, fan);
    case 'fan':  return buildGensi(mode, fan);
    default:     throw new Error(`Geçersiz komut: ${cmd}`);
  }
}

async function fetchDevices() {
  if (deviceCache.list && deviceCache.expiresAt > Date.now()) return deviceCache;
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    try {
      const token = await getIdToken();

      const homesRes  = await fetch(`${API_BASE}/homes`, { headers: { token } });
      const homesData = await homesRes.json();
      if (!homesRes.ok) throw new Error(`Home listesi alınamadı: ${homesRes.status}`);

      const homes = homesData.items ?? [];
      const list  = [];

      await Promise.all(homes.map(async ({ homeId, homeName }) => {
        const res  = await fetch(`${API_BASE}/homes/${homeId}/devices`, { headers: { token } });
        const data = await res.json();
        for (const d of data?.items?.homeappliances ?? []) {
          if (!d.deviceId) continue;
          list.push({ deviceName: d.deviceName, deviceId: d.deviceId, homeName });
        }
      }));

      deviceCache = { list, expiresAt: Date.now() + 5 * 60_000 };
      return deviceCache;
    } finally {
      fetchInFlight = null;
    }
  })();
  return fetchInFlight;
}

async function getDevices() {
  const { list } = await fetchDevices();
  return list;
}

async function sendCommand(deviceId, code) {
  const token   = await getIdToken();
  const payload = {
    device_type:    'AC',
    wifi_card_type: 'HM07',
    brand:          'Vestel',
    message:        JSON.stringify({ cmd: `c:${deviceId},${code}` }),
  };

  const res = await fetch(`${API_BASE}/customer/devices/${deviceId}/legacy/command`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', token },
    body:    JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`API hatası: ${res.status} ${JSON.stringify(data)}`);
  return { code, deviceId, result: data };
}

const MODE_NAME = { 1: 'cool', 2: 'dry', 4: 'heat', 5: 'off' };
const FAN_NAME  = { 0: 'auto', 1: 'fan1', 2: 'fan2', 3: 'fan3', 4: 'fan4', 5: 'fan5' };

async function getStatus(deviceId) {
  const token = await getIdToken();
  const res   = await fetch(
    `${API_BASE}/homeappliances/legacy/status?uuid=${deviceId}`,
    { headers: { token } }
  );
  const data  = await res.json();
  if (!res.ok || data.status !== 'SUCCESS') throw new Error(`Status alınamadı: ${JSON.stringify(data)}`);

  const d       = data.data;
  const gensi   = parseInt(d.ACGENSI, 10);
  const modeRaw = gensi & 7;
  const fanRaw  = gensi >> 3;
  const temp    = parseInt(d.ACTEMOT, 10) - 32736;
  const roomTemp = parseInt(d.ACROOTE, 10);
  const mode    = MODE_NAME[modeRaw] ?? 'cool';
  const fan     = FAN_NAME[fanRaw]   ?? 'auto';
  const on      = modeRaw !== 5;

  return { on, mode, fan, temp, roomTemp, raw: d };
}

module.exports = { sendCommand, buildCode, getDevices, getStatus };
