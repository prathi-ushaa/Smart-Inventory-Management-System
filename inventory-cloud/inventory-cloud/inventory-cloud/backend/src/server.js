const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { User, Product, Movement } = require('./models');
const { sign, requireAuth } = require('./auth');
const alerts = require('./alerts');

const app = express();
app.use(cors());
app.use(express.json());

// Send any thrown error back as JSON instead of crashing the server
const h = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.code === 11000 ? 'That SKU already exists.' : e.message }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- auth ----------
// NOTE: open registration is demo-only. In production only admins should create staff/admin accounts.
app.post('/api/auth/register', h(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  try {
    const user = await User.create({
      name, email, role: role === 'admin' ? 'admin' : 'staff',
      password: await bcrypt.hash(password, 10),
    });
    res.json({ token: sign(user), user: { name: user.name, role: user.role } });
  } catch (e) {
    res.status(400).json({ error: e.code === 11000 ? 'That email is already registered.' : e.message });
  }
}));

app.post('/api/auth/login', h(async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  res.json({ token: sign(user), user: { name: user.name, role: user.role } });
}));

// ---------- products ----------
app.get('/api/products', requireAuth(), h(async (_req, res) => {
  res.json(await Product.find().sort('name'));
}));

app.post('/api/products', requireAuth('admin'), h(async (req, res) => {
  const { sku, name, category, quantity, reorderLevel, price } = req.body;
  const opening = Math.max(0, Math.floor(Number(quantity) || 0));
  const p = await Product.create({
    sku, name, category, quantity: opening,
    reorderLevel: Number(reorderLevel) || 0, price: Number(price) || 0,
  });
  if (opening > 0) await Movement.create({ product: p._id, type: 'in', qty: opening, note: 'Opening stock', by: req.user.id });
  res.json(p);
}));

app.delete('/api/products/:id', requireAuth('admin'), h(async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  await Movement.deleteMany({ product: req.params.id });
  res.json({ deleted: true });
}));

// ---------- stock movements ----------
// body: { type: 'in' | 'out', qty, note }
app.post('/api/products/:id/move', requireAuth(), h(async (req, res) => {
  const qty = Math.floor(Number(req.body.qty));
  const { type, note } = req.body;
  if (!['in', 'out'].includes(type) || !(qty > 0)) return res.status(400).json({ error: 'Choose in or out and a quantity above zero.' });

  // Atomic update: an "out" only succeeds if enough stock is left, so two people can't oversell
  const filter = { _id: req.params.id };
  if (type === 'out') filter.quantity = { $gte: qty };
  const before = await Product.findOneAndUpdate(filter, { $inc: { quantity: type === 'in' ? qty : -qty } }, { new: false });
  if (!before) {
    const exists = await Product.exists({ _id: req.params.id });
    return res.status(exists ? 409 : 404).json({ error: exists ? 'Not enough stock for that.' : 'Product not found.' });
  }

  const after = before.quantity + (type === 'in' ? qty : -qty);
  await Movement.create({ product: before._id, type, qty, note, by: req.user.id });

  // Alert only when stock crosses down through the reorder level
  if (type === 'out' && before.quantity > before.reorderLevel && after <= before.reorderLevel) {
    alerts.lowStock({ ...before.toObject(), quantity: after }).catch((e) => console.error('Alert failed:', e.message));
  }
  res.json({ quantity: after });
}));

app.get('/api/movements', requireAuth(), h(async (_req, res) => {
  res.json(await Movement.find().sort('-date').limit(100)
    .populate('product', 'name sku').populate('by', 'name'));
}));

// ---------- smart insights ----------
// Uses the last 30 days of "out" movements to estimate daily usage, days of stock left,
// and how much to reorder (enough for 30 days of usage).
app.get('/api/insights', requireAuth(), h(async (_req, res) => {
  const WINDOW = 30, COVER = 30, WARN_DAYS = 7;
  const since = new Date(Date.now() - WINDOW * 86400000);
  const [products, usage] = await Promise.all([
    Product.find().lean(),
    Movement.aggregate([
      { $match: { type: 'out', date: { $gte: since } } },
      { $group: { _id: '$product', qty: { $sum: '$qty' } } },
    ]),
  ]);
  const used = Object.fromEntries(usage.map((u) => [String(u._id), u.qty]));

  const reorder = [];
  let units = 0, value = 0, low = 0, out = 0;
  for (const p of products) {
    units += p.quantity;
    value += p.quantity * p.price;
    if (p.quantity === 0) out++;
    const avgDaily = (used[String(p._id)] || 0) / WINDOW;
    const daysLeft = avgDaily > 0 ? p.quantity / avgDaily : null;
    const isLow = p.quantity <= p.reorderLevel;
    if (isLow) low++;
    if (isLow || (daysLeft !== null && daysLeft <= WARN_DAYS)) {
      reorder.push({
        _id: p._id, sku: p.sku, name: p.name, quantity: p.quantity, reorderLevel: p.reorderLevel,
        avgDaily: Math.round(avgDaily * 10) / 10,
        daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
        suggested: Math.max(Math.ceil(avgDaily * COVER) - p.quantity, p.reorderLevel * 2 - p.quantity, 0),
        reason: isLow ? 'At or below reorder level' : `About ${Math.ceil(daysLeft)} days of stock left`,
      });
    }
  }
  reorder.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || a.quantity - b.quantity);
  res.json({ stats: { products: products.length, units, value, low, out }, reorder });
}));

// ---------- CSV report ----------
app.get('/api/report.csv', requireAuth(), h(async (_req, res) => {
  const rows = await Product.find().sort('sku');
  const csv = ['SKU,Name,Category,Quantity,Reorder level,Price,Stock value']
    .concat(rows.map((p) => [p.sku, `"${p.name.replace(/"/g, '""')}"`, `"${(p.category || '').replace(/"/g, '""')}"`, p.quantity, p.reorderLevel, p.price, p.quantity * p.price].join(',')))
    .join('\n');
  res.header('Content-Type', 'text/csv').attachment('inventory-report.csv').send(csv);
}));

// ---------- start (retry until MongoDB is up) ----------
async function start() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/inventory';
  for (let i = 0; i < 20; i++) {
    try { await mongoose.connect(uri); break; }
    catch { console.log('Waiting for MongoDB...'); await new Promise((r) => setTimeout(r, 3000)); }
  }
  app.listen(process.env.PORT || 5000, () => console.log('API running'));
}
start();
