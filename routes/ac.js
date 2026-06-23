const express      = require('express');
const bplistCreate = require('bplist-creator');
const { sendCommand, buildCode, getDevices, getStatus } = require('../lib/ac-commands');

const router = express.Router();

function makeShortcut(name, url) {
  const obj = {
    WFWorkflowActions: [
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.url',
        WFWorkflowActionParameters: { WFURLActionURL: url },
      },
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.downloadurl',
        WFWorkflowActionParameters: {},
      },
    ],
    WFWorkflowImportQuestions:        [],
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowMinimumClientVersion:   900,
    WFWorkflowName:                   name,
    WFWorkflowTypes:                  [],
    WFWorkflowHasShortcutInputVariables: false,
  };
  return bplistCreate(obj);
}

router.get('/shortcut', (req, res) => {
  const { device_id, cmd, mode, temp, label } = req.query;
  const base = `${req.protocol}://${req.get('host')}`;

  const p = new URLSearchParams({ device_id, cmd, api_key: process.env.API_KEY });
  if (mode) p.set('mode', mode);
  if (temp) p.set('temp', temp);

  const url  = `${base}/ac?${p}`;
  const name = label || `AC ${cmd}`;
  const fileEnc = encodeURIComponent(name + '.shortcut');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="shortcut.shortcut"; filename*=UTF-8''${fileEnc}`);
  res.send(makeShortcut(name, url));
});

router.get('/status', async (req, res) => {
  try {
    res.json(await getStatus(req.query.device_id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/devices', async (req, res) => {
  try {
    res.json(await getDevices());
  } catch (e) {
    const needsSetup = e.message.includes('Refresh token bulunamadı');
    res.status(needsSetup ? 503 : 500).json({ error: e.message, needsSetup });
  }
});

async function handleCommand(deviceId, cmd, mode, fan, temp, res) {
  try {
    // mode / fan / temp için cihaz durumunu kontrol et
    if (cmd === 'mode' || cmd === 'fan' || cmd === 'temp') {
      const s = await getStatus(deviceId);
      if (!s.on) return res.status(400).json({ ok: false, error: 'Klima kapali. Once ac.' });
      mode = mode || s.mode;
      fan  = fan  || s.fan;
    }
    const code   = buildCode({ cmd, mode, fan, temp });
    const result = await sendCommand(deviceId, code);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

router.get('/',  (req, res) => handleCommand(req.query.device_id, req.query.cmd, req.query.mode, req.query.fan, req.query.temp, res));
router.post('/', (req, res) => handleCommand(req.body.device_id,  req.body.cmd,  req.body.mode,  req.body.fan,  req.body.temp,  res));

module.exports = router;
