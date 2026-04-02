/**
 * Usage Notification Service
 * 
 * Handles usage limit notifications and warning system
 * Provides intelligent pricing recommendations and subscription limit warnings
 */

const admin = require('firebase-admin');
const { UsageTracker } = require('./UsageTracker');
const { USAGE_CONFIG } = require('../config/monetization');

const db = admin.firestore();

/**
 * Notification Types
 */
const NOTIFICATION_TYPES = {
    WARNING: 'warning',
    INFO: 'info',
    CRITICAL: 'critical',
    SUCCESS: 'success'
};

/**
 * Notification Categories
 */
const NOTIFICATION_CATEGORIES = {
    CREDITS: 'credits',
    SUBSCRIPTION: 'subscription',
    OPTIMIZATION: 'optimization',
    UPGRADE: 'upgrade',
    BILLING: 'billing'
};

/**
 * Notification Priority Levels
 */
const PRIORITY_LEVELS = {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
};

/**
 * Usage Notification Interface
 */
class UsageNotification {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.userId = data.userId;
        this.type = data.type || NOTIFICATION_TYPES.INFO;
        this.category = data.category;
        this.priority = data.priority || PRIORITY_LEVELS.LOW;
        this.title = data.title;
        this.message = data.message;
        this.action = data.action || null;
        this.actionData = data.actionData || {};
        this.metadata = data.metadata || {};
        this.read = data.read || false;
        this.dismissed = data.dismissed || false;
        this.createdAt = data.createdAt || admin.firestore.Timestamp.now();
        this.expiresAt = data.expiresAt || null;
    }

    generateId() {
        return `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    toFirestore() {
        return {
            userId: this.userId,
            type: this.type,
            category: this.category,
            priority: this.priority,
            title: this.title,
            message: this.message,
            action: this.action,
            actionData: this.actionData,
            metadata: this.metadata,
            read: this.read,
            dismissed: this.dismissed,
            createdAt: this.createdAt,
            expiresAt: this.expiresAt
        };
    }

    static fromFirestore(doc) {
        if (!doc.exists) {
            return null;
        }

        return new UsageNotification({
            id: doc.id,
            ...doc.data()
        });
    }
}
/**
 * Usage Notification Service Class
 */
class UsageNotificationService {
    static get collection() {
        return db.collection('usage_notifications');
    }

    /**
     * Check and generate usage limit notifications for a user
     */
    static async checkUsageLimits(userId) {
        try {
            const notifications = [];

            // Check credit balance warnings
            const creditNotifications = await this.checkCreditWarnings(userId);
            notifications.push(...creditNotifications);

            // Check subscription usage warnings
            const subscriptionNotifications = await this.checkSubscriptionWarnings(userId);
            notifications.push(...subscriptionNotifications);

            // Check free tier warnings
            const freeTierNotifications = await this.checkFreeTierWarnings(userId);
            notifications.push(...freeTierNotifications);

            // Check cost optimization opportunities
            const optimizationNotifications = await this.checkOptimizationOpportunities(userId);
            notifications.push(...optimizationNotifications);

            // Store new notifications
            for (const notification of notifications) {
                await this.createNotification(notification);
            }

            return notifications;
        } catch (error) {
            console.error('Error checking usage limits:', error);
            throw new Error('Failed to check usage limits');
        }
    }

    /**
     * Check credit balance warnings
     */
    static async checkCreditWarnings(userId) {
        try {
            const notifications = [];
            const creditBalance = await UsageTracker.getRemainingCredits(userId);

            if (creditBalance === null) {
                return notifications; // No credit system active
            }

            const warningThreshold = USAGE_CONFIG.warningThresholds.credits;

            // Critical: No credits remaining
            if (creditBalance === 0) {
                notifications.push(new UsageNotification({
                    userId,
                    type: NOTIFICATION_TYPES.CRITICAL,
                    category: NOTIFICATION_CATEGORIES.CREDITS,
                    priority: PRIORITY_LEVELS.HIGH,
                    title: 'Credits Depleted',
                    message: 'You have no credits remaining. Purchase credits to continue using AI analysis.',
                    action: 'purchase_credits',
                    actionData: {
                        recommendedPackage: 'standard_100',
                        urgency: 'immediate'
                    }
                }));
            }
            // Warning: Low credits
            else if (creditBalance <= warningThreshold) {
                notifications.push(new UsageNotification({
                    userId,
                    type: NOTIFICATION_TYPES.WARNING,
                    category: NOTIFICATION_CATEGORIES.CREDITS,
                    priority: PRIORITY_LEVELS.MEDIUM,
                    title: 'Low Credit Balance',
                    message: `You have ${creditBalance} credits remaining. Consider purchasing more credits soon.`,
                    action: 'purchase_credits',
                    actionData: {
                        currentBalance: creditBalance,
                        recommendedPackage: 'standard_100'
                    }
                }));
            }

            return notifications;
        } catch (error) {
            console.error('Error checking credit warnings:', error);
            return [];
        }
    }

    /**
     * Check subscription usage warnings
     */
    static async checkSubscriptionWarnings(userId) {
        try {
            const notifications = [];
            const subscriptionUsage = await UsageTracker.getSubscriptionUsage(userId);

            if (!subscriptionUsage || subscriptionUsage.limit === -1) {
                return notifications; // No subscription or unlimited
            }

            const warningThreshold = USAGE_CONFIG.warningThresholds.subscription;
            const usagePercentage = subscriptionUsage.usagePercentage;

            // Critical: Limit exceeded
            if (subscriptionUsage.remaining <= 0) {
                notifications.push(new UsageNotification({
                    userId,
                    type: NOTIFICATION_TYPES.CRITICAL,
                    category: NOTIFICATION_CATEGORIES.SUBSCRIPTION,
                    priority: PRIORITY_LEVELS.HIGH,
                    title: 'Subscription Limit Reached',
                    message: `You've used all ${subscriptionUsage.limit} analyses in your current plan. Upgrade to continue.`,
                    action: 'upgrade_subscription',
                    actionData: {
                        currentTier: subscriptionUsage.tierId,
                        usageCount: subscriptionUsage.used,
                        limit: subscriptionUsage.limit
                    }
                }));
            }
            // Warning: Approaching limit
            else if (usagePercentage >= warningThreshold) {
                const remainingDays = this.calculateDaysUntilReset(subscriptionUsage.resetDate);

                notifications.push(new UsageNotification({
                    userId,
                    type: NOTIFICATION_TYPES.WARNING,
                    category: NOTIFICATION_CATEGORIES.SUBSCRIPTION,
                    priority: usagePercentage >= 0.95 ? PRIORITY_LEVELS.HIGH : PRIORITY_LEVELS.MEDIUM,
                    title: 'Approaching Subscription Limit',
                    message: `You've used ${subscriptionUsage.used} of ${subscriptionUsage.limit} analyses (${Math.round(usagePercentage * 100)}%). ${subscriptionUsage.remaining} analyses remaining.`,
                    action: remainingDays > 7 ? 'upgrade_subscription' : 'monitor_usage',
                    actionData: {
                        currentTier: subscriptionUsage.tierId,
                        usagePercentage: Math.round(usagePercentage * 100),
                        remaining: subscriptionUsage.remaining,
                        resetDate: subscriptionUsage.resetDate,
                        daysUntilReset: remainingDays
                    }
                }));
            }

            return notifications;
        } catch (error) {
            console.error('Error checking subscription warnings:', error);
            return [];
        }
    }

    /**
     * Check free tier warnings
     */
    static async checkFreeTierWarnings(userId) {
        try {
            const notifications = [];
            const { FreemiumController } = require('./FreemiumController');
            const freeStatus = await FreemiumController.checkFreeLimit(userId);

            if (!freeStatus || freeStatus.remainingAnalyses === null) {
                return notifications; // Not a free tier user
            }

            // Critical: No free analyses remaining
            if (freeStatus.remainingAnalyses === 0) {
                notifications.push(new UsageNotification({
                    userId,
                    type: NOTIFICATION_TYPES.CRITICAL,
                    category: NOTIFICATION_CATEGORIES.UPGRADE,
                    priority: PRIORITY_LEVELS.HIGH,
                    title: 'Free Analyses Used Up',
                    message: 'You\'ve used all your free analyses this month. Upgrade to continue using AI analysis.',
                    action: 'upgrade_to_paid',
                    actionData: {
                        resetDate: freeStatus.resetDate,
                        upgradeOptions: await this.getUpgradeRecommendations(userId)
                    }
                }));
            }
            // Warning: Low free analyses
            else if (freeStatus.remainingAnalyses <= 2) {
                notifications.push(new UsageNotification({
                    userId,
                    type: NOTIFICATION_TYPES.WARNING,
                    category: NOTIFICATION_CATEGORIES.UPGRADE,
                    priority: PRIORITY_LEVELS.MEDIUM,
                    title: 'Few Free Analyses Remaining',
                    message: `You have ${freeStatus.remainingAnalyses} free analyses left this month. Consider upgrading for unlimited access.`,
                    action: 'consider_upgrade',
                    actionData: {
                        remaining: freeStatus.remainingAnalyses,
                        resetDate: freeStatus.resetDate
                    }
                }));
            }

            return notifications;
        } catch (error) {
            console.error('Error checking free tier warnings:', error);
            return [];
        }
    }
    /**
     * Check cost optimization opportunities
     */
    static async checkOptimizationOpportunities(userId) {
        try {
            const notifications = [];
            const recentStats = await UsageTracker.getUsageStats(userId, 'last_30_days');

            if (recentStats.totalAnalyses < 5) {
                return notifications; // Not enough usage to analyze
            }

            // Check for caching opportunities
            const cacheRate = recentStats.cachedResults / recentStats.totalAnalyses;
            if (cacheRate < 0.2 && recentStats.totalAnalyses > 10) {
                const potentialSavings = Math.round(recentStats.totalCost * 0.15);

                notifications.push(new UsageNotification({
                    userId,
                    type: NOTIFICATION_TYPES.INFO,
                    category: NOTIFICATION_CATEGORIES.OPTIMIZATION,
                    priority: PRIORITY_LEVELS.LOW,
                    title: 'Optimize Analysis Costs',
                    message: `You could save up to ${potentialSavings} credits by batching similar analyses. Only ${Math.round(cacheRate * 100)}% of your analyses benefit from caching.`,
                    action: 'learn_optimization',
                    actionData: {
                        currentCacheRate: Math.round(cacheRate * 100),
                        potentialSavings,
                        totalAnalyses: recentStats.totalAnalyses
                    }
                }));
            }

            // Check for subscription recommendations
            if (recentStats.totalAnalyses > 20) {
                const subscriptionUsage = await UsageTracker.getSubscriptionUsage(userId);
                if (!subscriptionUsage) {
                    const estimatedSavings = this.calculateSubscriptionSavings(recentStats.totalCost);

                    if (estimatedSavings > 0) {
                        notifications.push(new UsageNotification({
                            userId,
                            type: NOTIFICATION_TYPES.INFO,
                            category: NOTIFICATION_CATEGORIES.UPGRADE,
                            priority: PRIORITY_LEVELS.MEDIUM,
                            title: 'Subscription Could Save Money',
                            message: `Based on your usage of ${recentStats.totalAnalyses} analyses, a subscription could save you up to $${(estimatedSavings / 100).toFixed(2)} per month.`,
                            action: 'consider_subscription',
                            actionData: {
                                monthlyUsage: recentStats.totalAnalyses,
                                estimatedSavings,
                                recommendedTier: this.getRecommendedTier(recentStats.totalAnalyses)
                            }
                        }));
                    }
                }
            }

            return notifications;
        } catch (error) {
            console.error('Error checking optimization opportunities:', error);
            return [];
        }
    }

    /**
     * Create a new notification
     */
    static async createNotification(notification) {
        try {
            // Check if similar notification already exists (avoid spam)
            const existingNotification = await this.findSimilarNotification(
                notification.userId,
                notification.category,
                notification.action
            );

            if (existingNotification) {
                // Update existing notification instead of creating duplicate
                return await this.updateNotification(existingNotification.id, {
                    message: notification.message,
                    actionData: notification.actionData,
                    createdAt: admin.firestore.Timestamp.now()
                });
            }

            // Create new notification
            const docRef = await this.collection.add(notification.toFirestore());
            notification.id = docRef.id;

            return notification;
        } catch (error) {
            console.error('Error creating notification:', error);
            throw new Error('Failed to create notification');
        }
    }

    /**
     * Get notifications for a user
     */
    static async getUserNotifications(userId, options = {}) {
        try {
            const {
                limit = 20,
                includeRead = true,
                includeDismissed = false,
                category = null,
                priority = null
            } = options;

            let query = this.collection
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(limit);

            if (!includeRead) {
                query = query.where('read', '==', false);
            }

            if (!includeDismissed) {
                query = query.where('dismissed', '==', false);
            }

            if (category) {
                query = query.where('category', '==', category);
            }

            if (priority) {
                query = query.where('priority', '==', priority);
            }

            const snapshot = await query.get();
            const notifications = snapshot.docs.map(doc => UsageNotification.fromFirestore(doc));

            // Filter out expired notifications
            const now = admin.firestore.Timestamp.now();
            return notifications.filter(notification =>
                !notification.expiresAt || notification.expiresAt.seconds > now.seconds
            );
        } catch (error) {
            console.error('Error getting user notifications:', error);
            throw new Error('Failed to get user notifications');
        }
    }

    /**
     * Mark notification as read
     */
    static async markAsRead(notificationId, userId) {
        try {
            const docRef = this.collection.doc(notificationId);
            const doc = await docRef.get();

            if (!doc.exists || doc.data().userId !== userId) {
                return false; // Notification not found or access denied
            }

            await docRef.update({
                read: true,
                readAt: admin.firestore.Timestamp.now()
            });

            return true;
        } catch (error) {
            console.error('Error marking notification as read:', error);
            throw new Error('Failed to mark notification as read');
        }
    }

    /**
     * Dismiss notification
     */
    static async dismissNotification(notificationId, userId) {
        try {
            const docRef = this.collection.doc(notificationId);
            const doc = await docRef.get();

            if (!doc.exists || doc.data().userId !== userId) {
                return false; // Notification not found or access denied
            }

            await docRef.update({
                dismissed: true,
                dismissedAt: admin.firestore.Timestamp.now()
            });

            return true;
        } catch (error) {
            console.error('Error dismissing notification:', error);
            throw new Error('Failed to dismiss notification');
        }
    }
    /**
     * Get notification statistics for user
     */
    static async getNotificationStats(userId) {
        try {
            const snapshot = await this.collection
                .where('userId', '==', userId)
                .get();

            const notifications = snapshot.docs.map(doc => doc.data());

            const stats = {
                total: notifications.length,
                unread: notifications.filter(n => !n.read).length,
                byCategory: {},
                byPriority: {},
                byType: {}
            };

            notifications.forEach(notification => {
                // By category
                if (!stats.byCategory[notification.category]) {
                    stats.byCategory[notification.category] = 0;
                }
                stats.byCategory[notification.category]++;

                // By priority
                if (!stats.byPriority[notification.priority]) {
                    stats.byPriority[notification.priority] = 0;
                }
                stats.byPriority[notification.priority]++;

                // By type
                if (!stats.byType[notification.type]) {
                    stats.byType[notification.type] = 0;
                }
                stats.byType[notification.type]++;
            });

            return stats;
        } catch (error) {
            console.error('Error getting notification stats:', error);
            throw new Error('Failed to get notification statistics');
        }
    }

    /**
     * Clean up expired notifications
     */
    static async cleanupExpiredNotifications() {
        try {
            const now = admin.firestore.Timestamp.now();
            const expiredQuery = this.collection
                .where('expiresAt', '<=', now)
                .limit(100);

            const snapshot = await expiredQuery.get();

            if (snapshot.empty) {
                return 0;
            }

            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();
            return snapshot.docs.length;
        } catch (error) {
            console.error('Error cleaning up expired notifications:', error);
            throw new Error('Failed to cleanup expired notifications');
        }
    }

    // Helper Methods

    /**
     * Find similar notification to avoid duplicates
     */
    static async findSimilarNotification(userId, category, action) {
        try {
            const oneDayAgo = admin.firestore.Timestamp.fromDate(
                new Date(Date.now() - 24 * 60 * 60 * 1000)
            );

            const snapshot = await this.collection
                .where('userId', '==', userId)
                .where('category', '==', category)
                .where('action', '==', action)
                .where('createdAt', '>=', oneDayAgo)
                .where('dismissed', '==', false)
                .limit(1)
                .get();

            return snapshot.empty ? null : UsageNotification.fromFirestore(snapshot.docs[0]);
        } catch (error) {
            console.error('Error finding similar notification:', error);
            return null;
        }
    }

    /**
     * Update existing notification
     */
    static async updateNotification(notificationId, updates) {
        try {
            const docRef = this.collection.doc(notificationId);
            await docRef.update(updates);

            const updatedDoc = await docRef.get();
            return UsageNotification.fromFirestore(updatedDoc);
        } catch (error) {
            console.error('Error updating notification:', error);
            throw new Error('Failed to update notification');
        }
    }

    /**
     * Calculate days until subscription reset
     */
    static calculateDaysUntilReset(resetDate) {
        if (!resetDate) return 0;

        const now = new Date();
        const reset = resetDate.toDate ? resetDate.toDate() : new Date(resetDate);
        const diffTime = reset.getTime() - now.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Calculate potential subscription savings
     */
    static calculateSubscriptionSavings(currentMonthlyCost) {
        const basicPlanCost = 999; // $9.99
        const professionalPlanCost = 1999; // $19.99

        if (currentMonthlyCost > professionalPlanCost) {
            return currentMonthlyCost - professionalPlanCost;
        } else if (currentMonthlyCost > basicPlanCost) {
            return currentMonthlyCost - basicPlanCost;
        }

        return 0;
    }

    /**
     * Get recommended subscription tier based on usage
     */
    static getRecommendedTier(monthlyAnalyses) {
        if (monthlyAnalyses <= 20) {
            return 'basic';
        } else if (monthlyAnalyses <= 50) {
            return 'professional';
        } else {
            return 'enterprise';
        }
    }

    /**
     * Get upgrade recommendations for free tier users
     */
    static async getUpgradeRecommendations(userId) {
        try {
            const recentStats = await UsageTracker.getUsageStats(userId, 'last_30_days');
            const recommendations = [];

            // Credit package recommendation
            recommendations.push({
                type: 'credit',
                title: 'Credit Package',
                description: 'Pay as you go with flexible credit packages',
                price: 500, // $5.00 for basic package
                analyses: 50,
                bestFor: 'Occasional users'
            });

            // Subscription recommendation based on usage
            if (recentStats.totalAnalyses > 10) {
                recommendations.push({
                    type: 'subscription',
                    title: 'Basic Plan',
                    description: 'Monthly subscription with consistent access',
                    price: 999, // $9.99
                    analyses: 20,
                    bestFor: 'Regular users'
                });
            }

            return recommendations;
        } catch (error) {
            console.error('Error getting upgrade recommendations:', error);
            return [];
        }
    }
}

module.exports = {
    UsageNotificationService,
    UsageNotification,
    NOTIFICATION_TYPES,
    NOTIFICATION_CATEGORIES,
    PRIORITY_LEVELS
};