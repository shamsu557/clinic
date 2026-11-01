'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const config = require('./src/config');
const { pool, db, isTransient } = require('./src/db');
const { loadUser, requireAuth, requireReady } = require('./src/middleware/auth');
const { csrfGuard } = require('./src/middleware/csrf');
const sweep = require('./src/lib/sweep');
const { HttpError } = require('./src/lib/validate');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy === 'false' ? false : (/^\d+$/.test(config.trustProxy) ? parseInt(config.trustProxy, 10) : config.trustProxy));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"],
      formAction: ["'self'"], frameAncestors: ["'none'"],
      ...(config.cookieSecure === true ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  hsts: config.cookieSecure === true ? { maxAge: 15552000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'same-origin' },
}));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

const store = new MySQLStore({ clearExpired: true, checkExpirationInterval: 15 * 60 * 1000, expiration: config.sessionHours * 3600 * 1000,
  createDatabaseTable: false }, pool);
app.use(session({
  name: 'clinic.sid', secret: config.sessionSecret, store, resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: config.sessionHours * 3600 * 1000 },
}));

// Let browsers detect newly deployed PWA manifests and service workers immediately.
app.use(['/sw.js', '/manifest.webmanifest'], (req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

// Static UI (no directory listing, no dotfiles). Uploaded receipts live outside /public.
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'ignore', index: 'index.html', maxAge: config.isProd ? '1h' : 0,
  setHeaders(res, p) { if (/[/\\](?:sw\.js|manifest\.webmanifest)$/.test(p)) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); },
}));

// ---- API ----
const api = express.Router();
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use(loadUser);
api.use(csrfGuard);
api.use('/auth', require('./src/routes/auth'));
api.get('/health', async (req, res, next) => { try { await db.query('SELECT 1'); res.json({ ok: true }); } catch (e) { next(e); } });
api.use(requireAuth, requireReady);
api.use('/admin', require('./src/routes/admin'));
api.use('/', require('./src/routes/catalog'));
api.use('/', require('./src/routes/bookings'));
api.use('/', require('./src/routes/records'));
api.use((req, res, next) => next(new HttpError(404, 'Not found.')));
app.use('/api', api);

// ---- errors ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, fields: err.fields });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  if (isTransient(err)) {
    console.error('[db] connection problem on', req.method, req.originalUrl, '-', err.code || err.message);
    return res.status(503).json({ error: 'The server could not reach its database for a moment. Please try again.' });
  }
  console.error('[error]', req.method, req.originalUrl, err && err.stack ? err.stack : err); // never logs bodies/passwords
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`The Clinic server listening on port ${config.port} (${config.isProd ? 'production' : 'development'})`);
    sweep.start();
  });
}
module.exports = app;
