/**
 * Property-Based Tests for Usage Tracker Service
 * 
 * Tests universal properties that should hold across all valid inputs
 * Feature: ai-monetization-system, Property 13: Usage Report Accuracy
 */

const fc = require('fast-check');

// Mock Firebase Admin before importing other modules
jest.mock('firebase-admin', () => {
    const mockTimestamp = {
        now: jest.fn(() => ({ toDate: () => new Date(), seconds: Date.now() / 1000 })),
        fromDate: jest.fn((date) => ({ toDate: () => date, seconds: date.getTime() / 1000 }))
    };

    // Chainable query mock
    const mockQueryResult = () => Promise.resolve({ docs: [] });
    const chainableQuery = () => ({
        where: jest.fn(() => chainableQuery()),
        orderBy: jest.fn(() => chainableQuery()),
        limit: jest.fn(() => chainableQuery()),
        get: jest.fn(mockQueryResult)
    });

    const firestoreFn = jest.fn(() => ({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn(() => Promise.resolve({ exists: false })),
                    set: jest.fn(() => Promise.resolve())
                })),
                where: jest.fn(() => chainableQuery()),
                get: jest.fn(mockQueryResult)
            })),
            runTransaction: jest.fn((callback) => callback({
                get: jest.fn(() => Promise.resolve({ exists: false, data: () => ({}) })),
                set: jest.fn(() => Promise.resolve())
            }))
        }));
    firestoreFn.Timestamp = mockTimestamp;

    return {
        firestore: firestoreFn,
        Timestamp: mockTimestamp,
        apps: [],
        initializeApp: jest.fn()
    };
});

// Mock other services
jest.mock('../../services/CreditSystem', () => ({
    CreditSystem: {
        getCreditBalance: jest.fn(() => Promise.resolve(100))
    }
}));

jest.mock('../../services/SubscriptionManager', () => ({
    SubscriptionManager: {
        getSubscriptionStatus: jest.fn(() => Promise.resolve({ active: false }))
    }
}));

jest.mock('../../services/FreemiumController', () => ({
    FreemiumController: {
        checkFreeLimit: jest.fn(() => Promise.resolve({
            eligible: true,
            remainingAnalyses: 5,
            resetDate: new Date()
        }))
    }
}));

const { UsageTracker, UsageStats, UsageReport, LimitCheckResult, CostEstimate } = require('../../services/UsageTracker');
const { PAYMENT_METHODS, ANALYSIS_TYPES } = require('../../models/UsageRecord');

// Test configuration
const propertyTestConfig = {
    numRuns: 50, // Reduced for faster testing
    verbose: false,
    seed: 42,
    endOnFailure: true
};

// Custom generators
const userIdGenerator = fc.string({ minLength: 10, maxLength: 30 });
const analysisTypeGenerator = fc.constantFrom(...Object.values(ANALYSIS_TYPES));
const paymentMethodGenerator = fc.constantFrom(...Object.values(PAYMENT_METHODS));
const costGenerator = fc.integer({ min: 1, max: 100 });

