/**
 * Hybrid Payment System Service
 * 
 * Implements subscription-first, credit-fallback payment logic
 * Provides transparent payment method indication and hybrid account management
 * Integrates with SubscriptionManager, CreditSystem, and UsageTracker
 */

const SubscriptionManager = require('./SubscriptionManager');
const CreditSystem = require('./CreditSystem');
const { UsageTracker } = require('./UsageTracker');
const { UserPaymentProfileService } = require('../models/UserPaymentProfile');
const { CREDIT_CONFIG } = require('../config/monetization');

/**
 * Payment Method Priority Types
 */
const PAYMENT_PRIORITY = {
    SUBSCRIPTION_FIRST: 'subscription_first',
    CREDITS_FIRST: 'credits_first',
    SUBSCRIPTION_ONLY: 'subscription_only',
    CREDITS_ONLY: 'credits_only'
};

/**
 * Payment Method Result Types
 */
const PAYMENT_METHOD_USED = {
    SUBSCRIPTION: 'subscription',
    CREDITS: 'credits',
    PAY_PER_ANALYSIS: 'pay_per_analysis',
    FREE_TIER: 'free_tier'
};

/**
 * Payment Decision Result Interface
 */
class PaymentDecision {
    constructor(data = {}) {
        this.allowed = data.allowed || false;
        this.paymentMethod = data.paymentMethod || null;
        this.cost = data.cost || 0;
        this.reason = data.reason || null;
        this.fallbackUsed = data.fallbackUsed || false;
        this.remainingBalance = data.remainingBalance || {};
        this.upgradeOptions = data.upgradeOptions || [];
        this.transparencyInfo = data.transparencyInfo || {};
    }
}

/**
 * Hybrid Account Status Interface
 */
class HybridAccountStatus {
    constructor(data = {}) {
        this.userId = data.userId;
        this.hasActiveSubscription = data.hasActiveSubscription || false;
        this.hasCredits = data.hasCredits || false;
        this.subscriptionStatus = data.subscriptionStatus || null;
        this.creditBalance = data.creditBalance || 0;
        this.paymentPriority = data.paymentPriority || PAYMENT_PRIORITY.SUBSCRIPTION_FIRST;
        this.availablePaymentMethods = data.availablePaymentMethods || [];
        this.recommendedAction = data.recommendedAction || null;
    }
}

/**
 * Hybrid Payment System Service Class
 */
class HybridPaymentSystem {
    constructor() {
        this.subscriptionManager = new SubscriptionManager();
        this.creditSystem = new CreditSystem();
    }

    /**
     * Determine payment method for an analysis request
     * Implements subscription-first, credit-fallback logic
     * @param {string} userId - User ID
     * @param {string} analysisType - Type of analysis
     * @param {string} preferredMethod - User's preferred payment method (optional)
     * @returns {Promise<PaymentDecision>} Payment decision result
     */
    async determinePaymentMethod(userId, analysisType, preferredMethod = null) {
        try {
            // Get hybrid account status
            const accountStatus = await this.getHybridAccountStatus(userId);

            // Get analysis cost
            const analysisCost = this.creditSystem.getAnalysisCost(analysisType);

            // If user has a preferred method and it's valid, try it first
            if (preferredMethod && this._isValidPreferredMethod(preferredMethod, accountStatus)) {
                const preferredResult = await this._tryPreferredMethod(
                    userId,
                    analysisType,
                    preferredMethod,
                    accountStatus,
                    analysisCost
                );
                if (preferredResult.allowed) {
                    return preferredResult;
                }
            }

            // Apply hybrid payment priority logic
            return await this._applyHybridPaymentLogic(userId, analysisType, accountStatus, analysisCost);

        } catch (error) {
            console.error('Error determining payment method:', error);
            return new PaymentDecision({
                allowed: false,
                reason: 'system_error',
                transparencyInfo: {
                    error: 'Unable to determine payment method',
                    suggestion: 'Please try again or contact support'
                }
            });
        }
    }

