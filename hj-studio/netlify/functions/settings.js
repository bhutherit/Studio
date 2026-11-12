const L = require('./_lib');
const { str } = L;

const DEFAULTS = {
  studioName: 'HJ Studio', tagline: 'Photography and films', whatsapp: '',
  siteUrl: '', defaultTheme: 'ivory', defaultDownload: 'web',
};

exports.handler = L.route(async (event) => {
  const db = await L.getDb();
  const col = db.collection('settings');
  if (event.httpMethod === 'GET') {
    const doc = await col.findOne({ _id: 'main' });
    return { settings: { ...DEFAULTS, ...(doc || {}), _id: undefined } };
  }
  if (event.httpMethod === 'PUT') {
    const b = L.parseBody(event);
    const siteUrl = str(b.siteUrl, 200).replace(/\/+$/, '');
    if (siteUrl && !/^https?:\/\/[^\s]+$/.test(siteUrl)) throw new L.HttpError(400, 'Website address must start with http:// or https://');
    const next = {
      studioName: str(b.studioName, 80) || DEFAULTS.studioName,
      tagline: str(b.tagline, 120),
      whatsapp: str(b.whatsapp, 30).replace(/[^\d+]/g, ''),
      siteUrl,
      defaultTheme: ['ivory', 'noir', 'rose', 'sage', 'navy'].includes(b.defaultTheme) ? b.defaultTheme : 'ivory',
      defaultDownload: ['off', 'web', 'original'].includes(b.defaultDownload) ? b.defaultDownload : 'web',
    };
    await col.updateOne({ _id: 'main' }, { $set: next }, { upsert: true });
    return { settings: next };
  }
  throw new L.HttpError(405, 'Method not allowed.');
});