describe('UsageTracker Property Tests', () => {
    let testUserId;

    beforeEach(() => {
        testUserId = `test_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        jest.clearAllMocks();
    });
    describe('Property 13: Usage Report Accuracy', () => {
        /**
         * **Validates: Requirements 5.2**
         * 
         * For any time period and user, the system should generate accurate usage reports 
         * with correct cost breakdowns and analysis summaries.
         */
        test('usage report structure property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                async (userId) => {
                    // Mock the UsageRecordService
                    const mockStats = {
                        totalAnalyses: 10,
                        totalCost: 50,
                        totalTokensUsed: 1000,
                        cachedResults: 2,
                        byAnalysisType: {},
                        byPaymentMethod: {},
                        costBreakdown: {}
                    };

                    // Mock the service method
                    const { UsageRecordService } = require('../../models/UsageRecord');
                    UsageRecordService.getStatsByUser = jest.fn().mockResolvedValue(mockStats);

                    // Test: Generate usage report
                    const startDate = new Date('2024-01-01');
                    const endDate = new Date();

                    const report = await UsageTracker.generateUsageReport(userId, startDate, endDate);

                    // Property: Report should have correct structure
                    expect(report).toBeInstanceOf(UsageReport);
                    expect(report.userId).toBe(userId);
                    expect(report.startDate).toEqual(startDate);
                    expect(report.endDate).toEqual(endDate);
                    expect(report.stats).toBeInstanceOf(UsageStats);
                    expect(Array.isArray(report.records)).toBe(true);
                    expect(Array.isArray(report.recommendations)).toBe(true);

                    return true;
                }
            ), propertyTestConfig);
        });

        test('usage statistics consistency property', async () => {
            await fc.assert(fc.asyncProperty(
                fc.integer({ min: 0, max: 100 }),
                fc.integer({ min: 0, max: 1000 }),
                fc.integer({ min: 0, max: 50 }),
                async (totalAnalyses, totalCost, cachedResults) => {
                    // Mock consistent data
                    const mockStats = {
                        totalAnalyses,
                        totalCost,
                        totalTokensUsed: totalAnalyses * 100,
                        cachedResults: Math.min(cachedResults, totalAnalyses),
                        byAnalysisType: {},
                        byPaymentMethod: {},
                        costBreakdown: {}
                    };

                    const { UsageRecordService } = require('../../models/UsageRecord');
                    UsageRecordService.getStatsByUser = jest.fn().mockResolvedValue(mockStats);

                    // Test: Get usage statistics
                    const stats = await UsageTracker.getUsageStats(testUserId, 'current_month');

                    // Property: Statistics should be internally consistent
                    expect(stats.totalAnalyses).toBeGreaterThanOrEqual(0);
                    expect(stats.totalCost).toBeGreaterThanOrEqual(0);
                    expect(stats.totalTokensUsed).toBeGreaterThanOrEqual(0);
                    expect(stats.cachedResults).toBeGreaterThanOrEqual(0);
                    expect(stats.cachedResults).toBeLessThanOrEqual(stats.totalAnalyses);

                    return true;
                }
            ), propertyTestConfig);
        });
    });

    describe('Usage Recording Properties', () => {
        test('usage recording consistency property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisTypeGenerator,
                costGenerator,
                paymentMethodGenerator,
                async (userId, analysisType, cost, paymentMethod) => {
                    // Mock the UsageRecordService.create method
                    const { UsageRecordService } = require('../../models/UsageRecord');
                    UsageRecordService.create = jest.fn().mockResolvedValue({
                        id: 'mock_id',
                        userId,
                        analysisType,
                        cost,
                        paymentMethod,
                        timestamp: { toDate: () => new Date() }
                    });

                    // Test: Record usage
                    const result = await UsageTracker.recordUsage(
                        userId,
                        analysisType,
                        cost,
                        paymentMethod
                    );

                    // Property: Recording should always succeed with valid inputs
                    expect(result.success).toBe(true);
                    expect(result.usageId).toBeDefined();
                    expect(result.timestamp).toBeInstanceOf(Date);

                    return true;
                }
            ), propertyTestConfig);
        });

        test('cost estimation consistency property', async () => {
            await fc.assert(fc.asyncProperty(
                analysisTypeGenerator,
                fc.integer({ min: 1, max: 1000 }),
                async (analysisType, dataSize) => {
                    // Test: Estimate cost
                    const estimate = await UsageTracker.estimateCost(analysisType, dataSize);

                    // Property: Cost estimates should be consistent and reasonable
                    expect(estimate).toBeInstanceOf(CostEstimate);
                    expect(estimate.estimatedCost).toBeGreaterThan(0);
                    expect(estimate.currency).toBe('credits');
                    expect(Array.isArray(estimate.factors)).toBe(true);
                    expect(estimate.breakdown).toBeDefined();

                    // Verify cost increases with data size
                    const largerEstimate = await UsageTracker.estimateCost(analysisType, dataSize * 2);
                    expect(largerEstimate.estimatedCost).toBeGreaterThanOrEqual(estimate.estimatedCost);

                    return true;
                }
            ), propertyTestConfig);
        });
    });

    describe('Usage Limit Properties', () => {
        test('limit check consistency property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisTypeGenerator,
                async (userId, analysisType) => {
                    // Test: Check usage limits
                    const limitCheck = await UsageTracker.checkUsageLimit(userId, analysisType);

                    // Property: Limit checks should always return valid results
                    expect(limitCheck).toBeInstanceOf(LimitCheckResult);
                    expect(typeof limitCheck.allowed).toBe('boolean');

                    if (!limitCheck.allowed) {
                        expect(limitCheck.reason).toBeDefined();
                        expect(typeof limitCheck.reason).toBe('string');
                    }

                    return true;
                }
            ), propertyTestConfig);
        });
    });

    describe('Notification Properties', () => {
        test('usage notifications consistency property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                async (userId) => {
                    // Test: Get usage notifications
                    const notifications = await UsageTracker.getUsageNotifications(userId);

                    // Property: Notifications should be well-formed
                    expect(Array.isArray(notifications)).toBe(true);

                    notifications.forEach(notification => {
                        expect(notification.type).toBeDefined();
                        expect(notification.category).toBeDefined();
                        expect(notification.message).toBeDefined();
                        expect(typeof notification.message).toBe('string');
                        expect(notification.priority).toBeDefined();
                        expect(['high', 'medium', 'low']).toContain(notification.priority);
                    });

                    // Verify notifications are sorted by priority
                    const priorityOrder = { high: 3, medium: 2, low: 1 };
                    for (let i = 1; i < notifications.length; i++) {
                        const currentPriority = priorityOrder[notifications[i].priority];
                        const previousPriority = priorityOrder[notifications[i - 1].priority];
                        expect(currentPriority).toBeLessThanOrEqual(previousPriority);
                    }

                    return true;
                }
            ), propertyTestConfig);
        });
    });
});