    /**
     * Execute payment using determined method
     * @param {string} userId - User ID
     * @param {string} analysisType - Type of analysis
     * @param {PaymentDecision} paymentDecision - Payment decision from determinePaymentMethod
     * @param {object} metadata - Additional metadata for the transaction
     * @returns {Promise<object>} Payment execution result
     */
    async executePayment(userId, analysisType, paymentDecision, metadata = {}) {
        try {
            if (!paymentDecision.allowed) {
                throw new Error('Payment not allowed');
            }

            let result;
            const analysisId = metadata.analysisId || this._generateAnalysisId();

            switch (paymentDecision.paymentMethod) {
                case PAYMENT_METHOD_USED.SUBSCRIPTION:
                    result = await this._executeSubscriptionPayment(
                        userId,
                        analysisType,
                        analysisId,
                        metadata
                    );
                    break;

                case PAYMENT_METHOD_USED.CREDITS:
                    result = await this._executeCreditPayment(
                        userId,
                        analysisType,
                        analysisId,
                        paymentDecision.cost,
                        metadata
                    );
                    break;

                case PAYMENT_METHOD_USED.FREE_TIER:
                    result = await this._executeFreeTierPayment(
                        userId,
                        analysisType,
                        analysisId,
                        metadata
                    );
                    break;

                default:
                    throw new Error(`Unsupported payment method: ${paymentDecision.paymentMethod}`);
            }

            // Record usage in UsageTracker
            await UsageTracker.recordUsage(
                userId,
                analysisType,
                paymentDecision.cost,
                paymentDecision.paymentMethod,
                {
                    ...metadata,
                    analysisId,
                    fallbackUsed: paymentDecision.fallbackUsed,
                    originalPaymentMethod: paymentDecision.transparencyInfo.originalMethod
                }
            );

            return {
                success: true,
                analysisId,
                paymentMethod: paymentDecision.paymentMethod,
                cost: paymentDecision.cost,
                fallbackUsed: paymentDecision.fallbackUsed,
                remainingBalance: await this._getUpdatedBalance(userId),
                transparencyInfo: paymentDecision.transparencyInfo,
                ...result
            };

        } catch (error) {
            console.error('Error executing payment:', error);
            return {
                success: false,
                error: {
                    code: 'payment_execution_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Get comprehensive hybrid account status
     * @param {string} userId - User ID
     * @returns {Promise<HybridAccountStatus>} Hybrid account status
     */
    async getHybridAccountStatus(userId) {
        try {
            // Get subscription status
            const subscriptionStatus = await this.subscriptionManager.getSubscriptionStatus(userId);

            // Get credit balance
            const creditBalance = await this.creditSystem.getCreditBalance(userId);

            // Get user payment profile for preferences
            const profile = await UserPaymentProfileService.getByUserId(userId);
            const paymentPriority = profile?.paymentPriority || PAYMENT_PRIORITY.SUBSCRIPTION_FIRST;

            // Determine available payment methods
            const availablePaymentMethods = this._getAvailablePaymentMethods(
                subscriptionStatus,
                creditBalance
            );

            // Generate recommendation
            const recommendedAction = this._getRecommendedAction(
                subscriptionStatus,
                creditBalance,
                availablePaymentMethods
            );

            return new HybridAccountStatus({
                userId,
                hasActiveSubscription: subscriptionStatus.active,
                hasCredits: creditBalance > 0,
                subscriptionStatus,
                creditBalance,
                paymentPriority,
                availablePaymentMethods,
                recommendedAction
            });

        } catch (error) {
            console.error('Error getting hybrid account status:', error);
            throw new Error('Failed to get hybrid account status');
        }
    }

    /**
     * Set user's payment priority preference
     * @param {string} userId - User ID
     * @param {string} priority - Payment priority preference
     * @returns {Promise<boolean>} Success status
     */
    async setPaymentPriority(userId, priority) {
        try {
            if (!Object.values(PAYMENT_PRIORITY).includes(priority)) {
                throw new Error('Invalid payment priority');
            }

            await UserPaymentProfileService.update(userId, {
                paymentPriority: priority,
                updatedAt: new Date()
            });

            return true;
        } catch (error) {
            console.error('Error setting payment priority:', error);
            return false;
        }
    }

    /**
     * Get transparent payment method information for UI display
     * @param {string} userId - User ID
     * @param {string} analysisType - Type of analysis
     * @returns {Promise<object>} Payment method transparency info
     */
    async getPaymentTransparencyInfo(userId, analysisType) {
        try {
            const accountStatus = await this.getHybridAccountStatus(userId);
            const paymentDecision = await this.determinePaymentMethod(userId, analysisType);

            return {
                currentBalance: {
                    credits: accountStatus.creditBalance,
                    subscription: accountStatus.subscriptionStatus.active ? {
                        remaining: accountStatus.subscriptionStatus.analysisLimit === -1 ?
                            'unlimited' :
                            Math.max(0, accountStatus.subscriptionStatus.analysisLimit - accountStatus.subscriptionStatus.analysisUsed),
                        resetDate: accountStatus.subscriptionStatus.currentPeriodEnd
                    } : null
                },
                willUseMethod: paymentDecision.paymentMethod,
                cost: paymentDecision.cost,
                fallbackAvailable: paymentDecision.fallbackUsed || this._hasFallbackOptions(accountStatus),
                upgradeOptions: paymentDecision.upgradeOptions,
                transparencyMessage: this._generateTransparencyMessage(paymentDecision, accountStatus)
            };
        } catch (error) {
            console.error('Error getting payment transparency info:', error);
            throw new Error('Failed to get payment transparency information');
        }
    }

    // Private Helper Methods

    /**
     * Apply hybrid payment priority logic
     * @private
     */
    async _applyHybridPaymentLogic(userId, analysisType, accountStatus, analysisCost) {
        // Priority 1: Active subscription with remaining usage
        if (accountStatus.hasActiveSubscription) {
            const subscriptionResult = await this._trySubscriptionPayment(
                userId,
                analysisType,
                accountStatus
            );

            if (subscriptionResult.allowed) {
                return subscriptionResult;
            }

            // Subscription limit exceeded, try credit fallback
            if (accountStatus.hasCredits && accountStatus.creditBalance >= analysisCost) {
                const creditResult = await this._tryCreditPayment(
                    userId,
                    analysisType,
                    accountStatus,
                    analysisCost
                );

                if (creditResult.allowed) {
                    creditResult.fallbackUsed = true;
                    creditResult.transparencyInfo.originalMethod = PAYMENT_METHOD_USED.SUBSCRIPTION;
                    creditResult.transparencyInfo.fallbackReason = 'Subscription limit exceeded';
                    return creditResult;
                }
            }
        }

        // Priority 2: Credits available
        if (accountStatus.hasCredits && accountStatus.creditBalance >= analysisCost) {
            return await this._tryCreditPayment(userId, analysisType, accountStatus, analysisCost);
        }

        // Priority 3: Free tier (if no paid options available)
        const freeTierResult = await this._tryFreeTierPayment(userId, analysisType);
        if (freeTierResult.allowed) {
            return freeTierResult;
        }

        // No payment method available
        return new PaymentDecision({
            allowed: false,
            reason: 'no_payment_method_available',
            upgradeOptions: await this._getUpgradeOptions(userId, analysisCost),
            transparencyInfo: {
                message: 'No available payment method for this analysis',
                suggestion: 'Please add credits or subscribe to continue'
            }
        });
    }

    /**
     * Try subscription payment
     * @private
     */
    async _trySubscriptionPayment(userId, analysisType, accountStatus) {
        const accessCheck = await this.subscriptionManager.checkAnalysisAccess(userId, analysisType);

        if (accessCheck.allowed) {
            return new PaymentDecision({
                allowed: true,
                paymentMethod: PAYMENT_METHOD_USED.SUBSCRIPTION,
                cost: 0, // Subscription analyses don't deduct credits
                reason: 'subscription_active',
                remainingBalance: {
                    subscription: accessCheck.remainingAnalyses,
                    credits: accountStatus.creditBalance
                },
                transparencyInfo: {
                    message: accessCheck.accessType === 'enterprise' ?
                        'Using Enterprise unlimited access' :
                        `Using subscription (${accessCheck.remainingAnalyses} analyses remaining)`,
                    method: 'subscription',
                    unlimited: accessCheck.remainingAnalyses === -1
                }
            });
        }

        return new PaymentDecision({
            allowed: false,
            reason: accessCheck.reason,
            transparencyInfo: {
                message: 'Subscription limit reached',
                suggestion: accessCheck.suggestedAction
            }
        });
    }

    /**
     * Try credit payment
     * @private
     */
    async _tryCreditPayment(userId, analysisType, accountStatus, analysisCost) {
        const sufficientCredits = await this.creditSystem.checkSufficientCredits(userId, analysisType);

        if (sufficientCredits.sufficient) {
            return new PaymentDecision({
                allowed: true,
                paymentMethod: PAYMENT_METHOD_USED.CREDITS,
                cost: analysisCost,
                reason: 'sufficient_credits',
                remainingBalance: {
                    credits: accountStatus.creditBalance - analysisCost,
                    subscription: accountStatus.hasActiveSubscription ?
                        accountStatus.subscriptionStatus.analysisLimit - accountStatus.subscriptionStatus.analysisUsed : 0
                },
                transparencyInfo: {
                    message: `Using ${analysisCost} credits (${accountStatus.creditBalance - analysisCost} remaining after)`,
                    method: 'credits',
                    costBreakdown: {
                        analysisType,
                        creditCost: analysisCost
                    }
                }
            });
        }

        return new PaymentDecision({
            allowed: false,
            reason: 'insufficient_credits',
            upgradeOptions: await this.creditSystem.getUpgradeRecommendations(userId),
            transparencyInfo: {
                message: `Insufficient credits (need ${analysisCost}, have ${accountStatus.creditBalance})`,
                suggestion: 'Purchase more credits to continue'
            }
        });
    }

    /**
     * Try free tier payment
     * @private
     */
    async _tryFreeTierPayment(userId, analysisType) {
        try {
            const { FreemiumController } = require('./FreemiumController');
            const freeStatus = await FreemiumController.checkFreeLimit(userId);

            if (freeStatus.eligible && freeStatus.remainingAnalyses > 0) {
                return new PaymentDecision({
                    allowed: true,
                    paymentMethod: PAYMENT_METHOD_USED.FREE_TIER,
                    cost: 0,
                    reason: 'free_tier_available',
                    remainingBalance: {
                        freeTier: freeStatus.remainingAnalyses - 1
                    },
                    transparencyInfo: {
                        message: `Using free tier (${freeStatus.remainingAnalyses - 1} free analyses remaining)`,
                        method: 'free_tier',
                        resetDate: freeStatus.resetDate
                    }
                });
            }

            return new PaymentDecision({
                allowed: false,
                reason: 'free_tier_exhausted',
                transparencyInfo: {
                    message: 'Free tier limit reached',
                    suggestion: 'Upgrade to continue using AI analysis'
                }
            });
        } catch (error) {
            console.error('Error checking free tier:', error);
            return new PaymentDecision({
                allowed: false,
                reason: 'free_tier_check_failed'
            });
        }
    }

    /**
     * Execute subscription payment
     * @private
     */
    async _executeSubscriptionPayment(userId, analysisType, analysisId, metadata) {
        const success = await this.subscriptionManager.recordSubscriptionUsage(
            userId,
            analysisType,
            { ...metadata, analysisId }
        );

        if (!success) {
            throw new Error('Failed to record subscription usage');
        }

        return {
            subscriptionUsageRecorded: true,
            analysisId
        };
    }

    /**
     * Execute credit payment
     * @private
     */
    async _executeCreditPayment(userId, analysisType, analysisId, cost, metadata) {
        const deductionResult = await this.creditSystem.deductCredits(
            userId,
            analysisType,
            analysisId
        );

        if (!deductionResult.success) {
            throw new Error(deductionResult.error.message);
        }

        return {
            creditsDeducted: deductionResult.creditsDeducted,
            newCreditBalance: deductionResult.newBalance,
            analysisId
        };
    }

    /**
     * Execute free tier payment
     * @private
     */
    async _executeFreeTierPayment(userId, analysisType, analysisId, metadata) {
        const { FreemiumController } = require('./FreemiumController');
        const consumptionResult = await FreemiumController.consumeFreeAnalysis(
            userId,
            analysisType
        );

        if (!consumptionResult.success) {
            throw new Error('Failed to consume free analysis');
        }

        return {
            freeAnalysisConsumed: true,
            remainingFreeAnalyses: consumptionResult.remainingAnalyses,
            analysisId
        };
    }

    /**
     * Get available payment methods for user
     * @private
     */
    _getAvailablePaymentMethods(subscriptionStatus, creditBalance) {
        const methods = [];

        if (subscriptionStatus.active) {
            methods.push({
                type: PAYMENT_METHOD_USED.SUBSCRIPTION,
                available: subscriptionStatus.analysisLimit === -1 ||
                    subscriptionStatus.analysisUsed < subscriptionStatus.analysisLimit,
                details: {
                    tier: subscriptionStatus.tierName,
                    remaining: subscriptionStatus.analysisLimit === -1 ?
                        'unlimited' :
                        Math.max(0, subscriptionStatus.analysisLimit - subscriptionStatus.analysisUsed)
                }
            });
        }

        if (creditBalance > 0) {
            methods.push({
                type: PAYMENT_METHOD_USED.CREDITS,
                available: true,
                details: {
                    balance: creditBalance
                }
            });
        }

        methods.push({
            type: PAYMENT_METHOD_USED.FREE_TIER,
            available: true, // Will be checked at execution time
            details: {
                note: 'Limited free analyses per month'
            }
        });

        return methods;
    }

    /**
     * Get recommended action for user
     * @private
     */
    _getRecommendedAction(subscriptionStatus, creditBalance, availablePaymentMethods) {
        if (!subscriptionStatus.active && creditBalance === 0) {
            return {
                type: 'subscribe_or_purchase_credits',
                priority: 'high',
                message: 'Subscribe or purchase credits to access AI analysis'
            };
        }

        if (subscriptionStatus.active && subscriptionStatus.analysisUsed >= subscriptionStatus.analysisLimit * 0.8) {
            return {
                type: 'approaching_limit',
                priority: 'medium',
                message: 'Subscription limit approaching. Consider upgrading or purchasing credits.'
            };
        }

        if (creditBalance > 0 && creditBalance < 10) {
            return {
                type: 'low_credits',
                priority: 'low',
                message: 'Credit balance is low. Consider purchasing more credits.'
            };
        }

        return null;
    }

    /**
     * Check if user has fallback payment options
     * @private
     */
    _hasFallbackOptions(accountStatus) {
        let fallbackCount = 0;

        if (accountStatus.hasActiveSubscription) fallbackCount++;
        if (accountStatus.hasCredits) fallbackCount++;

        return fallbackCount > 1;
    }

    /**
     * Generate transparency message for UI
     * @private
     */
    _generateTransparencyMessage(paymentDecision, accountStatus) {
        if (!paymentDecision.allowed) {
            return paymentDecision.transparencyInfo.message || 'Payment not available';
        }

        let message = paymentDecision.transparencyInfo.message;

        if (paymentDecision.fallbackUsed) {
            message += ` (Fallback from ${paymentDecision.transparencyInfo.originalMethod})`;
        }

        return message;
    }

    /**
     * Get upgrade options for user
     * @private
     */
    async _getUpgradeOptions(userId, requiredCredits) {
        const options = [];

        // Get subscription tiers
        const subscriptionTiers = await this.subscriptionManager.getSubscriptionTiers();
        options.push(...subscriptionTiers.map(tier => ({
            type: 'subscription',
            id: tier.id,
            name: tier.name,
            price: tier.monthlyPrice,
            features: tier.features,
            recommended: tier.popular
        })));

        // Get credit packages
        const creditPackages = await this.creditSystem.getCreditPackages();
        if (Array.isArray(creditPackages)) {
            options.push(...creditPackages
                .filter(pkg => pkg.getTotalCredits() >= requiredCredits)
                .map(pkg => ({
                    type: 'credits',
                    id: pkg.id,
                    name: pkg.name,
                    price: pkg.price,
                    credits: pkg.getTotalCredits(),
                    recommended: pkg.popular
                })));
        }

        return options;
    }

    /**
     * Get updated balance after payment
     * @private
     */
    async _getUpdatedBalance(userId) {
        const accountStatus = await this.getHybridAccountStatus(userId);
        return {
            credits: accountStatus.creditBalance,
            subscription: accountStatus.subscriptionStatus.active ? {
                remaining: accountStatus.subscriptionStatus.analysisLimit === -1 ?
                    'unlimited' :
                    Math.max(0, accountStatus.subscriptionStatus.analysisLimit - accountStatus.subscriptionStatus.analysisUsed)
            } : null
        };
    }

    /**
     * Generate unique analysis ID
     * @private
     */
    _generateAnalysisId() {
        return `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Check if preferred method is valid
     * @private
     */
    _isValidPreferredMethod(preferredMethod, accountStatus) {
        const validMethods = [
            PAYMENT_METHOD_USED.SUBSCRIPTION,
            PAYMENT_METHOD_USED.CREDITS,
            PAYMENT_METHOD_USED.FREE_TIER
        ];

        return validMethods.includes(preferredMethod);
    }

    /**
     * Try user's preferred payment method
     * @private
     */
    async _tryPreferredMethod(userId, analysisType, preferredMethod, accountStatus, analysisCost) {
        switch (preferredMethod) {
            case PAYMENT_METHOD_USED.SUBSCRIPTION:
                if (accountStatus.hasActiveSubscription) {
                    return await this._trySubscriptionPayment(userId, analysisType, accountStatus);
                }
                break;

            case PAYMENT_METHOD_USED.CREDITS:
                if (accountStatus.hasCredits) {
                    return await this._tryCreditPayment(userId, analysisType, accountStatus, analysisCost);
                }
                break;

            case PAYMENT_METHOD_USED.FREE_TIER:
                return await this._tryFreeTierPayment(userId, analysisType);
        }

        return new PaymentDecision({ allowed: false, reason: 'preferred_method_unavailable' });
    }
}

module.exports = {
    HybridPaymentSystem,
    PaymentDecision,
    HybridAccountStatus,
    PAYMENT_PRIORITY,
    PAYMENT_METHOD_USED
};