const { ObjectId } = require('mongodb');
const L = require('./_lib');
const { str } = L;

exports.handler = L.route(async (event) => {
  const db = await L.getDb();
  const col = db.collection('customers');
  const q = event.queryStringParameters || {};
  const m = event.httpMethod;

  if (m === 'GET') {
    const [list, counts] = await Promise.all([
      col.find({}).sort({ name: 1 }).toArray(),
      db.collection('albums').aggregate([{ $group: { _id: { $toLower: '$customerName' }, n: { $sum: 1 } } }]).toArray(),
    ]);
    const map = new Map(counts.map((c) => [c._id, c.n]));
    return { customers: list.map((c) => ({ id: String(c._id), name: c.name, phone: c.phone || '', email: c.email || '', notes: c.notes || '', albumCount: map.get(c.nameLower) || 0 })) };
  }

  if (m === 'POST') {
    const b = L.parseBody(event);
    const name = str(b.name, 120);
    if (!name) throw new L.HttpError(400, 'Customer name is required.');
    if (await col.findOne({ nameLower: name.toLowerCase() })) throw new L.HttpError(409, 'A customer with this name already exists.');
    await col.insertOne({ name, nameLower: name.toLowerCase(), phone: str(b.phone, 30), email: str(b.email, 120), notes: str(b.notes, 1000), createdAt: new Date() });
    return { ok: true };
  }

  if (!ObjectId.isValid(q.id || '')) throw new L.HttpError(400, 'Invalid customer ID.');
  const _id = new ObjectId(q.id);
  const cur = await col.findOne({ _id });
  if (!cur) throw new L.HttpError(404, 'Customer not found.');

  if (m === 'PUT') {
    const b = L.parseBody(event);
    const name = str(b.name, 120);
    if (!name) throw new L.HttpError(400, 'Customer name is required.');
    const clash = await col.findOne({ nameLower: name.toLowerCase(), _id: { $ne: _id } });
    if (clash) throw new L.HttpError(409, 'A customer with this name already exists.');
    await col.updateOne({ _id }, { $set: { name, nameLower: name.toLowerCase(), phone: str(b.phone, 30), email: str(b.email, 120), notes: str(b.notes, 1000) } });
    if (name !== cur.name) {
      await db.collection('albums').updateMany({ customerName: cur.name }, { $set: { customerName: name } });
    }
    return { ok: true };
  }

  if (m === 'DELETE') {
    await col.deleteOne({ _id }); // albums keep the customer name
    return { ok: true };
  }
  throw new L.HttpError(405, 'Method not allowed.');
});
