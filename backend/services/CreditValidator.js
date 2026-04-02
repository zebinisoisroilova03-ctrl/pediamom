/**
 * Credit Validator Service
 * 
 * Handles credit balance validation, limits checking, and upgrade prompts
 * Ensures users have sufficient credits before analysis execution
 */

const CreditSystem = require('./CreditSystem');
const { UserPaymentProfileService } = require('../models/UserPaymentProfile');
const { CREDIT_CONFIG } = require('../config/monetization');

/**
 * Credit Validation Result Interface
 */
class CreditValidationResult {
    constructor(data = {}) {
        this.allowed = data.allowed || false;
        this.reason = data.reason || null;
        this.suggestedAction = data.suggestedAction || null;
        this.details = data.details || {};
        this.upgradeOptions = data.upgradeOptions || [];
    }
}

/**
 * Credit Validator Class
 */
class CreditValidator {
    constructor() {
        this.creditSystem = new CreditSystem();
    }

    /**
     * Simple synchronous credit validation (for testing and quick checks)
     * @param {number} balance - Current credit balance
     * @param {string} analysisType - Type of analysis
     * @param {number} cost - Cost of the analysis
     * @returns {{ sufficient: boolean, remaining?: number, shortfall?: number }}
     */
    validateCredits(balance, analysisType, cost) {
        const analysisTypeCost = cost !== undefined ? cost : (CREDIT_CONFIG.analysisCosts[analysisType] || CREDIT_CONFIG.analysisCosts.default);
        const sufficient = balance >= analysisTypeCost;
        if (sufficient) {
            return { sufficient: true, remaining: balance - analysisTypeCost };
        }
        return { sufficient: false, shortfall: analysisTypeCost - balance };
    }

    /**
     * Validate if user can perform analysis based on credit balance
     */
    async validateAnalysisRequest(userId, analysisType) {
        try {
            // Check credit sufficiency
            const creditCheck = await this.creditSystem.checkSufficientCredits(userId, analysisType);

            if (creditCheck.sufficient) {
                return new CreditValidationResult({
                    allowed: true,
                    details: {
                        required: creditCheck.required,
                        available: creditCheck.available,
                        remaining: creditCheck.available - creditCheck.required
                    }
                });
            }

            // Insufficient credits - get upgrade options
            const upgradeOptions = await this.creditSystem.getUpgradeRecommendations(userId);

            return new CreditValidationResult({
                allowed: false,
                reason: 'insufficient_credits',
                suggestedAction: 'purchase_credits',
                details: {
                    required: creditCheck.required,
                    available: creditCheck.available,
                    shortfall: creditCheck.shortfall
                },
                upgradeOptions: upgradeOptions
            });
        } catch (error) {
            console.error('Error validating analysis request:', error);
            return new CreditValidationResult({
                allowed: false,
                reason: 'validation_error',
                suggestedAction: 'contact_support',
                details: {
                    error: error.message
                }
            });
        }
    }

    /**
     * Validate multiple analysis requests (batch validation)
     */
    async validateBatchAnalysisRequest(userId, analysisTypes) {
        try {
            if (!Array.isArray(analysisTypes)) {
                analysisTypes = [analysisTypes];
            }

            const costEstimate = this.creditSystem.estimateCost(analysisTypes);
            const currentBalance = await this.creditSystem.getCreditBalance(userId);

            if (currentBalance >= costEstimate.totalCost) {
                return new CreditValidationResult({
                    allowed: true,
                    details: {
                        totalRequired: costEstimate.totalCost,
                        available: currentBalance,
                        remaining: currentBalance - costEstimate.totalCost,
                        breakdown: costEstimate.breakdown
                    }
                });
            }

            // Insufficient credits for batch
            const upgradeOptions = await this.creditSystem.getUpgradeRecommendations(userId);

            return new CreditValidationResult({
                allowed: false,
                reason: 'insufficient_credits_batch',
                suggestedAction: 'purchase_credits',
                details: {
                    totalRequired: costEstimate.totalCost,
                    available: currentBalance,
                    shortfall: costEstimate.totalCost - currentBalance,
                    breakdown: costEstimate.breakdown
                },
                upgradeOptions: upgradeOptions
            });
        } catch (error) {
            console.error('Error validating batch analysis request:', error);
            return new CreditValidationResult({
                allowed: false,
                reason: 'validation_error',
                suggestedAction: 'contact_support',
                details: {
                    error: error.message
                }
            });
        }
    }

    /**
     * Check if user should receive low balance warning
     */
    async checkLowBalanceWarning(userId) {
        try {
            const balance = await this.creditSystem.getCreditBalance(userId);
            const warningThreshold = CREDIT_CONFIG.analysisCosts.default * 2; // Warn when less than 2 analyses remaining

            if (balance <= warningThreshold && balance > 0) {
                const upgradeOptions = await this.creditSystem.getUpgradeRecommendations(userId);

                return {
                    shouldWarn: true,
                    balance: balance,
                    threshold: warningThreshold,
                    message: `You have ${balance} credits remaining. Consider purchasing more credits to continue using AI analysis.`,
                    upgradeOptions: upgradeOptions
                };
            }

            return {
                shouldWarn: false,
                balance: balance
            };
        } catch (error) {
            console.error('Error checking low balance warning:', error);
            return {
                shouldWarn: false,
                error: error.message
            };
        }
    }

