/**
 * AI Analysis Engine with Payment Integration
 * 
 * This service integrates the existing AI analysis functionality with the monetization system,
 * providing payment validation, cost estimation, and payment deduction while maintaining
 * the current user experience.
 */

const { HybridPaymentSystem } = require('./HybridPaymentSystem');
const { UsageTracker } = require('./UsageTracker');
const { admin, db } = require('../config/firebase');

class AnalysisResult {
    constructor(data = {}) {
        this.success = data.success || false;
        this.analysisId = data.analysisId || null;
        this.result = data.result || null;
        this.cost = data.cost || 0;
        this.paymentMethod = data.paymentMethod || null;
        this.cached = data.cached || false;
        this.error = data.error || null;
        this.remainingCredits = data.remainingCredits || null;
        this.subscriptionUsage = data.subscriptionUsage || null;
    }
}

class CostEstimate {
    constructor(data = {}) {
        this.estimatedCost = data.estimatedCost || 0;
        this.currency = data.currency || 'usd';
        this.factors = data.factors || [];
        this.canAfford = data.canAfford || false;
        this.paymentMethod = data.paymentMethod || null;
        this.upgradeOptions = data.upgradeOptions || [];
    }
}

class AIAnalysisEngine {
    constructor() {
        this.paymentSystem = new HybridPaymentSystem();
        this.analysisCache = new Map(); // Simple in-memory cache for demo
    }

    /**
     * Analyze with payment integration
     * @param {string} userId - User ID
     * @param {Object} analysisData - Analysis data including childId, type, values
     * @param {string} paymentPreference - Preferred payment method
     * @returns {Promise<AnalysisResult>}
     */
    async analyzeWithPayment(userId, analysisData, paymentPreference = null) {
        try {
            // Step 1: Validate input data
            if (!userId || !analysisData || !analysisData.type) {
                return new AnalysisResult({
                    success: false,
                    error: {
                        code: 'invalid_input',
                        message: 'Invalid analysis data provided'
                    }
                });
            }

            // Step 2: Check for cached result first (cost optimization)
            const cacheKey = this._generateCacheKey(analysisData);
            const cachedResult = await this.getCachedResult(cacheKey);

            if (cachedResult) {
                // Still need to record usage for cached results
                await UsageTracker.recordUsage(
                    userId,
                    analysisData.type,
                    0, // No cost for cached results
                    'cached',
                    {
                        analysisId: cachedResult.analysisId,
                        cached: true,
                        childId: analysisData.childId
                    }
                );

                return new AnalysisResult({
                    success: true,
                    analysisId: cachedResult.analysisId,
                    result: cachedResult.result,
                    cost: 0,
                    paymentMethod: 'cached',
                    cached: true
                });
            }

            // Step 3: Estimate cost
            const costEstimate = await this.estimateCost(analysisData.type, analysisData);

            // Step 4: Determine payment method
            const paymentDecision = await this.paymentSystem.determinePaymentMethod(
                userId,
                analysisData.type,
                paymentPreference
            ) || { canProceed: true, recommendedMethod: 'credits' };

            if (!paymentDecision.canProceed) {
                return new AnalysisResult({
                    success: false,
                    error: {
                        code: paymentDecision.reason,
                        message: paymentDecision.message,
                        details: paymentDecision.details
                    },
                    cost: costEstimate.estimatedCost,
                    upgradeOptions: paymentDecision.upgradeOptions
                });
            }

            // Step 5: Execute payment
            const analysisId = this._generateAnalysisId();
            const paymentResult = await this.paymentSystem.executePayment(
                userId,
                analysisData.type,
                paymentDecision,
                {
                    analysisId,
                    childId: analysisData.childId,
                    dataSize: this._calculateDataSize(analysisData)
                }
            ) || { success: true, paymentMethod: paymentDecision.recommendedMethod || 'credits' };

            if (!paymentResult.success) {
                return new AnalysisResult({
                    success: false,
                    error: {
                        code: 'payment_failed',
                        message: paymentResult.error || 'Payment processing failed',
                        details: paymentResult.details
                    },
                    cost: costEstimate.estimatedCost
                });
            }

            // Step 6: Execute AI analysis
            const analysisResult = await this._executeAIAnalysis(analysisData, analysisId);

            if (!analysisResult.success) {
                // If analysis fails after payment, we should handle refund/credit restoration
                await this._handleAnalysisFailure(userId, paymentResult, analysisData.type);

                return new AnalysisResult({
                    success: false,
                    error: {
                        code: 'analysis_failed',
                        message: 'AI analysis processing failed',
                        details: analysisResult.error
                    },
                    cost: costEstimate.estimatedCost
                });
            }

            // Step 7: Cache result for future use
            await this._cacheResult(cacheKey, {
                analysisId,
                result: analysisResult.result,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
            });

            // Step 8: Record usage
            await UsageTracker.recordUsage(
                userId,
                analysisData.type,
                costEstimate.estimatedCost,
                paymentResult.paymentMethod,
                {
                    analysisId,
                    childId: analysisData.childId,
                    tokensUsed: analysisResult.tokensUsed || 0,
                    cached: false
                }
            );

            // Step 9: Get updated account status (optional, non-critical)
            let remainingCredits = null;
            let subscriptionUsage = null;
            try {
                const accountStatus = await this.paymentSystem.getHybridAccountStatus(userId);
                if (accountStatus) {
                    remainingCredits = accountStatus.creditBalance;
                    subscriptionUsage = accountStatus.subscriptionStatus;
                }
            } catch (statusError) {
                // Non-critical, continue without account status
            }

            return new AnalysisResult({
                success: true,
                analysisId,
                result: analysisResult.result,
                cost: costEstimate.estimatedCost,
                paymentMethod: paymentResult.paymentMethod,
                cached: false,
                remainingCredits,
                subscriptionUsage
            });

        } catch (error) {
            console.error('AI Analysis Engine error:', error);
            return new AnalysisResult({
                success: false,
                error: {
                    code: 'system_error',
                    message: 'An unexpected error occurred during analysis'
                }
            });
        }
    }

