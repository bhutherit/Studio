// Shared helpers for all Netlify Functions. Secrets are read ONLY from environment variables.
const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let dbPromise = null;
async function getDb() {
  if (!process.env.MONGODB_URI) throw new HttpError(500, 'MONGODB_URI is not configured on the server.');
  if (!dbPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    dbPromise = client.connect().then(async (c) => {
      const db = c.db(process.env.MONGODB_DB || 'hj_studio');
      await Promise.all([
        db.collection('albums').createIndex({ albumId: 1 }, { unique: true }),
        db.collection('albums').createIndex({ createdAt: -1 }),
        db.collection('customers').createIndex({ nameLower: 1 }),
      ]);
      return db;
    }).catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
}

function cloudName() {
  const { CLOUDINARY_CLOUD_NAME: n, CLOUDINARY_API_KEY: k, CLOUDINARY_API_SECRET: s } = process.env;
  if (!n || !k || !s) throw new HttpError(500, 'Cloudinary environment variables are not configured.');
  cloudinary.config({ cloud_name: n, api_key: k, api_secret: s, secure: true });
  return n;
}

async function destroyAssets(publicIds) {
  if (!publicIds.length) return;
  cloudName();
  for (let i = 0; i < publicIds.length; i += 90) {
    try { await cloudinary.api.delete_resources(publicIds.slice(i, i + 90)); }
    catch (e) { console.error('Cloudinary delete failed', e.message); }
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw);
  } catch { throw new HttpError(400, 'Invalid request body.'); }
}

function requireAdmin(event) {
  const h = event.headers || {};
  const token = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.JWT_SECRET) throw new HttpError(500, 'JWT_SECRET is not configured on the server.');
  if (!token) throw new HttpError(401, 'Please sign in.');
  try { jwt.verify(token, process.env.JWT_SECRET); }
  catch { throw new HttpError(401, 'Your session expired. Please sign in again.'); }
}

// Wraps a function: auth check, JSON output and uniform error handling.
function route(fn, { admin = true } = {}) {
  return async (event) => {
    try {
      if (admin) requireAdmin(event);
      return json(200, await fn(event));
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error(e);
      return json(500, { error: 'Server error. Please try again.' });
    }
  };
}

const uid = () => crypto.randomBytes(5).toString('hex');

// Unique, human-friendly permanent ID such as HD7291.
async function newAlbumId(db) {
  for (let i = 0; i < 30; i++) {
    const len = i < 20 ? 4 : 5;
    let digits = '';
    for (let k = 0; k < len; k++) digits += crypto.randomInt(0, 10);
    const id = 'HD' + digits;
    if (!(await db.collection('albums').findOne({ albumId: id }, { projection: { _id: 1 } }))) return id;
  }
  throw new HttpError(500, 'Could not generate a unique album ID.');
}

async function upsertCustomer(db, name, phone) {
  const nameLower = name.toLowerCase();
  const col = db.collection('customers');
  const found = await col.findOne({ nameLower });
  if (!found) {
    await col.insertOne({ name, nameLower, phone: phone || '', email: '', notes: '', createdAt: new Date() });
  } else if (phone && !found.phone) {
    await col.updateOne({ _id: found._id }, { $set: { phone } });
  }
}

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

module.exports = { HttpError, getDb, cloudName, destroyAssets, json, parseBody, requireAdmin, route, uid, newAlbumId, upsertCustomer, str, jwt, cloudinary };
