/**
 * PediaMom - Cloud Functions
 *
 * 1) child o‘chsa -> cascade delete:
 *    - medicine_list
 *    - medical_results
 *    - medicine_logs
 *
 * 2) account (Auth user) o‘chsa -> cascade delete (parentId == uid):
 *    - children
 *    - medicine_list
 *    - medical_results
 *    - medicine_logs
 */

const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// Load environment variables for monetization system
require('dotenv').config();

// Express and middleware for API routes
const express = require('express');
const cors = require('cors');

// Gen2 Firestore
const { setGlobalOptions } = require("firebase-functions");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");

// ✅ V1 Auth (stable) - aniq v1 import
const functions = require("firebase-functions/v1");

setGlobalOptions({ maxInstances: 10 });

/** Batch delete helper (safe) */
async function deleteQueryInBatches(queryRef, batchSize = 450) {
  let snap = await queryRef.limit(batchSize).get();

  while (!snap.empty) {
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    snap = await queryRef.limit(batchSize).get();
  }
}

/** Delete by parentId for a collection */
async function deleteByParentId(collectionName, parentId) {
  const q = db.collection(collectionName).where("parentId", "==", parentId);
  await deleteQueryInBatches(q);
}

/* =========================================================
   (A) CHILD DELETE (Gen2) -> cascade delete medicines + results + logs
========================================================= */
exports.cascadeDeleteOnChildDelete = onDocumentDeleted(
  {
    document: "children/{childId}",
    region: "europe-west1",
  },
  async (event) => {
    const childId = event.params.childId;

    const childData = event.data?.data?.() || null;
    const parentId = childData?.parentId || null;

    // 1) medicine_list
    let medsQ = db.collection("medicine_list").where("childId", "==", childId);
    if (parentId) medsQ = medsQ.where("parentId", "==", parentId);
    await deleteQueryInBatches(medsQ);

    // 2) medical_results
    let resultsQ = db.collection("medical_results").where("childId", "==", childId);
    if (parentId) resultsQ = resultsQ.where("parentId", "==", parentId);
    await deleteQueryInBatches(resultsQ);

    // 3) medicine_logs
    let logsQ = db.collection("medicine_logs").where("childId", "==", childId);
    if (parentId) logsQ = logsQ.where("parentId", "==", parentId);
    await deleteQueryInBatches(logsQ);
  }
);

/* =========================================================
   (B) ACCOUNT DELETE (V1 Auth) -> cascade delete everything for that uid
========================================================= */
exports.cascadeDeleteOnUserDelete = functions
  .region("europe-west1")
  .auth.user()
  .onDelete(async (user) => {
    const uid = user.uid;

    await deleteByParentId("medicine_logs", uid);
    await deleteByParentId("medicine_list", uid);
    await deleteByParentId("medical_results", uid);
    await deleteByParentId("children", uid);
  });

/* =========================================================
   (C) AI MONETIZATION SYSTEM API (V1 HTTP Functions)
========================================================= */

// Initialize Stripe configuration
const { validateStripeConfig } = require('./config/stripe');

// Validate Stripe configuration on startup
try {
  validateStripeConfig();
} catch (error) {
  console.error('❌ Stripe configuration error:', error.message);
  // In production, you might want to exit the process
  // process.exit(1);
}

// Import security middleware
const {
  securityHeaders,
  apiLimiter,
  sanitizeInput,
  limitRequestSize,
  securityLogger
} = require('./middleware/security');

// Create Express app for monetization API
const app = express();

// ── Security headers (helmet) ──────────────────────────────────────────────
app.use(securityHeaders);

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Request size guard ─────────────────────────────────────────────────────
app.use(limitRequestSize);

// ── Body parsing (raw body preserved for Stripe webhooks) ─────────────────
app.use(express.json({
  limit: '50kb',
  verify: (req, res, buf) => {
    if (req.originalUrl.includes('/webhooks/')) {
      req.rawBody = buf;
    }
  }
}));

// ── Input sanitization ─────────────────────────────────────────────────────
app.use(sanitizeInput);

// ── Global rate limiter ────────────────────────────────────────────────────
app.use('/api', apiLimiter);

// ── Security logger ────────────────────────────────────────────────────────
app.use(securityLogger);

// Import and use monetization routes
const monetizationRoutes = require('./routes/monetization');
const webhookRoutes = require('./routes/webhooks');
const { authenticateUser } = require('./middleware/auth');

// Apply authentication middleware to all routes except webhooks and health
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/webhooks/') || req.path === '/health') {
    return next();
  }
  return authenticateUser(req, res, next);
});

// Mount webhook routes (no authentication required — Stripe signature used instead)
app.use('/api/webhooks', webhookRoutes);

// Mount monetization routes (authentication required)
app.use('/api', monetizationRoutes);

// Health check endpoint (public, no auth)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'AI Monetization System API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((error, req, res, next) => {
  // CORS errors
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: { code: 'cors_error', message: 'Origin not allowed' }
    });
  }

  console.error('API Error:', error.message);

  res.status(500).json({
    success: false,
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred'
    }
  });
});

// Export the Express app as a Firebase Function
exports.monetizationApi = functions
  .region("europe-west1")
  .https.onRequest(app);

/* =========================================================
   (D) TELEGRAM NOTIFICATION SCHEDULED FUNCTIONS
========================================================= */
const { hourlyReminders, dailyReminders, articleNotifications } = require('./functions/notifications');
exports.hourlyReminders = hourlyReminders;
exports.dailyReminders = dailyReminders;
exports.articleNotifications = articleNotifications;