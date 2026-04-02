/**
 * Free Usage Tracking Data Model
 * 
 * Tracks free tier usage limits and monthly resets
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Free Usage Record Schema
 */
const FreeUsageRecordSchema = {
    userId: 'string',           // Firebase Auth UID (document ID)
    month: 'string',            // YYYY-MM format
    analysisCount: 'number',    // Number of analyses used this month
    lastAnalysisDate: 'timestamp', // Last analysis timestamp
    resetDate: 'timestamp',     // When the counter will reset
    createdAt: 'timestamp',
    updatedAt: 'timestamp'
};

/**
 * FreeUsageRecord Class
 */
class FreeUsageRecord {
    constructor(data = {}) {
        this.userId = data.userId || null;
        this.month = data.month || this.getCurrentMonth();
        this.analysisCount = data.analysisCount || 0;
        this.lastAnalysisDate = data.lastAnalysisDate || null;
        this.resetDate = data.resetDate || this.getNextResetDate();
        this.createdAt = data.createdAt || admin.firestore.Timestamp.now();
        this.updatedAt = data.updatedAt || admin.firestore.Timestamp.now();
    }

    /**
     * Get current month in YYYY-MM format
     */
    getCurrentMonth() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * Get next reset date (first day of next month)
     */
    getNextResetDate() {
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return admin.firestore.Timestamp.fromDate(nextMonth);
    }

    /**
     * Validate free usage record data
     */
    validate() {
        const errors = [];

        if (!this.userId || typeof this.userId !== 'string') {
            errors.push('userId is required and must be a string');
        }

        if (!this.month || !/^\d{4}-\d{2}$/.test(this.month)) {
            errors.push('month is required and must be in YYYY-MM format');
        }

        if (this.analysisCount < 0) {
            errors.push('analysisCount cannot be negative');
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
            month: this.month,
            analysisCount: this.analysisCount,
            lastAnalysisDate: this.lastAnalysisDate,
            resetDate: this.resetDate,
            createdAt: this.createdAt,
            updatedAt: admin.firestore.Timestamp.now()
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
        return new FreeUsageRecord(data);
    }
}

/**
 * FreeUsageTracking Service Functions
 */
class FreeUsageTrackingService {
    static get collection() {
        return db.collection('free_usage_tracking');
    }

    /**
     * Get document ID for user and month
     */
    static getDocumentId(userId, month = null) {
        const currentMonth = month || new FreeUsageRecord().getCurrentMonth();
        return `${userId}_${currentMonth}`;
    }

    /**
     * Get or create free usage record for current month
     */
    static async getOrCreateCurrentMonth(userId) {
        try {
            const currentMonth = new FreeUsageRecord().getCurrentMonth();
            const docId = this.getDocumentId(userId, currentMonth);

            const doc = await this.collection.doc(docId).get();

            if (doc.exists) {
                return FreeUsageRecord.fromFirestore(doc);
            }

            // Create new record for current month
            const newRecord = new FreeUsageRecord({ userId, month: currentMonth });
            await this.collection.doc(docId).set(newRecord.toFirestore());

            return newRecord;
        } catch (error) {
            console.error('Error getting or creating free usage record:', error);
            throw new Error('Failed to get or create free usage record');
        }
    }

    /**
     * Check if user has remaining free analyses
     */
    static async checkFreeLimit(userId, monthlyLimit = 5) {
        try {
            const record = await this.getOrCreateCurrentMonth(userId);
            const remaining = Math.max(0, monthlyLimit - record.analysisCount);

            return {
                remainingAnalyses: remaining,
                resetDate: record.resetDate.toDate(),
                eligible: remaining > 0,
                currentUsage: record.analysisCount,
                monthlyLimit
            };
        } catch (error) {
            console.error('Error checking free limit:', error);
            throw new Error('Failed to check free limit');
        }
    }

