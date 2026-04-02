/**
 * Usage Record Data Model
 * 
 * Tracks AI analysis usage including cost, payment method,
 * and OpenAI token consumption
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Usage Record Schema
 */
const UsageRecordSchema = {
    id: 'string',           // Auto-generated document ID
    userId: 'string',       // Firebase Auth UID
    analysisId: 'string',   // Unique analysis identifier
    analysisType: 'string', // blood, urine, vitamin, growth, nutrition
    cost: 'number',         // Cost in credits or currency
    paymentMethod: 'string', // credits, subscription, pay_per_analysis
    cached: 'boolean',      // Whether result was cached
    openaiTokensUsed: 'number', // OpenAI tokens consumed
    timestamp: 'timestamp', // When analysis was performed
    metadata: 'object'      // Additional usage data
};

/**
 * Payment Methods
 */
const PAYMENT_METHODS = {
    CREDITS: 'credits',
    SUBSCRIPTION: 'subscription',
    PAY_PER_ANALYSIS: 'pay_per_analysis'
};

/**
 * Analysis Types
 */
const ANALYSIS_TYPES = {
    BLOOD: 'blood',
    URINE: 'urine',
    VITAMIN: 'vitamin',
    GROWTH: 'growth',
    NUTRITION: 'nutrition'
};

/**
 * UsageRecord Class
 */
class UsageRecord {
    constructor(data = {}) {
        this.id = data.id || null;
        this.userId = data.userId || null;
        this.analysisId = data.analysisId || null;
        this.analysisType = data.analysisType || null;
        this.cost = data.cost || 0;
        this.paymentMethod = data.paymentMethod || null;
        this.cached = data.cached || false;
        this.openaiTokensUsed = data.openaiTokensUsed || 0;
        this.timestamp = data.timestamp || admin.firestore.Timestamp.now();
        this.metadata = data.metadata || {};
    }

