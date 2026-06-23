'use strict';

const express = require('express');
const { getAll, create, update, remove } = require('../lib/automations');

const router = express.Router();

router.get('/', (req, res) => res.json(getAll()));

router.post('/', (req, res) => {
  try { res.json(create(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/:id', (req, res) => {
  try { res.json(update(req.params.id, req.body)); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

router.delete('/:id', (req, res) => {
  remove(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
