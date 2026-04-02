/**
 * Usage Tracker Service
 * 
 * Comprehensive usage monitoring for AI analysis consumption
 * Provides real-time tracking, statistics, cost estimation, and notifications
 */

const admin = require('firebase-admin');
const { UsageRecord, UsageRecordService, PAYMENT_METHODS, ANALYSIS_TYPES } = require('../models/UsageRecord');
const { USAGE_CONFIG, CREDIT_CONFIG, OPENAI_CONFIG } = require('../config/monetization');

const db = admin.firestore();

/**
 * Usage Statistics Interface
 */
class UsageStats {
    constructor(data = {}) {
        this.totalAnalyses = data.totalAnalyses || 0;
        this.totalCost = data.totalCost || 0;
        this.totalTokensUsed = data.totalTokensUsed || 0;
        this.cachedResults = data.cachedResults || 0;
        this.analysisBreakdown = data.analysisBreakdown || {};
        this.paymentMethodBreakdown = data.paymentMethodBreakdown || {};
        this.costBreakdown = data.costBreakdown || {};
        this.remainingCredits = data.remainingCredits || null;
        this.subscriptionUsage = data.subscriptionUsage || null;
        this.period = data.period || null;
    }
}

/**
 * Usage Report Interface
 */
class UsageReport {
    constructor(data = {}) {
        this.userId = data.userId;
        this.startDate = data.startDate;
        this.endDate = data.endDate;
        this.generatedAt = data.generatedAt || new Date();
        this.stats = data.stats || new UsageStats();
        this.records = data.records || [];
        this.recommendations = data.recommendations || [];
        this.format = data.format || 'json';
    }
}

/**
 * Limit Check Result Interface
 */
class LimitCheckResult {
    constructor(data = {}) {
        this.allowed = data.allowed || false;
        this.reason = data.reason || null;
        this.suggestedAction = data.suggestedAction || null;
        this.remainingUsage = data.remainingUsage || null;
        this.resetDate = data.resetDate || null;
        this.upgradeOptions = data.upgradeOptions || [];
    }
}

/**
 * Cost Estimate Interface
 */
class CostEstimate {
    constructor(data = {}) {
        this.estimatedCost = data.estimatedCost || 0;
        this.currency = data.currency || 'credits';
        this.factors = data.factors || [];
        this.breakdown = data.breakdown || {};
        this.cached = data.cached || false;
    }
}

/**
 * Usage Tracker Service Class
 */
class UsageTracker {
    /**
     * Record usage for an AI analysis
     */
    static async recordUsage(userId, analysisType, cost, paymentMethod, metadata = {}) {
        try {
            const usageData = {
                userId,
                analysisId: metadata.analysisId || this.generateAnalysisId(),
                analysisType,
                cost,
                paymentMethod,
                cached: metadata.cached || false,
                openaiTokensUsed: metadata.openaiTokensUsed || 0,
                timestamp: admin.firestore.Timestamp.now(),
                metadata: {
                    subscriptionId: metadata.subscriptionId || null,
                    creditsDeducted: metadata.creditsDeducted || null,
                    transactionId: metadata.transactionId || null,
                    model: metadata.model || OPENAI_CONFIG.defaultModel,
                    promptTokens: metadata.promptTokens || 0,
                    completionTokens: metadata.completionTokens || 0
                }
            };

            const usageRecord = await UsageRecordService.create(usageData);

            // Update real-time usage cache
            await this.updateUsageCache(userId, usageRecord);

            return {
                success: true,
                usageId: usageRecord.id,
                timestamp: usageRecord.timestamp.toDate()
            };
        } catch (error) {
            console.error('Error recording usage:', error);
            throw new Error('Failed to record usage');
        }
    }

