/**
 * Stripe Configuration for AI Monetization System
 * 
 * Initializes and configures Stripe SDK with environment variables
 */

const Stripe = require('stripe');

// Initialize Stripe with secret key from environment
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Stripe configuration constants
 */
const STRIPE_CONFIG = {
    // Webhook configuration
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

    // Default currency
    defaultCurrency: process.env.DEFAULT_CURRENCY || 'usd',

    // API version (Stripe recommends pinning to a specific version)
    apiVersion: '2023-10-16',

    // Timeout configuration
    timeout: 10000, // 10 seconds

    // Retry configuration
    maxNetworkRetries: 3
};

/**
 * Configure Stripe client with additional options
 */
stripe.setApiVersion(STRIPE_CONFIG.apiVersion);
stripe.setTimeout(STRIPE_CONFIG.timeout);
stripe.setMaxNetworkRetries(STRIPE_CONFIG.maxNetworkRetries);

/**
 * Validate Stripe configuration on startup
 */
const validateStripeConfig = () => {
    const requiredEnvVars = [
        'STRIPE_SECRET_KEY',
        'STRIPE_PUBLISHABLE_KEY',
        'STRIPE_WEBHOOK_SECRET'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        throw new Error(`Missing required Stripe environment variables: ${missingVars.join(', ')}`);
    }

    // Validate key format
    if (!process.env.STRIPE_SECRET_KEY.startsWith('sk_')) {
        throw new Error('Invalid Stripe secret key format');
    }

    if (!process.env.STRIPE_PUBLISHABLE_KEY.startsWith('pk_')) {
        throw new Error('Invalid Stripe publishable key format');
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
        throw new Error('Invalid Stripe webhook secret format');
    }

    console.log('✅ Stripe configuration validated successfully');
};

/**
 * Get Stripe publishable key for frontend
 */
const getPublishableKey = () => {
    return process.env.STRIPE_PUBLISHABLE_KEY;
};

/**
 * Verify webhook signature
 */
const verifyWebhookSignature = (payload, signature) => {
    try {
        return stripe.webhooks.constructEvent(
            payload,
            signature,
            STRIPE_CONFIG.webhookSecret
        );
    } catch (error) {
        throw new Error(`Webhook signature verification failed: ${error.message}`);
    }
};

module.exports = {
    stripe,
    STRIPE_CONFIG,
    validateStripeConfig,
    getPublishableKey,
    verifyWebhookSignature
};