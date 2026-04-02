/**
 * Subscription Manager Service
 * 
 * Handles subscription tiers, billing cycles, and tier-based access control
 * Integrates with Stripe for subscription management and PaymentGateway for processing
 */

const admin = require('firebase-admin');
const db = admin.firestore();
const PaymentGateway = require('./PaymentGateway');
const EnterpriseAccessControl = require('./EnterpriseAccessControl');
const { UserPaymentProfileService } = require('../models/UserPaymentProfile');
const { SUBSCRIPTION_CONFIG } = require('../config/monetization');

class SubscriptionManager {
    constructor() {
        this.paymentGateway = new PaymentGateway();
        this.enterpriseAccess = new EnterpriseAccessControl();
        this.config = SUBSCRIPTION_CONFIG;
    }

    /**
     * Get all available subscription tiers
     * @returns {Promise<Array>} List of subscription tiers
     */
    async getSubscriptionTiers() {
        try {
            const tiersSnapshot = await db.collection('subscription_tiers')
                .where('active', '==', true)
                .orderBy('monthlyPrice')
                .get();

            if (tiersSnapshot.empty) {
                // Return default tiers if none configured
                return this.config.defaultTiers;
            }

            return tiersSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error getting subscription tiers:', error);
            throw new Error('Failed to get subscription tiers');
        }
    }

    /**
     * Get subscription tier by ID
     * @param {string} tierId - Subscription tier ID
     * @returns {Promise<object|null>} Subscription tier or null if not found
     */
    async getSubscriptionTier(tierId) {
        try {
            const tierDoc = await db.collection('subscription_tiers').doc(tierId).get();

            if (!tierDoc.exists) {
                // Check default tiers
                const defaultTier = this.config.defaultTiers.find(tier => tier.id === tierId);
                return defaultTier || null;
            }

            return {
                id: tierDoc.id,
                ...tierDoc.data()
            };
        } catch (error) {
            console.error('Error getting subscription tier:', error);
            throw new Error('Failed to get subscription tier');
        }
    }

