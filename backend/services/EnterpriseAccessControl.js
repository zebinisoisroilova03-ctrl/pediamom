/**
 * Enterprise Access Control Service
 * 
 * Handles unlimited access for Enterprise tier subscriptions
 * Provides special handling and bypass logic for Enterprise users
 */

const admin = require('firebase-admin');
const db = admin.firestore();
const { UserPaymentProfileService } = require('../models/UserPaymentProfile');

class EnterpriseAccessControl {
    constructor() {
        this.enterpriseTierId = 'enterprise';
    }

    /**
     * Check if user has Enterprise tier subscription
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} True if user has Enterprise tier
     */
    async isEnterpriseUser(userId) {
        try {
            const profile = await UserPaymentProfileService.getByUserId(userId);

            if (!profile || !profile.subscription) {
                return false;
            }

            return profile.subscription.tierId === this.enterpriseTierId &&
                profile.subscription.status === 'active' &&
                profile.subscription.currentPeriodEnd.toDate() > new Date();
        } catch (error) {
            console.error('Error checking Enterprise user status:', error);
            return false;
        }
    }

    /**
     * Validate unlimited access for Enterprise users
     * @param {string} userId - User ID
     * @param {string} analysisType - Type of analysis requested
     * @returns {Promise<object>} Access validation result
     */
    async validateUnlimitedAccess(userId, analysisType = 'default') {
        try {
            const isEnterprise = await this.isEnterpriseUser(userId);

            if (!isEnterprise) {
                return {
                    hasUnlimitedAccess: false,
                    reason: 'not_enterprise_user',
                    message: 'User does not have Enterprise tier subscription'
                };
            }

            // Enterprise users have unlimited access to all analysis types
            return {
                hasUnlimitedAccess: true,
                reason: 'enterprise_unlimited',
                message: 'Enterprise tier provides unlimited access',
                analysisType,
                restrictions: null,
                limits: {
                    daily: -1,    // Unlimited
                    monthly: -1,  // Unlimited
                    total: -1     // Unlimited
                }
            };
        } catch (error) {
            console.error('Error validating unlimited access:', error);
            return {
                hasUnlimitedAccess: false,
                reason: 'validation_error',
                message: 'Failed to validate access permissions'
            };
        }
    }

    /**
     * Record Enterprise usage (for analytics, no limits applied)
     * @param {string} userId - User ID
     * @param {string} analysisType - Type of analysis
     * @param {object} metadata - Additional metadata
     * @returns {Promise<object>} Recording result
     */
    async recordEnterpriseUsage(userId, analysisType, metadata = {}) {
        try {
            const isEnterprise = await this.isEnterpriseUser(userId);

            if (!isEnterprise) {
                return {
                    success: false,
                    reason: 'not_enterprise_user'
                };
            }

            const profile = await UserPaymentProfileService.getByUserId(userId);

            // Create usage record for analytics (no limits enforced)
            const usageRecord = {
                userId,
                analysisType,
                subscriptionId: profile?.subscription?.id || null,
                tierId: profile?.subscription?.tierId || 'enterprise',
                accessType: 'enterprise_unlimited',
                timestamp: admin.firestore.Timestamp.now(),
                billingPeriodStart: profile?.subscription?.currentPeriodStart || null,
                billingPeriodEnd: profile?.subscription?.currentPeriodEnd || null,
                cost: 0, // No cost for Enterprise unlimited
                limitsBypassed: true,
                metadata: {
                    ...metadata,
                    enterpriseFeatures: [
                        'unlimited_analyses',
                        'priority_processing',
                        'advanced_insights'
                    ]
                }
            };

            const docRef = await db.collection('enterprise_usage').add(usageRecord);

            return {
                success: true,
                usageId: docRef.id,
                message: 'Enterprise usage recorded successfully'
            };
        } catch (error) {
            console.error('Error recording Enterprise usage:', error);
            return {
                success: false,
                reason: 'recording_error',
                message: error.message
            };
        }
    }