    /**
     * Validate usage record data
     */
    validate() {
        const errors = [];

        if (!this.userId || typeof this.userId !== 'string') {
            errors.push('userId is required and must be a string');
        }

        if (!this.analysisId || typeof this.analysisId !== 'string') {
            errors.push('analysisId is required and must be a string');
        }

        if (!this.analysisType || !Object.values(ANALYSIS_TYPES).includes(this.analysisType)) {
            errors.push('analysisType is required and must be a valid analysis type');
        }

        if (this.cost < 0) {
            errors.push('cost cannot be negative');
        }

        if (!this.paymentMethod || !Object.values(PAYMENT_METHODS).includes(this.paymentMethod)) {
            errors.push('paymentMethod is required and must be a valid payment method');
        }

        if (this.openaiTokensUsed < 0) {
            errors.push('openaiTokensUsed cannot be negative');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Convert to Firestore document format
     */
    toFirestore() {
        const validation = this.validate();
        if (!validation.isValid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        return {
            userId: this.userId,
            analysisId: this.analysisId,
            analysisType: this.analysisType,
            cost: this.cost,
            paymentMethod: this.paymentMethod,
            cached: this.cached,
            openaiTokensUsed: this.openaiTokensUsed,
            timestamp: this.timestamp,
            metadata: this.metadata
        };
    }

    /**
     * Create from Firestore document
     */
    static fromFirestore(doc) {
        if (!doc.exists) {
            return null;
        }

        const data = doc.data();
        return new UsageRecord({
            ...data,
            id: doc.id
        });
    }
}

/**
 * UsageRecord Service Functions
 */
class UsageRecordService {
    static get collection() {
        return db.collection('usage_records');
    }

    /**
     * Create a new usage record
     */
    static async create(usageData) {
        try {
            const usage = new UsageRecord(usageData);
            const docRef = await this.collection.add(usage.toFirestore());

            usage.id = docRef.id;
            return usage;
        } catch (error) {
            console.error('Error creating usage record:', error);
            throw new Error('Failed to create usage record');
        }
    }

    /**
     * Get usage records by user ID
     */
    static async getByUserId(userId, limit = 50, startAfter = null) {
        try {
            let query = this.collection
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(limit);

            if (startAfter) {
                query = query.startAfter(startAfter);
            }

            const snapshot = await query.get();
            return snapshot.docs.map(doc => UsageRecord.fromFirestore(doc));
        } catch (error) {
            console.error('Error getting usage records by user ID:', error);
            throw new Error('Failed to get usage records');
        }
    }

    /**
     * Get usage statistics for user
     */
    static async getStatsByUser(userId, startDate = null, endDate = null) {
        try {
            let query = this.collection.where('userId', '==', userId);

            if (startDate) {
                query = query.where('timestamp', '>=', startDate);
            }
            if (endDate) {
                query = query.where('timestamp', '<=', endDate);
            }

            const snapshot = await query.get();
            const records = snapshot.docs.map(doc => UsageRecord.fromFirestore(doc));

            const stats = {
                totalAnalyses: records.length,
                totalCost: 0,
                totalTokensUsed: 0,
                cachedResults: 0,
                byAnalysisType: {},
                byPaymentMethod: {},
                costBreakdown: {
                    credits: 0,
                    subscription: 0,
                    payPerAnalysis: 0
                }
            };

            records.forEach(record => {
                stats.totalCost += record.cost;
                stats.totalTokensUsed += record.openaiTokensUsed;

                if (record.cached) {
                    stats.cachedResults++;
                }

                // By analysis type
                if (!stats.byAnalysisType[record.analysisType]) {
                    stats.byAnalysisType[record.analysisType] = { count: 0, cost: 0, tokens: 0 };
                }
                stats.byAnalysisType[record.analysisType].count++;
                stats.byAnalysisType[record.analysisType].cost += record.cost;
                stats.byAnalysisType[record.analysisType].tokens += record.openaiTokensUsed;

                // By payment method
                if (!stats.byPaymentMethod[record.paymentMethod]) {
                    stats.byPaymentMethod[record.paymentMethod] = { count: 0, cost: 0 };
                }
                stats.byPaymentMethod[record.paymentMethod].count++;
                stats.byPaymentMethod[record.paymentMethod].cost += record.cost;

                // Cost breakdown
                if (record.paymentMethod === PAYMENT_METHODS.CREDITS) {
                    stats.costBreakdown.credits += record.cost;
                } else if (record.paymentMethod === PAYMENT_METHODS.SUBSCRIPTION) {
                    stats.costBreakdown.subscription += record.cost;
                } else if (record.paymentMethod === PAYMENT_METHODS.PAY_PER_ANALYSIS) {
                    stats.costBreakdown.payPerAnalysis += record.cost;
                }
            });

            return stats;
        } catch (error) {
            console.error('Error getting usage statistics:', error);
            throw new Error('Failed to get usage statistics');
        }
    }

    /**
     * Get monthly usage for user
     */
    static async getMonthlyUsage(userId, year, month) {
        try {
            const startDate = admin.firestore.Timestamp.fromDate(new Date(year, month - 1, 1));
            const endDate = admin.firestore.Timestamp.fromDate(new Date(year, month, 0, 23, 59, 59));

            return await this.getStatsByUser(userId, startDate, endDate);
        } catch (error) {
            console.error('Error getting monthly usage:', error);
            throw new Error('Failed to get monthly usage');
        }
    }

    /**
     * Get usage by analysis type and user
     */
    static async getByAnalysisTypeAndUser(userId, analysisType, limit = 50) {
        try {
            const snapshot = await this.collection
                .where('userId', '==', userId)
                .where('analysisType', '==', analysisType)
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();

            return snapshot.docs.map(doc => UsageRecord.fromFirestore(doc));
        } catch (error) {
            console.error('Error getting usage by analysis type:', error);
            throw new Error('Failed to get usage by analysis type');
        }
    }

    /**
     * Get recent usage for user
     */
    static async getRecentUsage(userId, days = 30) {
        try {
            const startDate = admin.firestore.Timestamp.fromDate(
                new Date(Date.now() - days * 24 * 60 * 60 * 1000)
            );

            return await this.getStatsByUser(userId, startDate);
        } catch (error) {
            console.error('Error getting recent usage:', error);
            throw new Error('Failed to get recent usage');
        }
    }
}

module.exports = {
    UsageRecord,
    UsageRecordService,
    UsageRecordSchema,
    PAYMENT_METHODS,
    ANALYSIS_TYPES
};