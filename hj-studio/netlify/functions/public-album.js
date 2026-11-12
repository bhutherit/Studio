const L = require('./_lib');

// Public, login-free endpoint used by the customer viewer.
exports.handler = L.route(async (event) => {
  if (event.httpMethod !== 'GET') throw new L.HttpError(405, 'Method not allowed.');
  const q = event.queryStringParameters || {};
  const id = String(q.id || '').toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(id)) throw new L.HttpError(404, 'This album could not be found.');
  const db = await L.getDb();
  const col = db.collection('albums');
  const a = await col.findOne({ albumId: id });
  if (!a || a.status !== 'published') throw new L.HttpError(404, 'This album could not be found.');
  if (a.active === false) throw new L.HttpError(403, 'This album link has been turned off. Please contact your photographer.');
  if (q.count === '1') await col.updateOne({ albumId: id }, { $inc: { views: 1 } });
  const s = (await db.collection('settings').findOne({ _id: 'main' })) || {};
  return {
    album: {
      albumId: a.albumId, title: a.title, customerName: a.customerName, eventType: a.eventType,
      eventDate: a.eventDate || '', theme: a.theme, cover: a.cover ? { url: a.cover.url } : null,
      photos: (a.photos || []).map((p) => ({ id: p.id, url: p.url, caption: p.caption, layout: p.layout })),
      showPageNumbers: a.showPageNumbers !== false, showCaptions: a.showCaptions !== false,
      downloadMode: a.downloadMode || 'web', introText: a.introText || '', backText: a.backText || '',
    },
    studio: { name: s.studioName || 'HJ Studio', tagline: s.tagline || '', whatsapp: s.whatsapp || '' },
  };
}, { admin: false });
