/**
 * Freemium Controller Service
 * 
 * Manages free tier limitations, usage tracking, and upgrade prompts
 * for the AI Monetization System.
 */

const { FreeUsageTrackingService } = require('../models/FreeUsageTracking');
const { FREEMIUM_CONFIG, CREDIT_CONFIG, SUBSCRIPTION_CONFIG } = require('../config/monetization');
const { db } = require('../config/firebase');

/**
 * FreemiumController manages free tier limitations and upgrade prompts
 */
class FreemiumController {
    /**
     * Check if user has remaining free analyses for current month
     * @param {string} userId - User ID
     * @returns {Promise<FreeLimitStatus>} Free limit status
     */
    static async checkFreeLimit(userId) {
        try {
            const limitResult = await FreeUsageTrackingService.checkFreeLimit(
                userId,
                FREEMIUM_CONFIG.monthlyAnalysisLimit
            );

            return {
                remainingAnalyses: limitResult.remainingAnalyses,
                resetDate: limitResult.resetDate,
                eligible: limitResult.canAnalyze,
                totalLimit: FREEMIUM_CONFIG.monthlyAnalysisLimit,
                usedAnalyses: FREEMIUM_CONFIG.monthlyAnalysisLimit - limitResult.remainingAnalyses
            };
        } catch (error) {
            console.error('Error checking free limit:', error);
            throw new Error('Failed to check free tier limit');
        }
    }

    /**
     * Consume a free analysis for the user
     * @param {string} userId - User ID
     * @param {string} analysisType - Type of analysis being performed
     * @returns {Promise<ConsumptionResult>} Consumption result
     */
    static async consumeFreeAnalysis(userId, analysisType = 'default') {
        try {
            // First check if user has remaining analyses
            const limitStatus = await this.checkFreeLimit(userId);

            if (!limitStatus.eligible) {
                return {
                    success: false,
                    reason: 'free_limit_exceeded',
                    message: 'Monthly free analysis limit exceeded',
                    upgradeRecommendations: await this.getUpgradeRecommendations(userId)
                };
            }

            // Consume the analysis
            const consumptionResult = await FreeUsageTrackingService.consumeFreeAnalysis(userId);

            if (!consumptionResult.success) {
                return {
                    success: false,
                    reason: 'consumption_failed',
                    message: consumptionResult.message || 'Failed to consume free analysis'
                };
            }

            return {
                success: true,
                remainingAnalyses: consumptionResult.remainingAnalyses,
                analysisType,
                cost: 0, // Free analysis
                paymentMethod: 'free_tier'
            };
        } catch (error) {
            console.error('Error consuming free analysis:', error);
            throw new Error('Failed to consume free analysis');
        }
    }
    /**
     * Reset monthly limits for all users (scheduled job)
     * @returns {Promise<void>}
     */
    static async resetMonthlyLimits() {
        try {
            console.log('Starting monthly free tier limit reset...');
            await FreeUsageTrackingService.resetMonthlyLimits();
            console.log('Monthly free tier limit reset completed');
        } catch (error) {
            console.error('Error resetting monthly limits:', error);
            throw new Error('Failed to reset monthly limits');
        }
    }

    /**
     * Get upgrade recommendations for a user
     * @param {string} userId - User ID
     * @returns {Promise<UpgradeRecommendation[]>} Array of upgrade recommendations
     */
    static async getUpgradeRecommendations(userId) {
        try {
            // Get user's usage history to make intelligent recommendations
            const usageHistory = await FreeUsageTrackingService.getUserHistory(userId, 3);
            const baseRecommendations = await FreeUsageTrackingService.getUpgradeRecommendations(
                userId,
                FREEMIUM_CONFIG.monthlyAnalysisLimit
            );

            // Enhance recommendations with pricing and savings calculations
            const enhancedRecommendations = [];

            // Credit package recommendations
            const creditPackages = CREDIT_CONFIG.defaultPackages;
            for (const pkg of creditPackages) {
                const costPerAnalysis = (pkg.price / (pkg.credits + pkg.bonusCredits)) * 100;
                enhancedRecommendations.push({
                    type: 'credit',
                    id: pkg.id,
                    title: pkg.name,
                    description: `${pkg.credits + pkg.bonusCredits} analyses for $${(pkg.price / 100).toFixed(2)}`,
                    price: pkg.price,
                    credits: pkg.credits + pkg.bonusCredits,
                    costPerAnalysis: Math.round(costPerAnalysis),
                    popular: pkg.popular,
                    savings: pkg.bonusCredits > 0 ? `${pkg.bonusCredits} bonus credits` : null
                });
            }

            // Subscription recommendations
            const subscriptionTiers = SUBSCRIPTION_CONFIG.defaultTiers;
            for (const tier of subscriptionTiers) {
                const monthlyAnalyses = tier.analysisLimit === -1 ? 'Unlimited' : tier.analysisLimit;
                const costPerAnalysis = tier.analysisLimit > 0 ?
                    Math.round((tier.monthlyPrice / tier.analysisLimit) * 100) : 0;

                enhancedRecommendations.push({
                    type: 'subscription',
                    id: tier.id,
                    title: tier.name,
                    description: `${monthlyAnalyses} analyses per month for $${(tier.monthlyPrice / 100).toFixed(2)}`,
                    price: tier.monthlyPrice,
                    analysisLimit: tier.analysisLimit,
                    costPerAnalysis: tier.analysisLimit > 0 ? costPerAnalysis : 0,
                    features: tier.features,
                    popular: tier.popular,
                    savings: this.calculateSubscriptionSavings(tier, usageHistory)
                });
            }

            // Sort recommendations by value (cost per analysis)
            return enhancedRecommendations.sort((a, b) => {
                if (a.type === 'subscription' && a.analysisLimit === -1) return -1;
                if (b.type === 'subscription' && b.analysisLimit === -1) return 1;
                return a.costPerAnalysis - b.costPerAnalysis;
            });

        } catch (error) {
            console.error('Error getting upgrade recommendations:', error);
            throw new Error('Failed to get upgrade recommendations');
        }
    }