    /**
     * Get credit status summary for user
     */
    async getCreditStatus(userId) {
        try {
            const balance = await this.creditSystem.getCreditBalance(userId);
            const defaultCost = CREDIT_CONFIG.analysisCosts.default;
            const analysesRemaining = Math.floor(balance / defaultCost);

            // Calculate status level
            let status = 'good';
            let statusMessage = 'You have sufficient credits for analysis.';

            if (balance === 0) {
                status = 'empty';
                statusMessage = 'You have no credits remaining. Purchase credits to continue.';
            } else if (balance < defaultCost) {
                status = 'insufficient';
                statusMessage = 'You don\'t have enough credits for a standard analysis.';
            } else if (analysesRemaining <= 2) {
                status = 'low';
                statusMessage = `You have ${analysesRemaining} analysis${analysesRemaining === 1 ? '' : 'es'} remaining.`;
            }

            return {
                balance: balance,
                analysesRemaining: analysesRemaining,
                status: status,
                statusMessage: statusMessage,
                costs: CREDIT_CONFIG.analysisCosts
            };
        } catch (error) {
            console.error('Error getting credit status:', error);
            throw new Error('Failed to get credit status');
        }
    }

    /**
     * Generate upgrade prompt based on user's current situation
     */
    async generateUpgradePrompt(userId, context = {}) {
        try {
            const balance = await this.creditSystem.getCreditBalance(userId);
            const packages = await this.creditSystem.getCreditPackages();

            // Determine prompt type based on balance and context
            let promptType = 'general';
            let title = 'Purchase Credits';
            let message = 'Get more credits to continue using AI analysis.';

            if (balance === 0) {
                promptType = 'empty';
                title = 'No Credits Remaining';
                message = 'You\'ve used all your credits. Purchase more to continue analyzing your child\'s health data.';
            } else if (context.analysisType) {
                const required = this.creditSystem.getAnalysisCost(context.analysisType);
                if (balance < required) {
                    promptType = 'insufficient';
                    title = 'Insufficient Credits';
                    message = `You need ${required} credits for ${context.analysisType} analysis, but only have ${balance}.`;
                }
            }

            // Find recommended package
            const recommendedPackage = packages.find(pkg => pkg.popular) || packages[0];

            return {
                type: promptType,
                title: title,
                message: message,
                currentBalance: balance,
                packages: packages.map(pkg => ({
                    id: pkg.id,
                    name: pkg.name,
                    credits: pkg.getTotalCredits(),
                    price: pkg.price,
                    priceFormatted: `$${(pkg.price / 100).toFixed(2)}`,
                    popular: pkg.popular,
                    bonusCredits: pkg.bonusCredits,
                    valueProposition: this._calculateValueProposition(pkg)
                })),
                recommendedPackageId: recommendedPackage?.id,
                context: context
            };
        } catch (error) {
            console.error('Error generating upgrade prompt:', error);
            throw new Error('Failed to generate upgrade prompt');
        }
    }

    /**
     * Validate credit deduction before processing
     */
    async validateCreditDeduction(userId, analysisType, analysisId) {
        try {
            const validation = await this.validateAnalysisRequest(userId, analysisType);

            if (!validation.allowed) {
                return {
                    success: false,
                    validation: validation
                };
            }

            // Perform the deduction
            const deductionResult = await this.creditSystem.deductCredits(
                userId,
                analysisType,
                analysisId
            );

            if (!deductionResult.success) {
                return {
                    success: false,
                    error: deductionResult.error,
                    validation: validation
                };
            }

            // Check if user should receive low balance warning after deduction
            const warningCheck = await this.checkLowBalanceWarning(userId);

            return {
                success: true,
                creditsDeducted: deductionResult.creditsDeducted,
                newBalance: deductionResult.newBalance,
                lowBalanceWarning: warningCheck.shouldWarn ? warningCheck : null
            };
        } catch (error) {
            console.error('Error validating credit deduction:', error);
            return {
                success: false,
                error: {
                    code: 'validation_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Calculate value proposition for a credit package
     * @private
     */
    _calculateValueProposition(creditPackage) {
        const baseCredits = creditPackage.credits;
        const bonusCredits = creditPackage.bonusCredits;
        const totalCredits = creditPackage.getTotalCredits();
        const pricePerCredit = creditPackage.price / totalCredits;

        let proposition = `$${(pricePerCredit / 100).toFixed(3)} per credit`;

        if (bonusCredits > 0) {
            const bonusPercentage = Math.round((bonusCredits / baseCredits) * 100);
            proposition += ` (${bonusPercentage}% bonus)`;
        }

        return proposition;
    }

    /**
     * Get credit limits and thresholds
     */
    getCreditLimits() {
        return {
            warningThreshold: CREDIT_CONFIG.analysisCosts.default * 2,
            minimumBalance: 0,
            analysisCosts: CREDIT_CONFIG.analysisCosts,
            defaultCost: CREDIT_CONFIG.analysisCosts.default
        };
    }
}

module.exports = {
    CreditValidator,
    CreditValidationResult
};