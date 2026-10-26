const mongoose = require('mongoose');
const { Schema } = mongoose;

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'staff'], default: 'staff' },
}));

const Product = mongoose.model('Product', new Schema({
  sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, trim: true },
  quantity: { type: Number, default: 0, min: 0 },
  reorderLevel: { type: Number, default: 10, min: 0 },
  price: { type: Number, default: 0, min: 0 },
}));

const Movement = mongoose.model('Movement', new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  type: { type: String, enum: ['in', 'out'], required: true },
  qty: { type: Number, required: true, min: 1 },
  note: String,
  by: { type: Schema.Types.ObjectId, ref: 'User' },
  date: { type: Date, default: Date.now, index: true },
}));

module.exports = { User, Product, Movement };
