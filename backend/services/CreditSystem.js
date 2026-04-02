/**
 * Credit System Service
 * 
 * Manages credit-based payments for AI analyses including:
 * - Credit package management and pricing
 * - Secure payment processing via Stripe
 * - Credit balance tracking and validation
 * - Transaction history maintenance
 */

const PaymentGateway = require('./PaymentGateway');
const { UserPaymentProfileService } = require('../models/UserPaymentProfile');
const { TransactionRecordService, TRANSACTION_TYPES, TRANSACTION_STATUS } = require('../models/TransactionRecord');
const { CREDIT_CONFIG } = require('../config/monetization');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Credit Package Configuration Model
 */
class CreditPackage {
    constructor(data = {}) {
        this.id = data.id || null;
        this.name = data.name || '';
        this.credits = data.credits || 0;
        this.price = data.price || 0; // in cents
        this.stripePriceId = data.stripePriceId || null;
        this.popular = data.popular || false;
        this.bonusCredits = data.bonusCredits || 0;
        this.active = data.active !== undefined ? data.active : true;
        this.createdAt = data.createdAt || admin.firestore.Timestamp.now();
        this.updatedAt = data.updatedAt || admin.firestore.Timestamp.now();
    }

    /**
     * Get total credits including bonus
     */
    getTotalCredits() {
        return this.credits + this.bonusCredits;
    }

    /**
     * Convert to Firestore format
     */
    toFirestore() {
        return {
            id: this.id,
            name: this.name,
            credits: this.credits,
            price: this.price,
            stripePriceId: this.stripePriceId,
            popular: this.popular,
            bonusCredits: this.bonusCredits,
            active: this.active,
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
        return new CreditPackage({
            ...data,
            id: doc.id
        });
    }
}

/**
 * Credit System Service Class
 */
class CreditSystem {
    constructor() {
        this.paymentGateway = new PaymentGateway();
        this.packagesCollection = db.collection('credit_packages');
    }

    /**
     * Initialize credit packages from configuration
     */
    async initializePackages() {
        try {
            const batch = db.batch();

            for (const packageConfig of CREDIT_CONFIG.defaultPackages) {
                const packageRef = this.packagesCollection.doc(packageConfig.id);
                const packageDoc = await packageRef.get();

                if (!packageDoc.exists) {
                    const creditPackage = new CreditPackage({
                        ...packageConfig,
                        active: true
                    });
                    batch.set(packageRef, creditPackage.toFirestore());
                }
            }

            await batch.commit();
            console.log('Credit packages initialized successfully');
        } catch (error) {
            console.error('Error initializing credit packages:', error);
            throw new Error('Failed to initialize credit packages');
        }
    }

    /**
     * Get all available credit packages
     */
    async getCreditPackages() {
        try {
            const snapshot = await this.packagesCollection
                .where('active', '==', true)
                .orderBy('price', 'asc')
                .get();

            return snapshot.docs.map(doc => CreditPackage.fromFirestore(doc));
        } catch (error) {
            console.error('Error getting credit packages:', error);
            throw new Error('Failed to get credit packages');
        }
    }

    /**
     * Get credit package by ID
     */
    async getCreditPackage(packageId) {
        try {
            const doc = await this.packagesCollection.doc(packageId).get();
            return CreditPackage.fromFirestore(doc);
        } catch (error) {
            console.error('Error getting credit package:', error);
            throw new Error('Failed to get credit package');
        }
    }

    /**
     * Get user's current credit balance
     */
    async getCreditBalance(userId) {
        try {
            const profile = await UserPaymentProfileService.getByUserId(userId);
            return profile ? profile.creditBalance : 0;
        } catch (error) {
            console.error('Error getting credit balance:', error);
            throw new Error('Failed to get credit balance');
        }
    }

