/**
 * Knowledge Base Seed Script
 *
 * Seeds Firestore with articles for all 6 knowledge base categories.
 * Uses additive-only writes (addDoc pattern) — does not delete existing documents.
 *
 * Usage: node backend/scripts/seedKnowledgeBase.js
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin (if not already initialized)
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