    /**
     * Create a new subscription for a user
     * @param {string} userId - User ID
     * @param {string} tierId - Subscription tier ID
     * @param {string} paymentMethodId - Stripe payment method ID
     * @returns {Promise<object>} Subscription creation result
     */
    async createSubscription(userId, tierId, paymentMethodId) {
        try {
            // Get subscription tier
            const tier = await this.getSubscriptionTier(tierId);
            if (!tier) {
                throw new Error('Invalid subscription tier');
            }

            // Get or create user payment profile
            const profile = await UserPaymentProfileService.getOrCreate(userId);

            // Check if user already has an active subscription
            if (profile.subscription && profile.subscription.status === 'active') {
                throw new Error('User already has an active subscription');
            }

            // Create Stripe customer if needed
            let stripeCustomerId = profile.stripeCustomerId;
            if (!stripeCustomerId) {
                const customerResult = await this.paymentGateway.createCustomer(userId, `user_${userId}@example.com`);
                if (!customerResult.success) {
                    throw new Error('Failed to create Stripe customer');
                }
                stripeCustomerId = customerResult.customer.id;

                // Update profile with Stripe customer ID
                await UserPaymentProfileService.update(userId, {
                    stripeCustomerId
                });
            }

            // Attach payment method to customer
            const attachResult = await this.paymentGateway.attachPaymentMethod(stripeCustomerId, paymentMethodId);
            if (!attachResult.success) {
                throw new Error('Failed to attach payment method');
            }

            // Create Stripe subscription
            const subscriptionResult = await this.paymentGateway.createSubscription(
                stripeCustomerId,
                tier.stripePriceId || `price_${tierId}`, // Use configured price ID or fallback
                {
                    userId,
                    tierId,
                    tierName: tier.name
                }
            );

            if (!subscriptionResult.success) {
                throw new Error('Failed to create Stripe subscription');
            }

            // Update user payment profile with subscription info
            const subscriptionData = {
                id: subscriptionResult.subscription.id,
                tierId,
                status: subscriptionResult.subscription.status,
                currentPeriodStart: admin.firestore.Timestamp.fromDate(subscriptionResult.subscription.currentPeriodStart),
                currentPeriodEnd: admin.firestore.Timestamp.fromDate(subscriptionResult.subscription.currentPeriodEnd),
                cancelAtPeriodEnd: false
            };

            await UserPaymentProfileService.updateSubscription(userId, subscriptionData);

            return {
                success: true,
                subscription: {
                    id: subscriptionResult.subscription.id,
                    tierId,
                    tierName: tier.name,
                    status: subscriptionResult.subscription.status,
                    clientSecret: subscriptionResult.subscription.clientSecret,
                    currentPeriodStart: subscriptionResult.subscription.currentPeriodStart,
                    currentPeriodEnd: subscriptionResult.subscription.currentPeriodEnd
                }
            };
        } catch (error) {
            console.error('Error creating subscription:', error);
            return {
                success: false,
                error: {
                    code: 'subscription_creation_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Cancel a user's subscription
     * @param {string} userId - User ID
     * @param {boolean} atPeriodEnd - Whether to cancel at period end (default: true)
     * @returns {Promise<object>} Cancellation result
     */
    async cancelSubscription(userId, atPeriodEnd = true) {
        try {
            const profile = await UserPaymentProfileService.getByUserId(userId);
            if (!profile || !profile.subscription) {
                throw new Error('No active subscription found');
            }

            // Cancel subscription in Stripe
            const cancelResult = await this.paymentGateway.cancelSubscription(
                profile.subscription.id,
                atPeriodEnd
            );

            if (!cancelResult.success) {
                throw new Error('Failed to cancel subscription in Stripe');
            }

            // Update subscription status in user profile
            const updatedSubscription = {
                ...profile.subscription,
                status: cancelResult.subscription.status,
                cancelAtPeriodEnd: cancelResult.subscription.cancelAtPeriodEnd,
                canceledAt: cancelResult.subscription.canceledAt ?
                    admin.firestore.Timestamp.fromDate(cancelResult.subscription.canceledAt) : null
            };

            await UserPaymentProfileService.updateSubscription(userId, updatedSubscription);

            return {
                success: true,
                subscription: {
                    id: profile.subscription.id,
                    status: cancelResult.subscription.status,
                    cancelAtPeriodEnd: cancelResult.subscription.cancelAtPeriodEnd,
                    canceledAt: cancelResult.subscription.canceledAt
                }
            };
        } catch (error) {
            console.error('Error canceling subscription:', error);
            return {
                success: false,
                error: {
                    code: 'subscription_cancellation_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Upgrade a user's subscription to a higher tier
     * @param {string} userId - User ID
     * @param {string} newTierId - New subscription tier ID
     * @returns {Promise<object>} Upgrade result
     */
    async upgradeSubscription(userId, newTierId) {
        try {
            const profile = await UserPaymentProfileService.getByUserId(userId);
            if (!profile || !profile.subscription || profile.subscription.status !== 'active') {
                throw new Error('No active subscription found');
            }

            const currentTier = await this.getSubscriptionTier(profile.subscription.tierId);
            const newTier = await this.getSubscriptionTier(newTierId);

            if (!newTier) {
                throw new Error('Invalid new subscription tier');
            }

            if (newTier.monthlyPrice <= currentTier.monthlyPrice) {
                throw new Error('Can only upgrade to higher tier');
            }

            // Update subscription in Stripe (this would involve modifying the subscription)
            // For now, we'll cancel the current subscription and create a new one
            const cancelResult = await this.cancelSubscription(userId, false);
            if (!cancelResult.success) {
                throw new Error('Failed to cancel current subscription');
            }

            // Create new subscription with higher tier
            // Note: In a real implementation, you'd want to handle this more gracefully
            // with prorated billing and immediate upgrade
            const createResult = await this.createSubscription(userId, newTierId, null);
            if (!createResult.success) {
                throw new Error('Failed to create new subscription');
            }

            return {
                success: true,
                subscription: createResult.subscription,
                message: 'Subscription upgraded successfully'
            };
        } catch (error) {
            console.error('Error upgrading subscription:', error);
            return {
                success: false,
                error: {
                    code: 'subscription_upgrade_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Get user's current subscription status
     * @param {string} userId - User ID
     * @returns {Promise<object>} Subscription status
     */
    async getSubscriptionStatus(userId) {
        try {
            const profile = await UserPaymentProfileService.getByUserId(userId);

            if (!profile || !profile.subscription) {
                return {
                    active: false,
                    tierId: null,
                    tierName: null,
                    currentPeriodEnd: null,
                    analysisUsed: 0,
                    analysisLimit: 0,
                    features: []
                };
            }

            const tier = await this.getSubscriptionTier(profile.subscription.tierId);
            const isActive = profile.subscription.status === 'active' &&
                profile.subscription.currentPeriodEnd.toDate() > new Date();

            // Get current period usage
            const usageCount = await this._getCurrentPeriodUsage(userId, profile.subscription);

            return {
                active: isActive,
                tierId: profile.subscription.tierId,
                tierName: tier ? tier.name : 'Unknown',
                status: profile.subscription.status,
                currentPeriodStart: profile.subscription.currentPeriodStart.toDate(),
                currentPeriodEnd: profile.subscription.currentPeriodEnd.toDate(),
                analysisUsed: usageCount,
                analysisLimit: tier ? tier.analysisLimit : 0,
                features: tier ? tier.features : [],
                cancelAtPeriodEnd: profile.subscription.cancelAtPeriodEnd || false
            };
        } catch (error) {
            console.error('Error getting subscription status:', error);
            throw new Error('Failed to get subscription status');
        }
    }

    /**
     * Check if user has access to perform an analysis
     * @param {string} userId - User ID
     * @param {string} analysisType - Type of analysis
     * @returns {Promise<object>} Access check result
     */
    async checkAnalysisAccess(userId, analysisType = 'default') {
        try {
            // First check if user has Enterprise unlimited access
            const enterpriseAccess = await this.enterpriseAccess.validateUnlimitedAccess(userId, analysisType);
            if (enterpriseAccess.hasUnlimitedAccess) {
                return {
                    allowed: true,
                    reason: 'enterprise_unlimited',
                    remainingAnalyses: -1, // Unlimited
                    enterpriseFeatures: true,
                    accessType: 'enterprise'
                };
            }

            // Check regular subscription access
            const status = await this.getSubscriptionStatus(userId);

            if (!status.active) {
                return {
                    allowed: false,
                    reason: 'no_active_subscription',
                    suggestedAction: 'subscribe',
                    subscriptionTiers: await this.getSubscriptionTiers()
                };
            }

            // Double-check for Enterprise tier (redundant but safe)
            if (status.tierId === 'enterprise' || status.analysisLimit === -1) {
                return {
                    allowed: true,
                    reason: 'enterprise_unlimited',
                    remainingAnalyses: -1, // Unlimited
                    enterpriseFeatures: true,
                    accessType: 'enterprise'
                };
            }

            // Check if within limits for other tiers
            if (status.analysisUsed >= status.analysisLimit) {
                return {
                    allowed: false,
                    reason: 'subscription_limit_exceeded',
                    suggestedAction: 'upgrade',
                    currentUsage: status.analysisUsed,
                    limit: status.analysisLimit,
                    subscriptionTiers: await this.getSubscriptionTiers()
                };
            }

            return {
                allowed: true,
                reason: 'subscription_active',
                remainingAnalyses: status.analysisLimit - status.analysisUsed,
                currentUsage: status.analysisUsed,
                limit: status.analysisLimit,
                accessType: 'subscription'
            };
        } catch (error) {
            console.error('Error checking analysis access:', error);
            return {
                allowed: false,
                reason: 'system_error',
                suggestedAction: 'retry'
            };
        }
    }

    /**
     * Record subscription usage for an analysis
     * @param {string} userId - User ID
     * @param {string} analysisType - Type of analysis
     * @param {object} metadata - Additional metadata
     * @returns {Promise<boolean>} Success status
     */
    async recordSubscriptionUsage(userId, analysisType, metadata = {}) {
        try {
            // Check if Enterprise user - use Enterprise usage tracking
            const isEnterprise = await this.enterpriseAccess.isEnterpriseUser(userId);
            if (isEnterprise) {
                const result = await this.enterpriseAccess.recordEnterpriseUsage(userId, analysisType, metadata);
                return result.success;
            }

            // Regular subscription usage tracking
            const profile = await UserPaymentProfileService.getByUserId(userId);
            if (!profile || !profile.subscription) {
                return false;
            }

            // Create usage record
            const usageRecord = {
                userId,
                analysisType,
                subscriptionId: profile.subscription.id,
                tierId: profile.subscription.tierId,
                timestamp: admin.firestore.Timestamp.now(),
                billingPeriodStart: profile.subscription.currentPeriodStart,
                billingPeriodEnd: profile.subscription.currentPeriodEnd,
                accessType: 'subscription',
                metadata
            };

            await db.collection('subscription_usage').add(usageRecord);
            return true;
        } catch (error) {
            console.error('Error recording subscription usage:', error);
            return false;
        }
    }

    /**
     * Process subscription renewal (called by webhook or scheduled job)
     * @param {string} subscriptionId - Stripe subscription ID
     * @returns {Promise<object>} Renewal result
     */
    async processRenewal(subscriptionId) {
        try {
            // Find user by subscription ID
            const profilesSnapshot = await db.collection('user_payment_profiles')
                .where('subscription.id', '==', subscriptionId)
                .limit(1)
                .get();

            if (profilesSnapshot.empty) {
                throw new Error('User not found for subscription');
            }

            const profileDoc = profilesSnapshot.docs[0];
            const userId = profileDoc.id;
            const profileData = profileDoc.data();

            // Update subscription period dates (these would come from Stripe webhook)
            const now = new Date();
            const nextPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

            const updatedSubscription = {
                ...profileData.subscription,
                currentPeriodStart: admin.firestore.Timestamp.fromDate(now),
                currentPeriodEnd: admin.firestore.Timestamp.fromDate(nextPeriodEnd),
                status: 'active'
            };

            await UserPaymentProfileService.updateSubscription(userId, updatedSubscription);

            return {
                success: true,
                userId,
                subscriptionId,
                newPeriodEnd: nextPeriodEnd
            };
        } catch (error) {
            console.error('Error processing subscription renewal:', error);
            return {
                success: false,
                error: {
                    code: 'renewal_processing_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Get current billing period usage for a user
     * @private
     * @param {string} userId - User ID
     * @param {object} subscription - Subscription object
     * @returns {Promise<number>} Usage count
     */
    async _getCurrentPeriodUsage(userId, subscription) {
        try {
            const usageSnapshot = await db.collection('subscription_usage')
                .where('userId', '==', userId)
                .where('subscriptionId', '==', subscription.id)
                .where('timestamp', '>=', subscription.currentPeriodStart)
                .where('timestamp', '<=', subscription.currentPeriodEnd)
                .get();

            return usageSnapshot.size;
        } catch (error) {
            console.error('Error getting current period usage:', error);
            return 0;
        }
    }

    /**
     * Initialize default subscription tiers in Firestore
     * @returns {Promise<void>}
     */
    async initializeDefaultTiers() {
        try {
            const batch = db.batch();

            for (const tier of this.config.defaultTiers) {
                const tierRef = db.collection('subscription_tiers').doc(tier.id);
                batch.set(tierRef, {
                    ...tier,
                    active: true,
                    createdAt: admin.firestore.Timestamp.now(),
                    updatedAt: admin.firestore.Timestamp.now()
                });
            }

            await batch.commit();
            console.log('Default subscription tiers initialized');
        } catch (error) {
            console.error('Error initializing default tiers:', error);
            throw new Error('Failed to initialize default subscription tiers');
        }
    }

    /**
     * Get Enterprise tier benefits and features
     * @returns {object} Enterprise tier information
     */
    getEnterpriseBenefits() {
        return this.enterpriseAccess.getEnterpriseBenefits();
    }

    /**
     * Check Enterprise feature access for a user
     * @param {string} userId - User ID
     * @param {string} featureName - Feature name to check
     * @returns {Promise<object>} Feature access result
     */
    async checkEnterpriseFeatureAccess(userId, featureName) {
        return await this.enterpriseAccess.checkEnterpriseFeatureAccess(userId, featureName);
    }

    /**
     * Get Enterprise usage analytics
     * @param {string} userId - User ID
     * @param {Date} startDate - Start date (optional)
     * @param {Date} endDate - End date (optional)
     * @returns {Promise<object>} Usage analytics
     */
    async getEnterpriseAnalytics(userId, startDate = null, endDate = null) {
        return await this.enterpriseAccess.getEnterpriseAnalytics(userId, startDate, endDate);
    }
}

module.exports = SubscriptionManager;