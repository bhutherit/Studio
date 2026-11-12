const L = require('./_lib');

const EVENTS = ['Wedding', 'Engagement', 'Birthday', 'Pre-Wedding', 'Anniversary', 'Portfolio', 'Other'];
const THEMES = ['ivory', 'noir', 'rose', 'sage', 'navy'];
const MODES = ['off', 'web', 'original'];
const { str } = L;

const shape = (a) => { const { _id, ...rest } = a; return rest; };

function cleanImage(img, cloud) {
  if (!img || typeof img !== 'object') return null;
  const url = str(img.url, 600);
  const publicId = str(img.publicId, 300);
  if (!url.startsWith(`https://res.cloudinary.com/${cloud}/`) || !publicId) {
    throw new L.HttpError(400, 'Invalid image reference.');
  }
  return {
    id: str(img.id, 24) || L.uid(), url, publicId,
    width: +img.width || 0, height: +img.height || 0, bytes: +img.bytes || 0,
    caption: str(img.caption, 200), layout: img.layout === 'spread' ? 'spread' : 'single',
  };
}

const listPipeline = (extra = []) => [
  { $sort: { createdAt: -1 } },
  ...extra,
  { $addFields: {
    photoCount: { $size: { $ifNull: ['$photos', []] } },
    thumb: { $ifNull: ['$cover.url', { $arrayElemAt: [{ $ifNull: ['$photos.url', []] }, 0] }] },
  } },
  { $project: { photos: 0 } },
];

exports.handler = L.route(async (event) => {
  const db = await L.getDb();
  const col = db.collection('albums');
  const q = event.queryStringParameters || {};
  const m = event.httpMethod;
  const id = String(q.id || '').toUpperCase();

  if (m === 'GET') {
    if (q.stats) {
      const [totals] = await col.aggregate([{ $group: {
        _id: null, albums: { $sum: 1 }, views: { $sum: { $ifNull: ['$views', 0] } },
        photos: { $sum: { $size: { $ifNull: ['$photos', []] } } },
      } }]).toArray();
      const customers = await db.collection('customers').countDocuments();
      const recent = await col.aggregate(listPipeline([{ $limit: 6 }])).toArray();
      return { stats: { albums: totals?.albums || 0, photos: totals?.photos || 0, views: totals?.views || 0, customers }, recent: recent.map(shape) };
    }
    if (id) {
      const a = await col.findOne({ albumId: id });
      if (!a) throw new L.HttpError(404, 'Album not found.');
      return { album: shape(a) };
    }
    return { albums: (await col.aggregate(listPipeline()).toArray()).map(shape) };
  }

  if (m === 'POST') {
    const b = L.parseBody(event);
    const title = str(b.title, 120);
    const customerName = str(b.customerName, 120);
    if (!title) throw new L.HttpError(400, 'Album name is required.');
    if (!customerName) throw new L.HttpError(400, 'Customer name is required.');
    if (!EVENTS.includes(b.eventType)) throw new L.HttpError(400, 'Choose an event type.');
    for (let t = 0; t < 5; t++) {
      const now = new Date();
      const doc = {
        albumId: await L.newAlbumId(db), title, customerName, customerPhone: str(b.customerPhone, 30),
        eventType: b.eventType, eventDate: str(b.eventDate, 10),
        theme: THEMES.includes(b.theme) ? b.theme : 'ivory',
        downloadMode: MODES.includes(b.downloadMode) ? b.downloadMode : 'web',
        status: 'draft', active: true, views: 0, cover: null, photos: [],
        showPageNumbers: true, showCaptions: true, introText: '', backText: '',
        createdAt: now, updatedAt: now,
      };
      try {
        await col.insertOne(doc);
        await L.upsertCustomer(db, customerName, doc.customerPhone);
        return { album: shape(doc) };
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    throw new L.HttpError(500, 'Could not create album. Try again.');
  }

  if (!id) throw new L.HttpError(400, 'Album ID is required.');
  const cur = await col.findOne({ albumId: id });
  if (!cur) throw new L.HttpError(404, 'Album not found.');
  const ids = (a) => [...(a.photos || []).map((p) => p.publicId), a.cover && a.cover.publicId].filter(Boolean);

  if (m === 'PUT') {
    const b = L.parseBody(event);
    const cloud = L.cloudName();
    const set = { updatedAt: new Date() };
    if ('title' in b) { set.title = str(b.title, 120); if (!set.title) throw new L.HttpError(400, 'Album name is required.'); }
    if ('customerName' in b) { set.customerName = str(b.customerName, 120); if (!set.customerName) throw new L.HttpError(400, 'Customer name is required.'); }
    if ('customerPhone' in b) set.customerPhone = str(b.customerPhone, 30);
    if ('eventType' in b) { if (!EVENTS.includes(b.eventType)) throw new L.HttpError(400, 'Invalid event type.'); set.eventType = b.eventType; }
    if ('eventDate' in b) set.eventDate = str(b.eventDate, 10);
    if ('theme' in b) { if (!THEMES.includes(b.theme)) throw new L.HttpError(400, 'Invalid theme.'); set.theme = b.theme; }
    if ('downloadMode' in b) { if (!MODES.includes(b.downloadMode)) throw new L.HttpError(400, 'Invalid download setting.'); set.downloadMode = b.downloadMode; }
    if ('status' in b) { if (!['draft', 'published'].includes(b.status)) throw new L.HttpError(400, 'Invalid status.'); set.status = b.status; }
    if ('active' in b) set.active = !!b.active;
    if ('showPageNumbers' in b) set.showPageNumbers = !!b.showPageNumbers;
    if ('showCaptions' in b) set.showCaptions = !!b.showCaptions;
    if ('introText' in b) set.introText = str(b.introText, 300);
    if ('backText' in b) set.backText = str(b.backText, 300);
    if ('cover' in b) set.cover = b.cover ? cleanImage(b.cover, cloud) : null;
    if ('photos' in b) {
      if (!Array.isArray(b.photos) || b.photos.length > 1000) throw new L.HttpError(400, 'Invalid photo list.');
      set.photos = b.photos.map((p) => cleanImage(p, cloud));
    }
    await col.updateOne({ albumId: id }, { $set: set });
    const next = await col.findOne({ albumId: id });
    const keep = new Set(ids(next));
    await L.destroyAssets(ids(cur).filter((x) => !keep.has(x)));
    if (set.customerName) await L.upsertCustomer(db, set.customerName, set.customerPhone);
    return { album: shape(next) };
  }

  if (m === 'DELETE') {
    await L.destroyAssets(ids(cur));
    try { L.cloudName(); await L.cloudinary.api.delete_folder(`hjstudio/${id}`); } catch { /* folder may not be empty or exist */ }
    await col.deleteOne({ albumId: id });
    return { deleted: id };
  }

  throw new L.HttpError(405, 'Method not allowed.');
});
