/**
 * Transaction Record Data Model
 * 
 * Manages all financial transactions including credit purchases,
 * subscription payments, and pay-per-analysis transactions
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Transaction Record Schema
 */
const TransactionRecordSchema = {
    id: 'string',                    // Auto-generated document ID
    userId: 'string',                // Firebase Auth UID
    type: 'string',                  // credit_purchase, subscription_payment, pay_per_analysis
    amount: 'number',                // Amount in cents
    currency: 'string',              // Currency code (usd, eur, gbp)
    stripePaymentIntentId: 'string', // Stripe payment intent ID
    status: 'string',                // pending, succeeded, failed, refunded
    metadata: 'object',              // Additional transaction data
    createdAt: 'timestamp',
    updatedAt: 'timestamp'
};

/**
 * Transaction Types
 */
const TRANSACTION_TYPES = {
    CREDIT_PURCHASE: 'credit_purchase',
    SUBSCRIPTION_PAYMENT: 'subscription_payment',
    PAY_PER_ANALYSIS: 'pay_per_analysis'
};

/**
 * Transaction Status
 */
const TRANSACTION_STATUS = {
    PENDING: 'pending',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    REFUNDED: 'refunded'
};

/**
 * TransactionRecord Class
 */
class TransactionRecord {
    constructor(data = {}) {
        this.id = data.id || null;
        this.userId = data.userId || null;
        this.type = data.type || null;
        this.amount = data.amount || 0;
        this.currency = data.currency || 'usd';
        this.stripePaymentIntentId = data.stripePaymentIntentId || null;
        this.status = data.status || TRANSACTION_STATUS.PENDING;
        this.metadata = data.metadata || {};
        this.createdAt = data.createdAt || admin.firestore.Timestamp.now();
        this.updatedAt = data.updatedAt || admin.firestore.Timestamp.now();
    }

    /**
     * Validate transaction record data
     */
    validate() {
        const errors = [];

        if (!this.userId || typeof this.userId !== 'string') {
            errors.push('userId is required and must be a string');
        }

        if (!this.type || !Object.values(TRANSACTION_TYPES).includes(this.type)) {
            errors.push('type is required and must be a valid transaction type');
        }

        if (this.amount < 0) {
            errors.push('amount cannot be negative');
        }

        if (!this.currency || typeof this.currency !== 'string') {
            errors.push('currency is required and must be a string');
        }

        if (!Object.values(TRANSACTION_STATUS).includes(this.status)) {
            errors.push('status must be a valid transaction status');
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
            type: this.type,
            amount: this.amount,
            currency: this.currency,
            stripePaymentIntentId: this.stripePaymentIntentId,
            status: this.status,
            metadata: this.metadata,
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
        return new TransactionRecord({
            ...data,
            id: doc.id
        });
    }
}

/**
 * TransactionRecord Service Functions
 */
class TransactionRecordService {
    static get collection() {
        return db.collection('transactions');
    }

    /**
     * Create a new transaction record
     */
    static async create(transactionData) {
        try {
            const transaction = new TransactionRecord(transactionData);
            const docRef = await this.collection.add(transaction.toFirestore());

            transaction.id = docRef.id;
            return transaction;
        } catch (error) {
            console.error('Error creating transaction record:', error);
            throw new Error('Failed to create transaction record');
        }
    }

    /**
     * Get transaction by ID
     */
    static async getById(transactionId) {
        try {
            const doc = await this.collection.doc(transactionId).get();
            return TransactionRecord.fromFirestore(doc);
        } catch (error) {
            console.error('Error getting transaction record:', error);
            throw new Error('Failed to get transaction record');
        }
    }

    /**
     * Update transaction status
     */
    static async updateStatus(transactionId, status, metadata = {}) {
        try {
            const docRef = this.collection.doc(transactionId);
            const updateData = {
                status,
                metadata: metadata,
                updatedAt: admin.firestore.Timestamp.now()
            };

            await docRef.update(updateData);
            return await this.getById(transactionId);
        } catch (error) {
            console.error('Error updating transaction status:', error);
            throw new Error('Failed to update transaction status');
        }
    }

    /**
     * Get transactions by user ID
     */
    static async getByUserId(userId, limit = 50, startAfter = null) {
        try {
            let query = this.collection
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(limit);

            if (startAfter) {
                query = query.startAfter(startAfter);
            }

            const snapshot = await query.get();
            return snapshot.docs.map(doc => TransactionRecord.fromFirestore(doc));
        } catch (error) {
            console.error('Error getting transactions by user ID:', error);
            throw new Error('Failed to get transactions');
        }
    }

    /**
     * Get transactions by type and user
     */
    static async getByTypeAndUser(userId, type, limit = 50) {
        try {
            const snapshot = await this.collection
                .where('userId', '==', userId)
                .where('type', '==', type)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();

            return snapshot.docs.map(doc => TransactionRecord.fromFirestore(doc));
        } catch (error) {
            console.error('Error getting transactions by type:', error);
            throw new Error('Failed to get transactions by type');
        }
    }

    /**
     * Get transaction by Stripe payment intent ID
     */
    static async getByStripePaymentIntentId(paymentIntentId) {
        try {
            const snapshot = await this.collection
                .where('stripePaymentIntentId', '==', paymentIntentId)
                .limit(1)
                .get();

            if (snapshot.empty) {
                return null;
            }

            return TransactionRecord.fromFirestore(snapshot.docs[0]);
        } catch (error) {
            console.error('Error getting transaction by Stripe payment intent ID:', error);
            throw new Error('Failed to get transaction by payment intent ID');
        }
    }

    /**
     * Get transaction statistics for user
     */
    static async getStatsByUser(userId, startDate = null, endDate = null) {
        try {
            let query = this.collection.where('userId', '==', userId);

            if (startDate) {
                query = query.where('createdAt', '>=', startDate);
            }
            if (endDate) {
                query = query.where('createdAt', '<=', endDate);
            }

            const snapshot = await query.get();
            const transactions = snapshot.docs.map(doc => TransactionRecord.fromFirestore(doc));

            const stats = {
                totalTransactions: transactions.length,
                totalAmount: 0,
                successfulTransactions: 0,
                failedTransactions: 0,
                byType: {},
                byCurrency: {}
            };

            transactions.forEach(transaction => {
                // Total amount (only successful transactions)
                if (transaction.status === TRANSACTION_STATUS.SUCCEEDED) {
                    stats.totalAmount += transaction.amount;
                    stats.successfulTransactions++;
                } else if (transaction.status === TRANSACTION_STATUS.FAILED) {
                    stats.failedTransactions++;
                }

                // By type
                if (!stats.byType[transaction.type]) {
                    stats.byType[transaction.type] = { count: 0, amount: 0 };
                }
                stats.byType[transaction.type].count++;
                if (transaction.status === TRANSACTION_STATUS.SUCCEEDED) {
                    stats.byType[transaction.type].amount += transaction.amount;
                }

                // By currency
                if (!stats.byCurrency[transaction.currency]) {
                    stats.byCurrency[transaction.currency] = { count: 0, amount: 0 };
                }
                stats.byCurrency[transaction.currency].count++;
                if (transaction.status === TRANSACTION_STATUS.SUCCEEDED) {
                    stats.byCurrency[transaction.currency].amount += transaction.amount;
                }
            });

            return stats;
        } catch (error) {
            console.error('Error getting transaction statistics:', error);
            throw new Error('Failed to get transaction statistics');
        }
    }
}

module.exports = {
    TransactionRecord,
    TransactionRecordService,
    TransactionRecordSchema,
    TRANSACTION_TYPES,
    TRANSACTION_STATUS
};