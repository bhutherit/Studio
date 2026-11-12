const crypto = require('crypto');
const L = require('./_lib');

const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

exports.handler = L.route(async (event) => {
  if (event.httpMethod !== 'POST') throw new L.HttpError(405, 'Method not allowed.');
  const { ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !JWT_SECRET) {
    throw new L.HttpError(500, 'ADMIN_EMAIL, ADMIN_PASSWORD and JWT_SECRET must be set in Netlify.');
  }
  const { email, password } = L.parseBody(event);
  const ok = same(String(email || '').trim().toLowerCase(), ADMIN_EMAIL.trim().toLowerCase()) & same(password || '', ADMIN_PASSWORD);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 700)); // slow down guessing
    throw new L.HttpError(401, 'Incorrect email or password.');
  }
  const token = L.jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
  return { token };
}, { admin: false });