    /**
     * Calculate potential savings for subscription based on usage history
     * @param {Object} tier - Subscription tier
     * @param {Array} usageHistory - User's usage history
     * @returns {string|null} Savings description
     */
    static calculateSubscriptionSavings(tier, usageHistory) {
        if (!usageHistory || usageHistory.length === 0) return null;

        const avgMonthlyUsage = usageHistory.reduce((sum, month) =>
            sum + month.analysisCount, 0) / usageHistory.length;

        if (tier.analysisLimit === -1) {
            return avgMonthlyUsage > FREEMIUM_CONFIG.monthlyAnalysisLimit ?
                'Unlimited analyses - perfect for heavy usage' : null;
        }

        if (avgMonthlyUsage > tier.analysisLimit * 0.8) {
            return `Great value for your ${Math.round(avgMonthlyUsage)} monthly analyses`;
        }

        return null;
    }

    /**
     * Check if user should see upgrade prompt
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} Whether to show upgrade prompt
     */
    static async shouldShowUpgradePrompt(userId) {
        try {
            const limitStatus = await this.checkFreeLimit(userId);
            const usagePercentage = limitStatus.usedAnalyses / limitStatus.totalLimit;

            // Show prompt when usage exceeds threshold
            if (usagePercentage >= FREEMIUM_CONFIG.upgradePrompts.threshold) {
                // Check cooldown period
                const lastPromptKey = `upgrade_prompt_${userId}`;
                const lastPromptDoc = await db.collection('system_state').doc(lastPromptKey).get();

                if (lastPromptDoc.exists) {
                    const lastPromptTime = lastPromptDoc.data().timestamp.toDate();
                    const cooldownExpired = Date.now() - lastPromptTime.getTime() >
                        FREEMIUM_CONFIG.upgradePrompts.cooldown;

                    if (!cooldownExpired) {
                        return false;
                    }
                }

                // Update last prompt time
                await db.collection('system_state').doc(lastPromptKey).set({
                    timestamp: new Date(),
                    usagePercentage,
                    remainingAnalyses: limitStatus.remainingAnalyses
                });

                return true;
            }

            return false;
        } catch (error) {
            console.error('Error checking upgrade prompt:', error);
            return false;
        }
    }