    /**
     * Get comprehensive usage statistics for a user
     */
    static async getUsageStats(userId, period = 'current_month') {
        try {
            const { startDate, endDate } = this.getPeriodDates(period);
            const baseStats = await UsageRecordService.getStatsByUser(userId, startDate, endDate);

            // Enhance with additional data
            const stats = new UsageStats({
                ...baseStats,
                period,
                remainingCredits: await this.getRemainingCredits(userId),
                subscriptionUsage: await this.getSubscriptionUsage(userId)
            });

            return stats;
        } catch (error) {
            console.error('Error getting usage stats:', error);
            throw new Error('Failed to get usage statistics');
        }
    }
    /**
     * Check usage limits for a user and analysis type
     */
    static async checkUsageLimit(userId, analysisType) {
        try {
            // Check subscription limits
            const subscriptionCheck = await this.checkSubscriptionLimit(userId);
            if (!subscriptionCheck.allowed) {
                return subscriptionCheck;
            }

            // Check credit balance
            const creditCheck = await this.checkCreditBalance(userId, analysisType);
            if (!creditCheck.allowed) {
                return creditCheck;
            }

            // Check free tier limits
            const freeCheck = await this.checkFreeTierLimit(userId);
            if (!freeCheck.allowed) {
                return freeCheck;
            }

            return new LimitCheckResult({
                allowed: true,
                reason: 'Usage within limits',
                remainingUsage: await this.getRemainingUsage(userId)
            });
        } catch (error) {
            console.error('Error checking usage limit:', error);
            throw new Error('Failed to check usage limit');
        }
    }

    /**
     * Generate comprehensive usage report
     */
    static async generateUsageReport(userId, startDate, endDate, format = 'json') {
        try {
            const start = admin.firestore.Timestamp.fromDate(startDate);
            const end = admin.firestore.Timestamp.fromDate(endDate);

            // Get usage statistics
            const stats = await UsageRecordService.getStatsByUser(userId, start, end);

            // Get detailed records
            const records = await this.getDetailedUsageRecords(userId, start, end);

            // Generate recommendations
            const recommendations = await this.generateUsageRecommendations(userId, stats);

            const report = new UsageReport({
                userId,
                startDate,
                endDate,
                stats: new UsageStats(stats),
                records,
                recommendations,
                format
            });

            return report;
        } catch (error) {
            console.error('Error generating usage report:', error);
            throw new Error('Failed to generate usage report');
        }
    }
    /**
     * Estimate cost for an analysis
     */
    static async estimateCost(analysisType, dataSize = 1, model = null) {
        try {
            const selectedModel = model || OPENAI_CONFIG.defaultModel;
            const baseCost = CREDIT_CONFIG.analysisCosts[analysisType] || CREDIT_CONFIG.analysisCosts.default;

            // Estimate tokens based on data size
            const estimatedTokens = this.estimateTokens(dataSize, analysisType);

            // Calculate OpenAI cost
            const tokenCost = (estimatedTokens / 1000) * OPENAI_CONFIG.tokenCostPerThousand[selectedModel];

            // Convert to credits (assuming 1 credit = $0.10)
            const creditCost = Math.ceil(tokenCost / 0.10);

            const factors = [
                { name: 'Base Analysis Cost', value: baseCost },
                { name: 'Data Size Multiplier', value: Math.max(1, Math.ceil(dataSize / 100)) },
                { name: 'Model Cost', value: creditCost }
            ];

            const totalCost = Math.max(baseCost, creditCost);

            return new CostEstimate({
                estimatedCost: totalCost,
                currency: 'credits',
                factors,
                breakdown: {
                    baseCost,
                    tokenCost: creditCost,
                    estimatedTokens,
                    model: selectedModel
                }
            });
        } catch (error) {
            console.error('Error estimating cost:', error);
            throw new Error('Failed to estimate cost');
        }
    }

    /**
     * Get usage notifications with intelligent recommendations
     */
    static async getUsageNotifications(userId) {
        try {
            const { UsageNotificationService } = require('./UsageNotificationService');

            // Check and generate new notifications
            await UsageNotificationService.checkUsageLimits(userId);

            // Get all active notifications for user
            const notifications = await UsageNotificationService.getUserNotifications(userId, {
                includeRead: false,
                includeDismissed: false,
                limit: 10
            });

            return notifications.map(notification => ({
                id: notification.id,
                type: notification.type,
                category: notification.category,
                priority: notification.priority,
                title: notification.title,
                message: notification.message,
                action: notification.action,
                actionData: notification.actionData,
                createdAt: notification.createdAt.toDate()
            }));
        } catch (error) {
            console.error('Error getting usage notifications:', error);
            throw new Error('Failed to get usage notifications');
        }
    }
    // Helper Methods

