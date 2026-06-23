require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function auth(req, res, next) {
  const key = req.headers['x-api-key'] ?? req.query.api_key;
  if (key === process.env.API_KEY) return next();
  res.status(401).json({ error: 'Geçersiz API key' });
}

const setupRouter = require('./routes/setup');


// Cognito root'a redirect eder — code varsa yakala, yoksa static index.html sun
app.get('/', async (req, res, next) => {
  if (req.query.code || req.query.error) {
    return setupRouter.exchangeCode(req, res);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));
app.use('/setup',       setupRouter);
app.use('/ac',          auth, require('./routes/ac'));
app.use('/automations', auth, require('./routes/automations'));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`AC Control API → http://localhost:${PORT}`);
  require('./lib/automations').start();
});
