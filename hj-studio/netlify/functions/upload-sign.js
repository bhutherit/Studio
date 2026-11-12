const L = require('./_lib');

// Returns a short-lived signature so the browser can upload straight to Cloudinary
// without ever seeing the API secret.
exports.handler = L.route(async (event) => {
  if (event.httpMethod !== 'POST') throw new L.HttpError(405, 'Method not allowed.');
  const { albumId } = L.parseBody(event);
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(albumId || '')) throw new L.HttpError(400, 'Invalid album ID.');
  const cloud = L.cloudName();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `hjstudio/${albumId.toUpperCase()}`;
  const signature = L.cloudinary.utils.api_sign_request({ folder, timestamp }, process.env.CLOUDINARY_API_SECRET);
  return { cloudName: cloud, apiKey: process.env.CLOUDINARY_API_KEY, timestamp, folder, signature };
});
