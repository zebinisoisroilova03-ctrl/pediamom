/**
 * Database Initialization Script for AI Monetization System
 * 
 * This script sets up the initial Firestore collections and configuration
 * for the monetization system.
 */

const admin = require('firebase-admin');
const { CREDIT_CONFIG, SUBSCRIPTION_CONFIG } = require('../config/monetization');

// Initialize Firebase Admin (if not already initialized)
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Initialize credit packages in Firestore
 */
async function initializeCreditPackages() {
    console.log('🔄 Initializing credit packages...');

    const batch = db.batch();

    for (const packageConfig of CREDIT_CONFIG.defaultPackages) {
        const packageRef = db.collection('credit_packages').doc(packageConfig.id);
        batch.set(packageRef, {
            ...packageConfig,
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    await batch.commit();
    console.log('✅ Credit packages initialized successfully');
}

/**
 * Initialize subscription tiers in Firestore
 */
async function initializeSubscriptionTiers() {
    console.log('🔄 Initializing subscription tiers...');

    const batch = db.batch();

    for (const tierConfig of SUBSCRIPTION_CONFIG.defaultTiers) {
        const tierRef = db.collection('subscription_tiers').doc(tierConfig.id);
        batch.set(tierRef, {
            ...tierConfig,
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    await batch.commit();
    console.log('✅ Subscription tiers initialized successfully');
}

/**
 * Create Firestore indexes (these should also be defined in firestore.indexes.json)
 */
async function createIndexes() {
    console.log('ℹ️  Firestore indexes should be created via firestore.indexes.json');
    console.log('   Run: firebase deploy --only firestore:indexes');
}

/**
 * Initialize system configuration
 */
async function initializeSystemConfig() {
    console.log('🔄 Initializing system configuration...');

    const configRef = db.collection('system_config').doc('monetization');
    await configRef.set({
        version: '1.0.0',
        initialized: true,
        initializedAt: admin.firestore.FieldValue.serverTimestamp(),
        features: {
            credits: true,
            subscriptions: true,
            freemium: true,
            analytics: true
        },
        settings: {
            defaultCurrency: 'usd',
            freeAnalysisLimit: 5,
            cacheExpiry: 24 * 60 * 60 * 1000 // 24 hours
        }
    });

    console.log('✅ System configuration initialized successfully');
}

/**
 * Main initialization function
 */
async function initializeDatabase() {
    try {
        console.log('🚀 Starting AI Monetization System database initialization...');

        await initializeCreditPackages();
        await initializeSubscriptionTiers();
        await initializeSystemConfig();
        await createIndexes();

        console.log('🎉 Database initialization completed successfully!');
        console.log('');
        console.log('Next steps:');
        console.log('1. Configure Stripe products and prices in Stripe Dashboard');
        console.log('2. Update credit packages and subscription tiers with Stripe price IDs');
        console.log('3. Deploy Firestore indexes: firebase deploy --only firestore:indexes');
        console.log('4. Set up environment variables in .env file');

    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
}

// Run initialization if this script is executed directly
if (require.main === module) {
    initializeDatabase()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = {
    initializeDatabase,
    initializeCreditPackages,
    initializeSubscriptionTiers,
    initializeSystemConfig
};