    /**
     * Purchase credits for a user
     */
    async purchaseCredits(userId, packageId, paymentMethodId = null) {
        try {
            // Get credit package
            const creditPackage = await this.getCreditPackage(packageId);
            if (!creditPackage) {
                throw new Error('Credit package not found');
            }

            // Get or create user payment profile
            const profile = await UserPaymentProfileService.getOrCreate(userId);

            // Create payment intent
            const paymentResult = await this.paymentGateway.createPaymentIntent(
                creditPackage.price,
                'usd',
                {
                    userId,
                    packageId,
                    credits: creditPackage.getTotalCredits(),
                    type: 'credit_purchase'
                }
            );

            if (!paymentResult.success) {
                throw new Error(paymentResult.error.message);
            }

            // Create transaction record
            const transaction = await TransactionRecordService.create({
                userId,
                type: TRANSACTION_TYPES.CREDIT_PURCHASE,
                amount: creditPackage.price,
                currency: 'usd',
                stripePaymentIntentId: paymentResult.paymentIntent.id,
                status: TRANSACTION_STATUS.PENDING,
                metadata: {
                    packageId,
                    creditsToAdd: creditPackage.getTotalCredits(),
                    packageName: creditPackage.name
                }
            });

            return {
                success: true,
                paymentIntent: paymentResult.paymentIntent,
                transaction: transaction,
                package: creditPackage
            };
        } catch (error) {
            console.error('Error purchasing credits:', error);
            return {
                success: false,
                error: {
                    code: 'credit_purchase_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Confirm credit purchase after successful payment
     */
    async confirmCreditPurchase(paymentIntentId) {
        try {
            // Get transaction by payment intent ID
            const transaction = await TransactionRecordService.getByStripePaymentIntentId(paymentIntentId);
            if (!transaction) {
                throw new Error('Transaction not found');
            }

            // Confirm payment with Stripe
            const paymentResult = await this.paymentGateway.confirmPayment(paymentIntentId);
            if (!paymentResult.success) {
                // Update transaction status to failed
                await TransactionRecordService.updateStatus(
                    transaction.id,
                    TRANSACTION_STATUS.FAILED,
                    { error: paymentResult.error }
                );
                throw new Error('Payment confirmation failed');
            }

            // Add credits to user balance
            const creditsToAdd = transaction.metadata.creditsToAdd;
            const newBalance = await UserPaymentProfileService.addCredits(
                transaction.userId,
                creditsToAdd
            );

            // Update transaction status to succeeded
            await TransactionRecordService.updateStatus(
                transaction.id,
                TRANSACTION_STATUS.SUCCEEDED,
                {
                    ...transaction.metadata,
                    creditsAdded: creditsToAdd,
                    newBalance: newBalance,
                    confirmedAt: admin.firestore.Timestamp.now()
                }
            );

            return {
                success: true,
                transactionId: transaction.id,
                creditsAdded: creditsToAdd,
                newBalance: newBalance,
                receipt: {
                    amount: transaction.amount,
                    currency: transaction.currency,
                    packageName: transaction.metadata.packageName
                }
            };
        } catch (error) {
            console.error('Error confirming credit purchase:', error);
            return {
                success: false,
                error: {
                    code: 'credit_confirmation_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Deduct credits for an analysis
     */
    async deductCredits(userId, analysisType, analysisId = null) {
        try {
            // Get cost for analysis type
            const cost = this.getAnalysisCost(analysisType);

            // Check if user has sufficient credits
            const currentBalance = await this.getCreditBalance(userId);
            if (currentBalance < cost) {
                return {
                    success: false,
                    error: {
                        code: 'insufficient_credits',
                        message: 'Insufficient credits for this analysis',
                        details: {
                            required: cost,
                            available: currentBalance,
                            shortfall: cost - currentBalance
                        }
                    }
                };
            }

            // Deduct credits atomically
            const newBalance = await UserPaymentProfileService.deductCredits(userId, cost);

            return {
                success: true,
                creditsDeducted: cost,
                newBalance: newBalance,
                analysisType: analysisType,
                analysisId: analysisId
            };
        } catch (error) {
            console.error('Error deducting credits:', error);
            return {
                success: false,
                error: {
                    code: 'credit_deduction_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Check if user has sufficient credits for analysis
     */
    async checkSufficientCredits(userId, analysisType) {
        try {
            const cost = this.getAnalysisCost(analysisType);
            const balance = await this.getCreditBalance(userId);

            return {
                sufficient: balance >= cost,
                required: cost,
                available: balance,
                shortfall: Math.max(0, cost - balance)
            };
        } catch (error) {
            console.error('Error checking sufficient credits:', error);
            throw new Error('Failed to check credit sufficiency');
        }
    }

    /**
     * Get cost for analysis type
     */
    getAnalysisCost(analysisType) {
        return CREDIT_CONFIG.analysisCosts[analysisType] || CREDIT_CONFIG.analysisCosts.default;
    }

    /**
     * Get credit transaction history for user
     */
    async getCreditTransactionHistory(userId, limit = 50) {
        try {
            return await TransactionRecordService.getByTypeAndUser(
                userId,
                TRANSACTION_TYPES.CREDIT_PURCHASE,
                limit
            );
        } catch (error) {
            console.error('Error getting credit transaction history:', error);
            throw new Error('Failed to get credit transaction history');
        }
    }

    /**
     * Get upgrade recommendations based on usage patterns
     */
    async getUpgradeRecommendations(userId) {
        try {
            const balance = await this.getCreditBalance(userId);
            const packages = await this.getCreditPackages();

            // If user has very low credits, recommend packages
            if (balance < 10) {
                return packages
                    .filter(pkg => pkg.active)
                    .map(pkg => ({
                        type: 'credit_package',
                        packageId: pkg.id,
                        title: pkg.name,
                        description: `${pkg.getTotalCredits()} credits for $${(pkg.price / 100).toFixed(2)}`,
                        credits: pkg.getTotalCredits(),
                        price: pkg.price,
                        popular: pkg.popular,
                        savings: pkg.bonusCredits > 0 ? `${pkg.bonusCredits} bonus credits` : null
                    }))
                    .sort((a, b) => a.price - b.price);
            }

            return [];
        } catch (error) {
            console.error('Error getting upgrade recommendations:', error);
            throw new Error('Failed to get upgrade recommendations');
        }
    }

    /**
     * Estimate cost for multiple analyses
     */
    estimateCost(analysisTypes) {
        if (!Array.isArray(analysisTypes)) {
            analysisTypes = [analysisTypes];
        }

        const totalCost = analysisTypes.reduce((sum, type) => {
            return sum + this.getAnalysisCost(type);
        }, 0);

        return {
            totalCost,
            breakdown: analysisTypes.map(type => ({
                type,
                cost: this.getAnalysisCost(type)
            }))
        };
    }

    /**
     * Refund credits (for failed analyses)
     */
    async refundCredits(userId, credits, reason = 'Analysis failed') {
        try {
            const newBalance = await UserPaymentProfileService.addCredits(userId, credits);

            return {
                success: true,
                creditsRefunded: credits,
                newBalance: newBalance,
                reason: reason
            };
        } catch (error) {
            console.error('Error refunding credits:', error);
            return {
                success: false,
                error: {
                    code: 'credit_refund_failed',
                    message: error.message
                }
            };
        }
    }
}

module.exports = CreditSystem;