/**
 * Property-Based Tests for FreemiumController
 * 
 * Tests universal properties that should hold across all valid inputs
 * for the freemium tier management system.
 */

const fc = require('fast-check');

// Mock Firebase Admin before importing other modules
jest.mock('firebase-admin', () => {
    const tsNow = () => ({ seconds: Date.now() / 1000, toDate: () => new Date() });
    const firestoreFn = jest.fn(() => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn(),
                set: jest.fn(),
                update: jest.fn(),
                delete: jest.fn()
            })),
            where: jest.fn(() => ({
                get: jest.fn()
            })),
            add: jest.fn()
        })),
        runTransaction: jest.fn(),
        batch: jest.fn(() => ({
            delete: jest.fn(),
            commit: jest.fn()
        }))
    }));
    firestoreFn.Timestamp = {
        now: tsNow,
        fromDate: (date) => ({ seconds: date.getTime() / 1000, toDate: () => date })
    };
    return { firestore: firestoreFn, apps: [], initializeApp: jest.fn() };
});

const { FreemiumController } = require('../../services/FreemiumController');
const { FreeUsageTrackingService } = require('../../models/FreeUsageTracking');
const { FREEMIUM_CONFIG } = require('../../config/monetization');

// Test configuration
const propertyTestConfig = {
    numRuns: 50, // Reduced for faster testing
    verbose: false,
    seed: process.env.TEST_SEED || 42,
    endOnFailure: true
};

// Custom generators for freemium testing
const userIdGenerator = fc.string({ minLength: 10, maxLength: 30 });
const analysisTypeGenerator = fc.constantFrom('blood', 'urine', 'vitamin', 'growth', 'nutrition');