    /**
     * Get freemium status summary for user
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Freemium status summary
     */
    static async getFreemiumStatus(userId) {
        try {
            const limitStatus = await this.checkFreeLimit(userId);
            const shouldPrompt = await this.shouldShowUpgradePrompt(userId);
            const recommendations = shouldPrompt ?
                await this.getUpgradeRecommendations(userId) : [];

            return {
                ...limitStatus,
                showUpgradePrompt: shouldPrompt,
                upgradeRecommendations: recommendations,
                config: {
                    monthlyLimit: FREEMIUM_CONFIG.monthlyAnalysisLimit,
                    resetDay: FREEMIUM_CONFIG.resetDay
                }
            };
        } catch (error) {
            console.error('Error getting freemium status:', error);
            throw new Error('Failed to get freemium status');
        }
    }
    /**
     * Process immediate upgrade effects when user upgrades from free tier
     * @param {string} userId - User ID
     * @param {string} upgradeType - Type of upgrade ('credit' or 'subscription')
     * @param {Object} upgradeDetails - Details of the upgrade
     * @returns {Promise<Object>} Upgrade effect result
     */
    static async processUpgradeEffects(userId, upgradeType, upgradeDetails) {
        try {
            const upgradeResult = {
                success: true,
                userId,
                upgradeType,
                effectsApplied: [],
                timestamp: new Date()
            };

            // Record the upgrade event
            const upgradeEvent = {
                userId,
                upgradeType,
                upgradeDetails,
                timestamp: new Date(),
                previousStatus: 'free_tier'
            };

            // Store upgrade event in system state for tracking
            await db.collection('upgrade_events').add(upgradeEvent);
            upgradeResult.effectsApplied.push('upgrade_event_recorded');

            // Clear any upgrade prompt cooldowns
            const promptKey = `upgrade_prompt_${userId}`;
            await db.collection('system_state').doc(promptKey).delete();
            upgradeResult.effectsApplied.push('prompt_cooldown_cleared');

            // Apply specific effects based on upgrade type
            if (upgradeType === 'credit') {
                await this.applyCreditUpgradeEffects(userId, upgradeDetails, upgradeResult);
            } else if (upgradeType === 'subscription') {
                await this.applySubscriptionUpgradeEffects(userId, upgradeDetails, upgradeResult);
            }

            // Mark user as no longer on free tier
            await db.collection('user_upgrade_status').doc(userId).set({
                hasUpgraded: true,
                upgradeType,
                upgradeDate: new Date(),
                previousTier: 'free'
            });
            upgradeResult.effectsApplied.push('upgrade_status_updated');

            console.log(`Upgrade effects processed for user ${userId}:`, upgradeResult.effectsApplied);
            return upgradeResult;

        } catch (error) {
            console.error('Error processing upgrade effects:', error);
            throw new Error('Failed to process upgrade effects');
        }
    }

    /**
     * Apply effects specific to credit purchases
     */
    static async applyCreditUpgradeEffects(userId, upgradeDetails, upgradeResult) {
        upgradeResult.effectsApplied.push('credits_immediately_available');

        await db.collection('upgrade_analytics').add({
            userId,
            upgradeType: 'credit',
            packageId: upgradeDetails.packageId,
            creditsAdded: upgradeDetails.credits,
            amountPaid: upgradeDetails.amount,
            timestamp: new Date()
        });
        upgradeResult.effectsApplied.push('credit_analytics_recorded');
    }

    /**
     * Apply effects specific to subscription upgrades
     */
    static async applySubscriptionUpgradeEffects(userId, upgradeDetails, upgradeResult) {
        upgradeResult.effectsApplied.push('subscription_immediately_active');

        await db.collection('upgrade_analytics').add({
            userId,
            upgradeType: 'subscription',
            tierId: upgradeDetails.tierId,
            monthlyPrice: upgradeDetails.monthlyPrice,
            analysisLimit: upgradeDetails.analysisLimit,
            timestamp: new Date()
        });
        upgradeResult.effectsApplied.push('subscription_analytics_recorded');
        upgradeResult.effectsApplied.push('free_usage_preserved');
    }

    /**
     * Check if user has upgraded from free tier
     */
    static async getUserUpgradeStatus(userId) {
        try {
            const upgradeDoc = await db.collection('user_upgrade_status').doc(userId).get();

            if (!upgradeDoc.exists) {
                return {
                    hasUpgraded: false,
                    currentTier: 'free',
                    upgradeDate: null,
                    upgradeType: null
                };
            }

            const upgradeData = upgradeDoc.data();
            return {
                hasUpgraded: upgradeData.hasUpgraded || false,
                currentTier: upgradeData.hasUpgraded ? upgradeData.upgradeType : 'free',
                upgradeDate: upgradeData.upgradeDate,
                upgradeType: upgradeData.upgradeType,
                previousTier: upgradeData.previousTier
            };
        } catch (error) {
            console.error('Error getting upgrade status:', error);
            return {
                hasUpgraded: false,
                currentTier: 'free',
                upgradeDate: null,
                upgradeType: null
            };
        }
    }

    /**
     * Validate that upgrade effects were applied correctly
     */
    static async validateUpgradeEffects(userId, upgradeType) {
        try {
            const upgradeStatus = await this.getUserUpgradeStatus(userId);
            const freemiumStatus = await this.getFreemiumStatus(userId);

            const validation = {
                valid: true,
                checks: [],
                issues: []
            };

            if (!upgradeStatus.hasUpgraded) {
                validation.valid = false;
                validation.issues.push('Upgrade status not recorded');
            } else {
                validation.checks.push('Upgrade status recorded correctly');
            }

            if (upgradeStatus.upgradeType !== upgradeType) {
                validation.valid = false;
                validation.issues.push(`Upgrade type mismatch: expected ${upgradeType}, got ${upgradeStatus.upgradeType}`);
            } else {
                validation.checks.push('Upgrade type matches');
            }

            return validation;
        } catch (error) {
            console.error('Error validating upgrade effects:', error);
            return {
                valid: false,
                checks: [],
                issues: ['Validation failed due to error: ' + error.message]
            };
        }
    }
}

module.exports = { FreemiumController };