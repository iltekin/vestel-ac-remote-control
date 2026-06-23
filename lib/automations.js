'use strict';

const fs   = require('fs');
const path = require('path');
const { getStatus, sendCommand, buildCode } = require('./ac-commands');

const FILE        = path.join(__dirname, '../data/automations.json');
const COOLDOWN_MS = 60 * 1000;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}

function save(list) {
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

const getAll = () => load();

function create(data) {
  const list = load();
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    enabled: true,
    lastFired: null,
    ...data,
  };
  list.push(item);
  save(list);
  return item;
}

function update(id, patch) {
  const list = load();
  const i = list.findIndex(a => a.id === id);
  if (i === -1) throw new Error('Bulunamadı');
  list[i] = { ...list[i], ...patch };
  save(list);
  return list[i];
}

function remove(id) {
  save(load().filter(a => a.id !== id));
}

function alreadyInState(status, action) {
  if (action.cmd === 'off' && !status.on) return true;
  if (action.cmd === 'on'  &&  status.on) return true;
  return false;
}

async function executeAction(deviceId, action) {
  const { cmd, mode = 'cool', fan = 'auto', temp } = action;
  if (cmd === 'off') {
    await sendCommand(deviceId, buildCode({ cmd: 'off' }));
  } else {
    await sendCommand(deviceId, buildCode({ cmd: 'on', mode, fan }));
    if (temp) await sendCommand(deviceId, buildCode({ cmd: 'temp', temp: Number(temp) }));
  }
}

async function tick() {
  const list = load();
  if (!list.length) return;

  const now   = new Date();
  const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const stamp = `${now.toISOString().slice(0, 10)} ${hhmm}`;
  let dirty = false;

  for (const a of list) {
    if (!a.enabled) continue;
    try {
      if (a.type === 'schedule') {
        if (a.schedule.time !== hhmm) continue;
        if (a.schedule.days?.length && !a.schedule.days.includes(now.getDay())) continue;
        if (a.lastFired === stamp) continue;
        const status = await getStatus(a.deviceId);
        if (alreadyInState(status, a.action)) {
          a.lastFired = stamp;
          dirty = true;
          console.log(`[Otomasyon] "${a.name}" → zaten ${a.action.cmd === 'off' ? 'kapalı' : 'açık'}, atlandı`);
          continue;
        }
        await executeAction(a.deviceId, a.action);
        a.lastFired = stamp;
        dirty = true;
        console.log(`[Otomasyon] "${a.name}" → ${a.action.cmd}`);
      } else if (a.type === 'temperature') {
        if (a.lastFired && Date.now() - new Date(a.lastFired).getTime() < COOLDOWN_MS) continue;
        const status = await getStatus(a.deviceId);
        if (status.roomTemp == null) continue;
        const met = a.condition.operator === '>' ? status.roomTemp > a.condition.value : status.roomTemp < a.condition.value;
        if (!met) continue;
        if (alreadyInState(status, a.action)) {
          a.lastFired = new Date().toISOString();
          dirty = true;
          console.log(`[Otomasyon] "${a.name}" → zaten ${a.action.cmd === 'off' ? 'kapalı' : 'açık'}, atlandı`);
          continue;
        }
        await executeAction(a.deviceId, a.action);
        a.lastFired = new Date().toISOString();
        dirty = true;
        console.log(`[Otomasyon] "${a.name}" → oda ${status.roomTemp}°C`);
      }
    } catch (e) {
      console.error(`[Otomasyon] "${a.name}":`, e.message);
    }
  }

  if (dirty) save(list);
}

function start() {
  tick();
  setInterval(tick, 60_000);
}

module.exports = { getAll, create, update, remove, start };