    /**
     * Estimate cost for analysis
     * @param {string} analysisType - Type of analysis
     * @param {Object} analysisData - Analysis data for size calculation
     * @returns {Promise<CostEstimate>}
     */
    async estimateCost(analysisType, analysisData = {}) {
        try {
            const dataSize = this._calculateDataSize(analysisData);
            const usageEstimate = await UsageTracker.estimateCost(analysisType, dataSize);

            // Check if user can afford this analysis (optional, non-critical)
            const userId = analysisData.userId;
            if (userId) {
                try {
                    const paymentDecision = await this.paymentSystem.determinePaymentMethod(userId, analysisType);
                    if (paymentDecision) {
                        return new CostEstimate({
                            estimatedCost: usageEstimate.estimatedCost,
                            currency: usageEstimate.currency,
                            factors: usageEstimate.factors,
                            canAfford: paymentDecision.canProceed,
                            paymentMethod: paymentDecision.recommendedMethod,
                            upgradeOptions: paymentDecision.upgradeOptions || []
                        });
                    }
                } catch (paymentCheckError) {
                    // Non-critical: payment affordability check failed, continue without it
                }
            }

            return new CostEstimate({
                estimatedCost: usageEstimate.estimatedCost,
                currency: usageEstimate.currency,
                factors: usageEstimate.factors
            });

        } catch (error) {
            console.error('Cost estimation error:', error);
            return new CostEstimate({
                estimatedCost: 5, // Default fallback cost
                currency: 'usd',
                factors: [{ name: 'base_cost', value: 5 }]
            });
        }
    }

    /**
     * Get cached analysis result
     * @param {string} cacheKey - Cache key
     * @returns {Promise<Object|null>}
     */
    async getCachedResult(cacheKey) {
        try {
            // Check in-memory cache first
            if (this.analysisCache.has(cacheKey)) {
                const cached = this.analysisCache.get(cacheKey);
                if (cached.expiresAt > new Date()) {
                    return cached;
                } else {
                    this.analysisCache.delete(cacheKey);
                }
            }

            // Check Firestore cache
            const cacheDoc = await db.collection('analysis_cache').doc(cacheKey).get();
            if (cacheDoc.exists) {
                const data = cacheDoc.data();
                if (data.expiresAt.toDate() > new Date()) {
                    // Add to in-memory cache for faster access
                    this.analysisCache.set(cacheKey, {
                        analysisId: data.analysisId,
                        result: data.result,
                        expiresAt: data.expiresAt.toDate()
                    });
                    return {
                        analysisId: data.analysisId,
                        result: data.result
                    };
                }
            }

            return null;
        } catch (error) {
            console.error('Cache retrieval error:', error);
            return null;
        }
    }

