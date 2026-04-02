/**
 * AI Monetization System Configuration
 * 
 * Central configuration for pricing, limits, and system settings
 */

/**
 * Credit System Configuration
 */
const CREDIT_CONFIG = {
    // Default credit packages (to be stored in Firestore)
    defaultPackages: [
        {
            id: 'basic_50',
            name: 'Basic Package',
            credits: 50,
            price: 500, // $5.00 in cents
            bonusCredits: 0,
            popular: false
        },
        {
            id: 'standard_100',
            name: 'Standard Package',
            credits: 100,
            price: 900, // $9.00 in cents (10% discount)
            bonusCredits: 10,
            popular: true
        },
        {
            id: 'premium_250',
            name: 'Premium Package',
            credits: 250,
            price: 2000, // $20.00 in cents (20% discount)
            bonusCredits: 50,
            popular: false
        },
        {
            id: 'enterprise_500',
            name: 'Enterprise Package',
            credits: 500,
            price: 3500, // $35.00 in cents (30% discount)
            bonusCredits: 150,
            popular: false
        }
    ],

    // Analysis type costs (in credits)
    analysisCosts: {
        blood: 5,
        urine: 3,
        vitamin: 4,
        growth: 2,
        nutrition: 3,
        default: 5
    }
};

/**
 * Subscription Tier Configuration
 */
const SUBSCRIPTION_CONFIG = {
    // Default subscription tiers (to be stored in Firestore)
    defaultTiers: [
        {
            id: 'basic',
            name: 'Basic Plan',
            monthlyPrice: 999, // $9.99 in cents
            analysisLimit: 20,
            features: [
                '20 AI analyses per month',
                'Basic health insights',
                'Email support'
            ],
            popular: false
        },
        {
            id: 'professional',
            name: 'Professional Plan',
            monthlyPrice: 1999, // $19.99 in cents
            analysisLimit: 50,
            features: [
                '50 AI analyses per month',
                'Advanced health insights',
                'Priority support',
                'Export reports'
            ],
            popular: true
        },
        {
            id: 'enterprise',
            name: 'Enterprise Plan',
            monthlyPrice: 4999, // $49.99 in cents
            analysisLimit: -1, // Unlimited
            features: [
                'Unlimited AI analyses',
                'Premium health insights',
                'Dedicated support',
                'Custom reports',
                'API access'
            ],
            popular: false
        }
    ]
};

/**
 * Freemium Configuration
 */
const FREEMIUM_CONFIG = {
    // Free tier limits
    monthlyAnalysisLimit: parseInt(process.env.FREE_ANALYSIS_LIMIT) || 5,

    // Reset schedule (monthly on the 1st)
    resetDay: 1,

    // Upgrade prompts
    upgradePrompts: {
        threshold: 0.8, // Show upgrade prompt when 80% of limit is reached
        cooldown: 24 * 60 * 60 * 1000 // 24 hours between prompts
    }
};

/**
 * Payment Configuration
 */
const PAYMENT_CONFIG = {
    // Supported currencies
    supportedCurrencies: ['usd', 'eur', 'gbp'],

    // Default currency
    defaultCurrency: process.env.DEFAULT_CURRENCY || 'usd',

    // Payment processing
    paymentTimeout: 30000, // 30 seconds

    // Retry configuration
    maxRetries: 3,
    retryDelay: 1000, // 1 second

    // Minimum amounts (in cents)
    minimumAmounts: {
        usd: 50,  // $0.50
        eur: 50,  // €0.50
        gbp: 50   // £0.50
    }
};

/**
 * Usage Tracking Configuration
 */
const USAGE_CONFIG = {
    // Analytics retention
    retentionPeriod: 365, // days

    // Batch processing
    batchSize: 100,

    // Notification thresholds
    warningThresholds: {
        credits: 10, // Warn when credits fall below 10
        subscription: 0.9 // Warn when 90% of subscription limit is reached
    },

    // Report generation
    reportFormats: ['json', 'csv'],
    maxReportPeriod: 365 // days
};

/**
 * Security Configuration
 */
const SECURITY_CONFIG = {
    // Rate limiting
    rateLimits: {
        payment: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 5 // 5 payment attempts per window
        },
        analysis: {
            windowMs: 60 * 1000, // 1 minute
            max: 10 // 10 analysis requests per minute
        }
    },

    // Audit logging
    auditEvents: [
        'payment_created',
        'payment_succeeded',
        'payment_failed',
        'subscription_created',
        'subscription_cancelled',
        'credits_purchased',
        'credits_deducted',
        'analysis_executed'
    ]
};

/**
 * OpenAI Integration Configuration
 */
const OPENAI_CONFIG = {
    // Cost tracking
    tokenCostPerThousand: {
        'gpt-3.5-turbo': 0.002, // $0.002 per 1K tokens
        'gpt-4': 0.03,          // $0.03 per 1K tokens
        'gpt-4-turbo': 0.01     // $0.01 per 1K tokens
    },

    // Model selection for cost optimization
    defaultModel: 'gpt-3.5-turbo',

    // Caching configuration
    cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
    maxCacheSize: 1000 // Maximum cached results
};

module.exports = {
    CREDIT_CONFIG,
    SUBSCRIPTION_CONFIG,
    FREEMIUM_CONFIG,
    PAYMENT_CONFIG,
    USAGE_CONFIG,
    SECURITY_CONFIG,
    OPENAI_CONFIG
};