    /**
     * Generate unique analysis ID
     */
    static generateAnalysisId() {
        return `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get period dates based on period string
     */
    static getPeriodDates(period) {
        const now = new Date();
        let startDate, endDate;

        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
                break;
            case 'current_week':
                const weekStart = new Date(now);
                weekStart.setDate(now.getDate() - now.getDay());
                startDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
                endDate = now;
                break;
            case 'current_month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = now;
                break;
            case 'last_30_days':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                endDate = now;
                break;
            case 'last_90_days':
                startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                endDate = now;
                break;
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = now;
        }

        return {
            startDate: admin.firestore.Timestamp.fromDate(startDate),
            endDate: admin.firestore.Timestamp.fromDate(endDate)
        };
    }

    /**
     * Update real-time usage cache
     */
    static async updateUsageCache(userId, usageRecord) {
        try {
            const cacheRef = db.collection('usage_cache').doc(userId);

            await db.runTransaction(async (transaction) => {
                const cacheDoc = await transaction.get(cacheRef);

                let cacheData = {
                    userId,
                    lastAnalysis: usageRecord.timestamp,
                    todayCount: 0,
                    todayCost: 0,
                    monthCount: 0,
                    monthCost: 0,
                    updatedAt: admin.firestore.Timestamp.now()
                };

                if (cacheDoc.exists) {
                    cacheData = { ...cacheData, ...cacheDoc.data() };
                }

                // Update today's stats
                const today = new Date().toISOString().split('T')[0];
                const recordDay = usageRecord.timestamp.toDate().toISOString().split('T')[0];

                if (recordDay === today) {
                    cacheData.todayCount++;
                    cacheData.todayCost += usageRecord.cost;
                }

                transaction.set(cacheRef, cacheData);
            });
        } catch (error) {
            console.error('Error updating usage cache:', error);
        }
    }
    /**
     * Estimate tokens for analysis
     */
    static estimateTokens(dataSize, analysisType) {
        const baseTokens = {
            blood: 500,
            urine: 300,
            vitamin: 400,
            growth: 200,
            nutrition: 350,
            default: 400
        };

        const base = baseTokens[analysisType] || baseTokens.default;
        return Math.ceil(base * Math.max(1, dataSize / 100));
    }

    /**
     * Get remaining credits for user
     */
    static async getRemainingCredits(userId) {
        try {
            const { CreditSystem } = require('./CreditSystem');
            return await CreditSystem.getCreditBalance(userId);
        } catch (error) {
            console.error('Error getting remaining credits:', error);
            return null;
        }
    }

    /**
     * Get subscription usage information
     */
    static async getSubscriptionUsage(userId) {
        try {
            const { SubscriptionManager } = require('./SubscriptionManager');
            const status = await SubscriptionManager.getSubscriptionStatus(userId);

            if (!status.active) {
                return null;
            }

            // Get current month usage
            const currentMonth = new Date();
            const monthlyStats = await UsageRecordService.getMonthlyUsage(
                userId,
                currentMonth.getFullYear(),
                currentMonth.getMonth() + 1
            );

            const subscriptionUsage = monthlyStats.byPaymentMethod[PAYMENT_METHODS.SUBSCRIPTION] || { count: 0 };

            return {
                tierId: status.tierId,
                limit: status.analysisLimit,
                used: subscriptionUsage.count,
                remaining: status.analysisLimit === -1 ? -1 : Math.max(0, status.analysisLimit - subscriptionUsage.count),
                usagePercentage: status.analysisLimit === -1 ? 0 : subscriptionUsage.count / status.analysisLimit,
                resetDate: status.currentPeriodEnd
            };
        } catch (error) {
            console.error('Error getting subscription usage:', error);
            return null;
        }
    }
    /**
     * Check subscription limits
     */
    static async checkSubscriptionLimit(userId) {
        try {
            const subscriptionUsage = await this.getSubscriptionUsage(userId);

            if (!subscriptionUsage) {
                return new LimitCheckResult({ allowed: true });
            }

            if (subscriptionUsage.limit === -1) {
                return new LimitCheckResult({
                    allowed: true,
                    reason: 'Unlimited subscription access'
                });
            }

            if (subscriptionUsage.remaining <= 0) {
                return new LimitCheckResult({
                    allowed: false,
                    reason: 'Subscription analysis limit exceeded',
                    suggestedAction: 'upgrade_subscription',
                    resetDate: subscriptionUsage.resetDate
                });
            }

            return new LimitCheckResult({
                allowed: true,
                remainingUsage: subscriptionUsage.remaining
            });
        } catch (error) {
            console.error('Error checking subscription limit:', error);
            return new LimitCheckResult({
                allowed: false,
                reason: 'Error checking subscription status'
            });
        }
    }

    /**
     * Check credit balance
     */
    static async checkCreditBalance(userId, analysisType) {
        try {
            const creditBalance = await this.getRemainingCredits(userId);
            const requiredCredits = CREDIT_CONFIG.analysisCosts[analysisType] || CREDIT_CONFIG.analysisCosts.default;

            if (creditBalance === null || creditBalance < requiredCredits) {
                return new LimitCheckResult({
                    allowed: false,
                    reason: 'Insufficient credits',
                    suggestedAction: 'purchase_credits',
                    remainingUsage: creditBalance
                });
            }

            return new LimitCheckResult({
                allowed: true,
                remainingUsage: creditBalance
            });
        } catch (error) {
            console.error('Error checking credit balance:', error);
            return new LimitCheckResult({
                allowed: false,
                reason: 'Error checking credit balance'
            });
        }
    }
    /**
     * Check free tier limits
     */
    static async checkFreeTierLimit(userId) {
        try {
            const { FreemiumController } = require('./FreemiumController');
            const freeStatus = await FreemiumController.checkFreeLimit(userId);

            if (!freeStatus.eligible) {
                return new LimitCheckResult({
                    allowed: false,
                    reason: 'Free tier limit exceeded',
                    suggestedAction: 'upgrade_to_paid',
                    resetDate: freeStatus.resetDate
                });
            }

            return new LimitCheckResult({
                allowed: true,
                remainingUsage: freeStatus.remainingAnalyses
            });
        } catch (error) {
            console.error('Error checking free tier limit:', error);
            return new LimitCheckResult({
                allowed: true // Default to allowing if check fails
            });
        }
    }

    /**
     * Get remaining usage across all payment methods
     */
    static async getRemainingUsage(userId) {
        try {
            const credits = await this.getRemainingCredits(userId);
            const subscription = await this.getSubscriptionUsage(userId);
            const freeUsage = await this.checkFreeTierLimit(userId);

            return {
                credits: credits || 0,
                subscription: subscription ? subscription.remaining : 0,
                freeTier: freeUsage.remainingUsage || 0
            };
        } catch (error) {
            console.error('Error getting remaining usage:', error);
            return { credits: 0, subscription: 0, freeTier: 0 };
        }
    }

    /**
     * Get detailed usage records
     */
    static async getDetailedUsageRecords(userId, startDate, endDate) {
        try {
            let query = db.collection('usage_records')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc');

            if (startDate) {
                query = query.where('timestamp', '>=', startDate);
            }
            if (endDate) {
                query = query.where('timestamp', '<=', endDate);
            }

            const snapshot = await query.get();
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp
            }));
        } catch (error) {
            console.error('Error getting detailed usage records:', error);
            return [];
        }
    }
    /**
     * Generate usage recommendations
     */
    static async generateUsageRecommendations(userId, stats) {
        try {
            const recommendations = [];

            // Analyze usage patterns
            if (stats.totalAnalyses > 20) {
                const subscriptionUsage = await this.getSubscriptionUsage(userId);
                if (!subscriptionUsage) {
                    recommendations.push({
                        type: 'subscription',
                        priority: 'high',
                        title: 'Consider a subscription plan',
                        description: `You've used ${stats.totalAnalyses} analyses. A subscription could save you money.`
                    });
                }
            }

            // Check for cost optimization
            if (stats.cachedResults / stats.totalAnalyses < 0.1) {
                recommendations.push({
                    type: 'optimization',
                    priority: 'medium',
                    title: 'Optimize analysis costs',
                    description: 'Consider batching similar analyses to take advantage of caching.',
                    potentialSavings: Math.round(stats.totalCost * 0.2)
                });
            }

            return recommendations;
        } catch (error) {
            console.error('Error generating usage recommendations:', error);
            return [];
        }
    }
}

module.exports = {
    UsageTracker,
    UsageStats,
    UsageReport,
    LimitCheckResult,
    CostEstimate
};