    /**
     * Consume a free analysis (atomic operation)
     */
    static async consumeFreeAnalysis(userId) {
        try {
            const currentMonth = new FreeUsageRecord().getCurrentMonth();
            const docId = this.getDocumentId(userId, currentMonth);
            const docRef = this.collection.doc(docId);

            return await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);

                let record;
                if (doc.exists) {
                    record = FreeUsageRecord.fromFirestore(doc);
                } else {
                    record = new FreeUsageRecord({ userId, month: currentMonth });
                }

                // Increment analysis count
                record.analysisCount++;
                record.lastAnalysisDate = admin.firestore.Timestamp.now();
                record.updatedAt = admin.firestore.Timestamp.now();

                transaction.set(docRef, record.toFirestore());

                return {
                    success: true,
                    newCount: record.analysisCount,
                    lastAnalysisDate: record.lastAnalysisDate.toDate()
                };
            });
        } catch (error) {
            console.error('Error consuming free analysis:', error);
            throw new Error('Failed to consume free analysis');
        }
    }

    /**
     * Reset monthly limits for all users (scheduled function)
     */
    static async resetMonthlyLimits() {
        try {
            const currentMonth = new FreeUsageRecord().getCurrentMonth();
            const batch = db.batch();
            let processedCount = 0;

            // Get all records that need to be reset
            const snapshot = await this.collection
                .where('month', '<', currentMonth)
                .get();

            snapshot.docs.forEach(doc => {
                const data = doc.data();
                const userId = data.userId;
                const newDocId = this.getDocumentId(userId, currentMonth);

                // Create new record for current month
                const newRecord = new FreeUsageRecord({
                    userId,
                    month: currentMonth
                });

                batch.set(this.collection.doc(newDocId), newRecord.toFirestore());
                processedCount++;
            });

            if (processedCount > 0) {
                await batch.commit();
            }

            return {
                success: true,
                processedUsers: processedCount,
                resetMonth: currentMonth
            };
        } catch (error) {
            console.error('Error resetting monthly limits:', error);
            throw new Error('Failed to reset monthly limits');
        }
    }

    /**
     * Get usage history for user
     */
    static async getUserHistory(userId, months = 12) {
        try {
            const history = [];
            const now = new Date();

            for (let i = 0; i < months; i++) {
                const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const docId = this.getDocumentId(userId, month);

                const doc = await this.collection.doc(docId).get();

                if (doc.exists) {
                    const record = FreeUsageRecord.fromFirestore(doc);
                    history.push({
                        month,
                        analysisCount: record.analysisCount,
                        lastAnalysisDate: record.lastAnalysisDate?.toDate() || null
                    });
                } else {
                    history.push({
                        month,
                        analysisCount: 0,
                        lastAnalysisDate: null
                    });
                }
            }

            return history;
        } catch (error) {
            console.error('Error getting user history:', error);
            throw new Error('Failed to get user history');
        }
    }

    /**
     * Get upgrade recommendations based on usage patterns
     */
    static async getUpgradeRecommendations(userId, monthlyLimit = 5) {
        try {
            const history = await this.getUserHistory(userId, 3); // Last 3 months
            const currentRecord = await this.getOrCreateCurrentMonth(userId);

            const recommendations = [];

            // Check if user consistently hits the limit
            const monthsAtLimit = history.filter(h => h.analysisCount >= monthlyLimit).length;

            if (monthsAtLimit >= 2 || currentRecord.analysisCount >= monthlyLimit) {
                recommendations.push({
                    type: 'subscription',
                    title: 'Basic Plan',
                    description: 'Get 20 analyses per month with our Basic subscription',
                    price: 999, // $9.99 in cents
                    savings: 'Save up to 50% compared to pay-per-analysis'
                });
            }

            if (currentRecord.analysisCount >= monthlyLimit * 0.8) {
                recommendations.push({
                    type: 'credit',
                    title: 'Credit Package',
                    description: 'Purchase credits for flexible usage',
                    price: 500, // $5.00 for 50 credits
                    savings: 'No monthly commitment required'
                });
            }

            return recommendations;
        } catch (error) {
            console.error('Error getting upgrade recommendations:', error);
            throw new Error('Failed to get upgrade recommendations');
        }
    }
}

module.exports = {
    FreeUsageRecord,
    FreeUsageTrackingService,
    FreeUsageRecordSchema
};