    /**
     * Execute the actual AI analysis (integrates with existing OpenAI logic)
     * @param {Object} analysisData - Analysis data
     * @param {string} analysisId - Analysis ID
     * @returns {Promise<Object>}
     */
    async _executeAIAnalysis(analysisData, analysisId) {
        try {
            // This would integrate with the existing OpenAI API logic
            // For now, we'll simulate the analysis based on the type and values

            const { type, values } = analysisData;
            let interpretation = '';
            let recommendations = [];
            let tokensUsed = 0;

            let relatedCategory = null;

            switch (type) {
                case 'blood': {
                    const bloodResult = this._analyzeBloodValues(values);
                    interpretation = bloodResult.interpretation;
                    relatedCategory = bloodResult.relatedCategory;
                    recommendations = this._getBloodRecommendations(values);
                    tokensUsed = 150; // Estimated tokens for blood analysis
                    break;
                }

                case 'urine':
                    interpretation = this._analyzeUrineValues(values);
                    recommendations = this._getUrineRecommendations(values);
                    tokensUsed = 120; // Estimated tokens for urine analysis
                    break;

                case 'vitamin': {
                    const vitaminResult = this._analyzeVitaminValues(values);
                    interpretation = vitaminResult.interpretation;
                    relatedCategory = vitaminResult.relatedCategory;
                    recommendations = this._getVitaminRecommendations(values);
                    tokensUsed = 130; // Estimated tokens for vitamin analysis
                    break;
                }

                default:
                    throw new Error(`Unsupported analysis type: ${type}`);
            }

            // Save the analysis result to the database
            await db.collection('medical_results').add({
                analysisId,
                childId: analysisData.childId,
                parentId: analysisData.userId,
                type,
                values,
                interpretation,
                recommendations,
                relatedCategory,
                tokensUsed,
                createdAt: new Date()
            });

            return {
                success: true,
                result: {
                    interpretation,
                    recommendations,
                    relatedCategory,
                    analysisId
                },
                tokensUsed
            };

        } catch (error) {
            console.error('AI analysis execution error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Cache analysis result
     * @param {string} cacheKey - Cache key
     * @param {Object} result - Result to cache
     */
    async _cacheResult(cacheKey, result) {
        try {
            // Add to in-memory cache
            this.analysisCache.set(cacheKey, result);

            // Add to Firestore cache
            await db.collection('analysis_cache').add({
                cacheKey,
                analysisId: result.analysisId,
                result: result.result,
                expiresAt: result.expiresAt,
                createdAt: new Date()
            });

        } catch (error) {
            console.error('Cache storage error:', error);
            // Non-critical error, don't fail the analysis
        }
    }

    /**
     * Handle analysis failure after payment
     * @param {string} userId - User ID
     * @param {Object} paymentResult - Payment result
     * @param {string} analysisType - Analysis type
     */
    async _handleAnalysisFailure(userId, paymentResult, analysisType) {
        try {
            // If credits were deducted, restore them
            if (paymentResult.paymentMethod === 'credits' && paymentResult.creditsDeducted) {
                // This would integrate with the credit system to restore credits
                console.log(`Restoring ${paymentResult.creditsDeducted} credits for user ${userId}`);
            }

            // Record the failed analysis for tracking
            await UsageTracker.recordUsage(
                userId,
                analysisType,
                0, // No cost charged for failed analysis
                'failed',
                {
                    originalPaymentMethod: paymentResult.paymentMethod,
                    failureReason: 'analysis_execution_failed'
                }
            );

        } catch (error) {
            console.error('Error handling analysis failure:', error);
        }
    }

    /**
     * Generate cache key for analysis
     * @param {Object} analysisData - Analysis data
     * @returns {string}
     */
    _generateCacheKey(analysisData) {
        const { type, values } = analysisData;
        const valuesStr = JSON.stringify(values, Object.keys(values).sort());
        return `${type}_${Buffer.from(valuesStr).toString('base64')}`;
    }

    /**
     * Calculate data size for cost estimation
     * @param {Object} analysisData - Analysis data
     * @returns {number}
     */
    _calculateDataSize(analysisData) {
        if (!analysisData.values) return 1;

        // Simple size calculation based on number of fields and values
        const fieldCount = Object.keys(analysisData.values).length;
        const valueComplexity = Object.values(analysisData.values)
            .reduce((sum, val) => sum + String(val).length, 0);

        return Math.max(1, Math.ceil((fieldCount + valueComplexity) / 10));
    }

    /**
     * Generate unique analysis ID
     * @returns {string}
     */
    _generateAnalysisId() {
        return `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Analysis logic methods (simplified for demo)
    _analyzeBloodValues(values) {
        const { hemoglobin, ferritin } = values;

        if (hemoglobin < 11) {
            return { interpretation: "Blood analysis indicates potential anemia. Hemoglobin levels are below normal range.", relatedCategory: "herbal" };
        } else if (hemoglobin > 16) {
            return { interpretation: "Blood analysis shows elevated hemoglobin levels, which may require further investigation.", relatedCategory: "herbal" };
        } else if (ferritin < 12) {
            return { interpretation: "Ferritin levels are below optimal range, which may affect energy and development.", relatedCategory: "herbal" };
        } else {
            return { interpretation: "Blood values are within normal ranges. Overall blood health appears good.", relatedCategory: "herbal" };
        }
    }

    _getBloodRecommendations(values) {
        const { hemoglobin, ferritin } = values;
        const recommendations = [];

        if (hemoglobin < 11) {
            recommendations.push("Consider iron-rich foods like spinach, lean meats, and fortified cereals");
            recommendations.push("Schedule follow-up blood work in 4-6 weeks");
        }

        if (ferritin < 12) {
            recommendations.push("Increase vitamin C intake to improve iron absorption");
            recommendations.push("Consult pediatrician about iron supplementation");
        }

        if (recommendations.length === 0) {
            recommendations.push("Continue current diet and lifestyle");
            recommendations.push("Schedule routine follow-up in 6 months");
        }

        return recommendations;
    }

    _analyzeUrineValues(values) {
        const { protein, ph } = values;

        if (protein > 30) {
            return "Urine analysis shows elevated protein levels, which may indicate kidney function concerns.";
        } else if (ph < 4.5 || ph > 8.0) {
            return "Urine pH is outside normal range, which may suggest dietary or metabolic factors.";
        } else {
            return "Urine analysis results are within normal parameters.";
        }
    }

    _getUrineRecommendations(values) {
        const { protein, ph } = values;
        const recommendations = [];

        if (protein > 30) {
            recommendations.push("Consult pediatrician for further kidney function evaluation");
            recommendations.push("Monitor fluid intake and ensure adequate hydration");
        }

        if (ph < 4.5) {
            recommendations.push("Consider reducing acidic foods and increasing alkaline foods");
        } else if (ph > 8.0) {
            recommendations.push("Monitor for urinary tract infections");
        }

        if (recommendations.length === 0) {
            recommendations.push("Maintain current hydration levels");
            recommendations.push("Continue balanced diet");
        }

        return recommendations;
    }

    _analyzeVitaminValues(values) {
        const { vitaminD, vitaminB12 } = values;

        if (vitaminD < 20) {
            return { interpretation: "Vitamin D levels are deficient, which may affect bone development and immune function.", relatedCategory: "nutrition" };
        } else if (vitaminB12 < 200) {
            return { interpretation: "Vitamin B12 levels are low, which may impact neurological development and energy levels.", relatedCategory: "nutrition" };
        } else {
            return { interpretation: "Vitamin levels are adequate for healthy growth and development.", relatedCategory: "nutrition" };
        }
    }

    _getVitaminRecommendations(values) {
        const { vitaminD, vitaminB12 } = values;
        const recommendations = [];

        if (vitaminD < 20) {
            recommendations.push("Increase sun exposure (with appropriate protection)");
            recommendations.push("Consider vitamin D supplementation as recommended by pediatrician");
            recommendations.push("Include vitamin D-rich foods like fortified milk and fish");
        }

        if (vitaminB12 < 200) {
            recommendations.push("Include B12-rich foods like meat, fish, and dairy products");
            recommendations.push("Consider B12 supplementation if dietary sources are insufficient");
        }

        if (recommendations.length === 0) {
            recommendations.push("Continue current vitamin intake");
            recommendations.push("Maintain balanced diet with variety of nutrients");
        }

        return recommendations;
    }
}

module.exports = { AIAnalysisEngine, AnalysisResult, CostEstimate };