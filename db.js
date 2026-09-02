/**
 * Cloud Database Connector (MongoDB Atlas & Fallback Support)
 * Seamlessly connects to MongoDB when MONGODB_URI is provided in Vercel Environment Variables,
 * or falls back gracefully to in-memory/file storage if running without DB.
 */

const mongoose = require('mongoose');

let isConnected = false;

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return false;
  }

  if (isConnected) {
    return true;
  }

  try {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    };

    const db = await mongoose.connect(uri, opts);
    isConnected = db.connections[0].readyState === 1;
    console.log('[Database] Connected to MongoDB Atlas successfully');
    return true;
  } catch (err) {
    console.warn('[Database] MongoDB connection error:', err.message);
    isConnected = false;
    return false;
  }
}

// =========================================================================
// MONGOOSE SCHEMAS & MODELS
// =========================================================================

// 1. Ticket Schema
const TicketSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  title: String,
  branch: String,
  branchId: String,
  category: String,
  priority: String,
  status: String,
  assignee: String,
  reporter: String,
  phone: String,
  desc: String,
  photo: String,
  photos: [String],
  createdAt: { type: mongoose.Schema.Types.Mixed, default: Date.now },
  updatedAt: { type: mongoose.Schema.Types.Mixed, default: Date.now },
  timestamp: { type: Number, default: Date.now },
  comments: [{
    id: String,
    sender: String,
    role: String,
    isSelf: Boolean,
    avatar: String,
    text: String,
    photo: String,
    photos: [String],
    timestamp: Number
  }]
}, { collection: 'tickets', strict: false });

// 2. User Schema
const UserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true, unique: true },
  name: String,
  email: String,
  role: String,
  branch: String,
  phone: String,
  modules: [String],
  lastLogin: String,
  lastIp: String,
  status: String,
  password: { type: String, default: 'admin123' }
}, { collection: 'users' });

// 3. Branch Settings Schema
const BranchSettingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  code: String,
  name: String,
  city: String,
  ipTunnel: String,
  isp: String,
  bandwidth: String,
  routerHw: String,
  picName: String,
  picPhone: String,
  apiPort: Number,
  sslPort: Number,
  winboxPort: Number,
  webfigPort: Number,
  apiUser: String,
  apiPass: String,
  useSsl: Boolean,
  image: String
}, { collection: 'branches' });

const TicketModel = mongoose.models.Ticket || mongoose.model('Ticket', TicketSchema);
const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
const BranchSettingModel = mongoose.models.BranchSetting || mongoose.model('BranchSetting', BranchSettingSchema);

module.exports = {
  connectDb,
  TicketModel,
  UserModel,
  BranchSettingModel,
  getIsConnected: () => isConnected
};