    /**
     * Get Enterprise usage analytics
     * @param {string} userId - User ID
     * @param {Date} startDate - Start date for analytics
     * @param {Date} endDate - End date for analytics
     * @returns {Promise<object>} Usage analytics
     */
    async getEnterpriseAnalytics(userId, startDate = null, endDate = null) {
        try {
            const isEnterprise = await this.isEnterpriseUser(userId);

            if (!isEnterprise) {
                return {
                    success: false,
                    reason: 'not_enterprise_user'
                };
            }

            // Default to current billing period if no dates provided
            if (!startDate || !endDate) {
                const profile = await UserPaymentProfileService.getByUserId(userId);
                startDate = profile.subscription.currentPeriodStart.toDate();
                endDate = profile.subscription.currentPeriodEnd.toDate();
            }

            let query = db.collection('enterprise_usage')
                .where('userId', '==', userId)
                .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(startDate))
                .where('timestamp', '<=', admin.firestore.Timestamp.fromDate(endDate))
                .orderBy('timestamp', 'desc');

            const usageSnapshot = await query.get();
            const usageRecords = usageSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp.toDate()
            }));

            // Calculate analytics
            const analytics = this._calculateEnterpriseAnalytics(usageRecords);

            return {
                success: true,
                period: {
                    startDate,
                    endDate
                },
                analytics,
                usageRecords: usageRecords.slice(0, 100) // Limit to recent 100 records
            };
        } catch (error) {
            console.error('Error getting Enterprise analytics:', error);
            return {
                success: false,
                reason: 'analytics_error',
                message: error.message
            };
        }
    }

    /**
     * Check Enterprise feature access
     * @param {string} userId - User ID
     * @param {string} featureName - Name of the feature to check
     * @returns {Promise<object>} Feature access result
     */
    async checkEnterpriseFeatureAccess(userId, featureName) {
        try {
            const isEnterprise = await this.isEnterpriseUser(userId);

            if (!isEnterprise) {
                return {
                    hasAccess: false,
                    reason: 'not_enterprise_user',
                    upgradeRequired: true
                };
            }

            // Define Enterprise features
            const enterpriseFeatures = [
                'unlimited_analyses',
                'priority_processing',
                'advanced_insights',
                'custom_reports',
                'api_access',
                'dedicated_support',
                'bulk_processing',
                'data_export',
                'white_label',
                'sla_guarantee'
            ];

            const hasAccess = enterpriseFeatures.includes(featureName);

            return {
                hasAccess,
                reason: hasAccess ? 'enterprise_feature_included' : 'feature_not_available',
                featureName,
                allEnterpriseFeatures: enterpriseFeatures
            };
        } catch (error) {
            console.error('Error checking Enterprise feature access:', error);
            return {
                hasAccess: false,
                reason: 'access_check_error',
                message: error.message
            };
        }
    }

    /**
     * Get Enterprise tier benefits and features
     * @returns {object} Enterprise tier information
     */
    getEnterpriseBenefits() {
        return {
            tierId: this.enterpriseTierId,
            tierName: 'Enterprise Plan',
            benefits: [
                {
                    category: 'Usage',
                    features: [
                        'Unlimited AI analyses per month',
                        'No daily or hourly rate limits',
                        'Priority processing queue'
                    ]
                },
                {
                    category: 'Analytics',
                    features: [
                        'Advanced health insights',
                        'Custom report generation',
                        'Historical data analysis',
                        'Trend identification'
                    ]
                },
                {
                    category: 'Support',
                    features: [
                        'Dedicated account manager',
                        '24/7 priority support',
                        'SLA guarantee (99.9% uptime)',
                        'Custom integration support'
                    ]
                },
                {
                    category: 'Integration',
                    features: [
                        'Full API access',
                        'Webhook notifications',
                        'Bulk data processing',
                        'White-label options'
                    ]
                },
                {
                    category: 'Compliance',
                    features: [
                        'HIPAA compliance',
                        'SOC 2 Type II certification',
                        'Custom data retention policies',
                        'Audit trail access'
                    ]
                }
            ],
            pricing: {
                monthlyPrice: 4999, // $49.99
                yearlyPrice: 49999, // $499.99 (2 months free)
                currency: 'usd'
            }
        };
    }

    /**
     * Calculate Enterprise usage analytics
     * @private
     * @param {Array} usageRecords - Usage records
     * @returns {object} Calculated analytics
     */
    _calculateEnterpriseAnalytics(usageRecords) {
        const analytics = {
            totalAnalyses: usageRecords.length,
            analysisTypes: {},
            dailyUsage: {},
            averagePerDay: 0,
            peakUsageDay: null,
            costSavings: 0 // Estimated savings vs pay-per-use
        };

        // Group by analysis type
        usageRecords.forEach(record => {
            const type = record.analysisType || 'unknown';
            analytics.analysisTypes[type] = (analytics.analysisTypes[type] || 0) + 1;

            // Group by day
            const day = record.timestamp.toISOString().split('T')[0];
            analytics.dailyUsage[day] = (analytics.dailyUsage[day] || 0) + 1;
        });

        // Calculate daily average
        const days = Object.keys(analytics.dailyUsage);
        if (days.length > 0) {
            analytics.averagePerDay = analytics.totalAnalyses / days.length;

            // Find peak usage day
            let maxUsage = 0;
            days.forEach(day => {
                if (analytics.dailyUsage[day] > maxUsage) {
                    maxUsage = analytics.dailyUsage[day];
                    analytics.peakUsageDay = {
                        date: day,
                        count: maxUsage
                    };
                }
            });
        }

        // Estimate cost savings (assuming $5 per analysis for pay-per-use)
        analytics.costSavings = Math.max(0, (analytics.totalAnalyses * 5) - 49.99);

        return analytics;
    }
}

module.exports = EnterpriseAccessControl;