// Vercel Serverless Function Entrypoint
const app = require('../server');
const { connectDb } = require('../db');

module.exports = async (req, res) => {
  if (process.env.MONGODB_URI) {
    try {
      await connectDb();
    } catch (e) {
      console.warn('[Vercel Serverless] DB connection attempt:', e.message);
    }
  }
  return app(req, res);
};