describe('FreemiumController Property Tests', () => {
    let mockUsageData = new Map(); // In-memory store for testing

    beforeEach(async () => {
        // Clear mock data
        mockUsageData.clear();

        // Mock FreeUsageTrackingService methods
        jest.spyOn(FreeUsageTrackingService, 'checkFreeLimit').mockImplementation(async (userId, limit) => {
            const key = `${userId}_${new Date().getFullYear()}_${new Date().getMonth() + 1}`;
            const usage = mockUsageData.get(key) || { analysisCount: 0 };
            const remaining = Math.max(0, limit - usage.analysisCount);

            return {
                canAnalyze: remaining > 0,
                remainingAnalyses: remaining,
                resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
            };
        });

        jest.spyOn(FreeUsageTrackingService, 'consumeFreeAnalysis').mockImplementation(async (userId) => {
            const key = `${userId}_${new Date().getFullYear()}_${new Date().getMonth() + 1}`;
            const usage = mockUsageData.get(key) || { analysisCount: 0 };

            if (usage.analysisCount >= FREEMIUM_CONFIG.monthlyAnalysisLimit) {
                return {
                    success: false,
                    message: 'Monthly limit exceeded'
                };
            }

            usage.analysisCount++;
            mockUsageData.set(key, usage);

            return {
                success: true,
                remainingAnalyses: FREEMIUM_CONFIG.monthlyAnalysisLimit - usage.analysisCount
            };
        });

        jest.spyOn(FreeUsageTrackingService, 'resetMonthlyLimits').mockImplementation(async () => {
            mockUsageData.clear();
        });

        jest.spyOn(FreeUsageTrackingService, 'getUserHistory').mockImplementation(async (userId, months) => {
            return [
                { month: '2024-01', analysisCount: 3 },
                { month: '2024-02', analysisCount: 5 },
                { month: '2024-03', analysisCount: 2 }
            ];
        });

        jest.spyOn(FreeUsageTrackingService, 'getUpgradeRecommendations').mockImplementation(async () => {
            return [];
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });
    /**
     * Property 7: Free Tier Usage Tracking
     * **Validates: Requirements 3.3, 3.5**
     * 
     * For any free tier user, the system should accurately track their monthly usage 
     * and reset counters at the beginning of each month.
     */
    test('Property 7: Free tier usage tracking accuracy', async () => {
        await fc.assert(fc.asyncProperty(
            userIdGenerator,
            fc.integer({ min: 1, max: FREEMIUM_CONFIG.monthlyAnalysisLimit }),
            async (userId, analysisCount) => {
                // Property: Usage tracking should be accurate and consistent

                // Initial state - user should have full limit available
                const initialStatus = await FreemiumController.checkFreeLimit(userId);
                expect(initialStatus.remainingAnalyses).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit);
                expect(initialStatus.eligible).toBe(true);
                expect(initialStatus.usedAnalyses).toBe(0);

                // Consume analyses one by one
                let expectedRemaining = FREEMIUM_CONFIG.monthlyAnalysisLimit;
                for (let i = 0; i < analysisCount; i++) {
                    const consumptionResult = await FreemiumController.consumeFreeAnalysis(userId, 'test');
                    expectedRemaining--;

                    expect(consumptionResult.success).toBe(true);
                    expect(consumptionResult.remainingAnalyses).toBe(expectedRemaining);
                    expect(consumptionResult.paymentMethod).toBe('free_tier');
                    expect(consumptionResult.cost).toBe(0);

                    // Verify status is consistent
                    const currentStatus = await FreemiumController.checkFreeLimit(userId);
                    expect(currentStatus.remainingAnalyses).toBe(expectedRemaining);
                    expect(currentStatus.usedAnalyses).toBe(i + 1);
                    expect(currentStatus.eligible).toBe(expectedRemaining > 0);
                }

                // Final verification
                const finalStatus = await FreemiumController.checkFreeLimit(userId);
                expect(finalStatus.usedAnalyses).toBe(analysisCount);
                expect(finalStatus.remainingAnalyses).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit - analysisCount);
            }
        ), propertyTestConfig);
    }, 15000);

    /**
     * Property: Free Limit Enforcement
     * 
     * For any user who has exhausted their free limit, the system should prevent 
     * further analyses and provide upgrade recommendations.
     */
    test('Property: Free limit enforcement consistency', async () => {
        await fc.assert(fc.asyncProperty(
            userIdGenerator,
            analysisTypeGenerator,
            async (userId, analysisType) => {
                // Exhaust the user's free limit
                for (let i = 0; i < FREEMIUM_CONFIG.monthlyAnalysisLimit; i++) {
                    await FreemiumController.consumeFreeAnalysis(userId, analysisType);
                }

                // Verify limit is exhausted
                const limitStatus = await FreemiumController.checkFreeLimit(userId);
                expect(limitStatus.remainingAnalyses).toBe(0);
                expect(limitStatus.eligible).toBe(false);
                expect(limitStatus.usedAnalyses).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit);

                // Attempt to consume another analysis should fail
                const failedConsumption = await FreemiumController.consumeFreeAnalysis(userId, analysisType);
                expect(failedConsumption.success).toBe(false);
                expect(failedConsumption.reason).toBe('free_limit_exceeded');
                expect(failedConsumption.upgradeRecommendations).toBeDefined();
                expect(Array.isArray(failedConsumption.upgradeRecommendations)).toBe(true);

                // Status should remain unchanged after failed consumption
                const statusAfterFail = await FreemiumController.checkFreeLimit(userId);
                expect(statusAfterFail.remainingAnalyses).toBe(0);
                expect(statusAfterFail.usedAnalyses).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit);
            }
        ), propertyTestConfig);
    }, 15000);

    /**
     * Property: Upgrade Recommendations Consistency
     * 
     * For any user requesting upgrade recommendations, the system should provide 
     * valid, consistent pricing options with accurate calculations.
     */
    test('Property: Upgrade recommendations consistency', async () => {
        await fc.assert(fc.asyncProperty(
            userIdGenerator,
            async (userId) => {
                const recommendations = await FreemiumController.getUpgradeRecommendations(userId);

                // Property: All recommendations should be valid and consistent
                expect(Array.isArray(recommendations)).toBe(true);
                expect(recommendations.length).toBeGreaterThan(0);

                for (const recommendation of recommendations) {
                    // Each recommendation should have required fields
                    expect(recommendation.type).toMatch(/^(credit|subscription)$/);
                    expect(recommendation.id).toBeDefined();
                    expect(recommendation.title).toBeDefined();
                    expect(recommendation.description).toBeDefined();
                    expect(typeof recommendation.price).toBe('number');
                    expect(recommendation.price).toBeGreaterThan(0);

                    if (recommendation.type === 'credit') {
                        expect(typeof recommendation.credits).toBe('number');
                        expect(recommendation.credits).toBeGreaterThan(0);
                        expect(typeof recommendation.costPerAnalysis).toBe('number');
                        expect(recommendation.costPerAnalysis).toBeGreaterThan(0);
                    }

                    if (recommendation.type === 'subscription') {
                        expect(typeof recommendation.analysisLimit).toBe('number');
                        expect(Array.isArray(recommendation.features)).toBe(true);
                        expect(recommendation.features.length).toBeGreaterThan(0);
                    }
                }
            }
        ), propertyTestConfig);
    }, 10000);

    /**
     * Property: Monthly Reset Idempotency
     * 
     * Monthly reset operations should be idempotent and not cause data corruption
     * when called multiple times.
     */
    test('Property: Monthly reset idempotency', async () => {
        await fc.assert(fc.asyncProperty(
            fc.array(userIdGenerator, { minLength: 1, maxLength: 3 }),
            async (userIds) => {
                // Set up users with some usage
                for (const userId of userIds) {
                    const analysesToConsume = Math.floor(Math.random() * FREEMIUM_CONFIG.monthlyAnalysisLimit);
                    for (let i = 0; i < analysesToConsume; i++) {
                        await FreemiumController.consumeFreeAnalysis(userId, 'test');
                    }
                }

                // Perform reset multiple times (should be idempotent)
                await FreemiumController.resetMonthlyLimits();
                await FreemiumController.resetMonthlyLimits();
                await FreemiumController.resetMonthlyLimits();

                // Verify all users have full limits after reset
                for (const userId of userIds) {
                    const statusAfter = await FreemiumController.checkFreeLimit(userId);
                    expect(statusAfter.remainingAnalyses).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit);
                    expect(statusAfter.usedAnalyses).toBe(0);
                    expect(statusAfter.eligible).toBe(true);
                }
            }
        ), propertyTestConfig);
    }, 15000);
});