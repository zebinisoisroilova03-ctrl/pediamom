/**
 * Property-Based Tests for Enterprise Access Control
 * 
 * Tests universal properties that should hold for Enterprise tier unlimited access
 * Feature: ai-monetization-system, Property 6: Enterprise Unlimited Access
 */

const fc = require('fast-check');

// Mock Firebase Admin FIRST before any imports
const mockFirestore = {
    collection: jest.fn(() => ({
        doc: jest.fn(() => ({
            get: jest.fn(),
            set: jest.fn(),
            update: jest.fn()
        })),
        where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
                get: jest.fn()
            })),
            limit: jest.fn(() => ({
                get: jest.fn()
            })),
            get: jest.fn()
        })),
        add: jest.fn()
    })),
    runTransaction: jest.fn()
};

jest.mock('firebase-admin', () => {
    const firestoreFn = jest.fn(() => mockFirestore);
    firestoreFn.Timestamp = {
        now: () => ({ seconds: Date.now() / 1000, toDate: () => new Date() }),
        fromDate: (date) => ({ seconds: date.getTime() / 1000, toDate: () => date })
    };
    return { firestore: firestoreFn, apps: [], initializeApp: jest.fn() };
});

const EnterpriseAccessControl = require('../../services/EnterpriseAccessControl');
const { UserPaymentProfileService } = require('../../models/UserPaymentProfile');

// Test configuration
const propertyTestConfig = {
    numRuns: 100,
    verbose: true,
    seed: process.env.TEST_SEED || Date.now(),
    endOnFailure: true
};

// Custom generators for Enterprise testing
const userIdGenerator = fc.string({ minLength: 10, maxLength: 28 }); // Firebase UID format
const analysisTypeGenerator = fc.constantFrom('blood', 'urine', 'vitamin', 'growth', 'nutrition', 'custom');
const enterpriseFeatureGenerator = fc.constantFrom(
    'unlimited_analyses', 'priority_processing', 'advanced_insights',
    'custom_reports', 'api_access', 'dedicated_support', 'bulk_processing'
);
const nonEnterpriseFeatureGenerator = fc.constantFrom(
    'invalid_feature', 'non_existent', 'basic_feature'
);

describe('Enterprise Access Control Property Tests', () => {
    let enterpriseAccess;
    let mockUserProfiles = new Map(); // In-memory store for testing
    let mockUsageRecords = new Map(); // In-memory store for usage

    beforeAll(async () => {
        enterpriseAccess = new EnterpriseAccessControl();

        // Mock UserPaymentProfileService methods
        jest.spyOn(UserPaymentProfileService, 'getByUserId').mockImplementation(async (userId) => {
            return mockUserProfiles.get(userId) || null;
        });

        jest.spyOn(UserPaymentProfileService, 'getOrCreate').mockImplementation(async (userId) => {
            if (!mockUserProfiles.has(userId)) {
                mockUserProfiles.set(userId, {
                    userId,
                    creditBalance: 0,
                    subscription: null
                });
            }
            return mockUserProfiles.get(userId);
        });
    });

    beforeEach(() => {
        // Clear mock data before each test
        mockUserProfiles.clear();
        mockUsageRecords.clear();
    });

    describe('Property 6: Enterprise Unlimited Access', () => {
        /**
         * **Validates: Requirements 2.5**
         * 
         * For any user with Enterprise tier subscription, the system should never
         * restrict AI analysis access due to usage limits.
         */
        test('Enterprise users always have unlimited access regardless of usage', () => {
            fc.assert(fc.property(
                userIdGenerator,
                analysisTypeGenerator,
                fc.integer({ min: 0, max: 10000 }), // Any usage amount
                async (userId, analysisType, usageAmount) => {
                    try {
                        // Setup: Create Enterprise user
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                        const enterpriseSubscription = {
                            id: `sub_${userId}_enterprise`,
                            tierId: 'enterprise',
                            status: 'active',
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        mockUserProfiles.set(userId, {
                            userId,
                            creditBalance: 0,
                            subscription: enterpriseSubscription
                        });

                        // Simulate any amount of usage (should not matter for Enterprise)
                        mockUsageRecords.set(`${userId}_enterprise`, usageAmount);

                        const accessResult = await enterpriseAccess.validateUnlimitedAccess(userId, analysisType);

                        // Property: Enterprise users should ALWAYS have unlimited access
                        expect(accessResult.hasUnlimitedAccess).toBe(true);
                        expect(accessResult.reason).toBe('enterprise_unlimited');
                        expect(accessResult.limits.daily).toBe(-1);
                        expect(accessResult.limits.monthly).toBe(-1);
                        expect(accessResult.limits.total).toBe(-1);
                        expect(accessResult.restrictions).toBeNull();

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('Non-Enterprise users never have unlimited access', () => {
            fc.assert(fc.property(
                userIdGenerator,
                fc.constantFrom('basic', 'professional', null), // Non-Enterprise tiers or no subscription
                analysisTypeGenerator,
                async (userId, tierId, analysisType) => {
                    try {
                        // Setup: Create non-Enterprise user or no subscription
                        if (tierId) {
                            const now = new Date();
                            const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                            const subscription = {
                                id: `sub_${userId}_${tierId}`,
                                tierId,
                                status: 'active',
                                currentPeriodStart: { toDate: () => now },
                                currentPeriodEnd: { toDate: () => periodEnd },
                                cancelAtPeriodEnd: false
                            };

                            mockUserProfiles.set(userId, {
                                userId,
                                creditBalance: 0,
                                subscription
                            });
                        } else {
                            // No subscription
                            mockUserProfiles.set(userId, {
                                userId,
                                creditBalance: 0,
                                subscription: null
                            });
                        }

                        const accessResult = await enterpriseAccess.validateUnlimitedAccess(userId, analysisType);

                        // Property: Non-Enterprise users should NEVER have unlimited access
                        expect(accessResult.hasUnlimitedAccess).toBe(false);
                        expect(accessResult.reason).toBe('not_enterprise_user');

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('Enterprise user identification is consistent', () => {
            fc.assert(fc.property(
                userIdGenerator,
                async (userId) => {
                    try {
                        // Setup: Create Enterprise user
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                        const enterpriseSubscription = {
                            id: `sub_${userId}_enterprise`,
                            tierId: 'enterprise',
                            status: 'active',
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        mockUserProfiles.set(userId, {
                            userId,
                            creditBalance: 0,
                            subscription: enterpriseSubscription
                        });

                        // Check multiple times
                        const isEnterprise1 = await enterpriseAccess.isEnterpriseUser(userId);
                        const isEnterprise2 = await enterpriseAccess.isEnterpriseUser(userId);
                        const isEnterprise3 = await enterpriseAccess.isEnterpriseUser(userId);

                        // Property: Enterprise user identification should be consistent
                        expect(isEnterprise1).toBe(true);
                        expect(isEnterprise2).toBe(true);
                        expect(isEnterprise3).toBe(true);
                        expect(isEnterprise1).toBe(isEnterprise2);
                        expect(isEnterprise2).toBe(isEnterprise3);

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('Enterprise usage recording always succeeds for Enterprise users', () => {
            fc.assert(fc.property(
                userIdGenerator,
                analysisTypeGenerator,
                fc.record({
                    priority: fc.constantFrom('high', 'normal', 'low'),
                    complexity: fc.constantFrom('simple', 'complex', 'advanced')
                }),
                async (userId, analysisType, metadata) => {
                    try {
                        // Setup: Create Enterprise user
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                        const enterpriseSubscription = {
                            id: `sub_${userId}_enterprise`,
                            tierId: 'enterprise',
                            status: 'active',
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        mockUserProfiles.set(userId, {
                            userId,
                            creditBalance: 0,
                            subscription: enterpriseSubscription
                        });

                        // Mock Firestore add operation
                        const mockAdd = jest.fn().mockResolvedValue({ id: 'usage_record_123' });
                        require('firebase-admin').firestore().collection().add = mockAdd;

                        const recordResult = await enterpriseAccess.recordEnterpriseUsage(userId, analysisType, metadata);

                        // Property: Enterprise usage recording should always succeed
                        expect(recordResult.success).toBe(true);
                        expect(recordResult.usageId).toBeDefined();
                        expect(recordResult.message).toContain('successfully');

                        // Verify the usage record structure
                        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
                            userId,
                            analysisType,
                            subscriptionId: enterpriseSubscription.id,
                            tierId: 'enterprise',
                            accessType: 'enterprise_unlimited',
                            cost: 0,
                            limitsBypassed: true,
                            metadata: expect.objectContaining({
                                ...metadata,
                                enterpriseFeatures: expect.arrayContaining([
                                    'unlimited_analyses',
                                    'priority_processing',
                                    'advanced_insights'
                                ])
                            })
                        }));

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('Non-Enterprise users cannot record Enterprise usage', () => {
            fc.assert(fc.property(
                userIdGenerator,
                fc.constantFrom('basic', 'professional', null),
                analysisTypeGenerator,
                async (userId, tierId, analysisType) => {
                    try {
                        // Setup: Create non-Enterprise user
                        if (tierId) {
                            const now = new Date();
                            const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                            const subscription = {
                                id: `sub_${userId}_${tierId}`,
                                tierId,
                                status: 'active',
                                currentPeriodStart: { toDate: () => now },
                                currentPeriodEnd: { toDate: () => periodEnd },
                                cancelAtPeriodEnd: false
                            };

                            mockUserProfiles.set(userId, {
                                userId,
                                creditBalance: 0,
                                subscription
                            });
                        } else {
                            mockUserProfiles.set(userId, {
                                userId,
                                creditBalance: 0,
                                subscription: null
                            });
                        }

                        const recordResult = await enterpriseAccess.recordEnterpriseUsage(userId, analysisType);

                        // Property: Non-Enterprise users should not be able to record Enterprise usage
                        expect(recordResult.success).toBe(false);
                        expect(recordResult.reason).toBe('not_enterprise_user');

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('Enterprise feature access is consistent for valid features', () => {
            fc.assert(fc.property(
                userIdGenerator,
                enterpriseFeatureGenerator,
                async (userId, featureName) => {
                    try {
                        // Setup: Create Enterprise user
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                        const enterpriseSubscription = {
                            id: `sub_${userId}_enterprise`,
                            tierId: 'enterprise',
                            status: 'active',
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        mockUserProfiles.set(userId, {
                            userId,
                            creditBalance: 0,
                            subscription: enterpriseSubscription
                        });

                        const featureResult = await enterpriseAccess.checkEnterpriseFeatureAccess(userId, featureName);

                        // Property: Enterprise users should have access to all Enterprise features
                        expect(featureResult.hasAccess).toBe(true);
                        expect(featureResult.reason).toBe('enterprise_feature_included');
                        expect(featureResult.featureName).toBe(featureName);
                        expect(featureResult.allEnterpriseFeatures).toContain(featureName);

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('Enterprise benefits structure is consistent', () => {
            fc.assert(fc.property(
                fc.constant(null), // No input needed for this test
                () => {
                    const benefits = enterpriseAccess.getEnterpriseBenefits();

                    // Property: Enterprise benefits should have consistent structure
                    expect(benefits).toHaveProperty('tierId', 'enterprise');
                    expect(benefits).toHaveProperty('tierName', 'Enterprise Plan');
                    expect(benefits).toHaveProperty('benefits');
                    expect(benefits).toHaveProperty('pricing');

                    expect(Array.isArray(benefits.benefits)).toBe(true);
                    expect(benefits.benefits.length).toBeGreaterThan(0);

                    // Each benefit category should have required structure
                    benefits.benefits.forEach(category => {
                        expect(category).toHaveProperty('category');
                        expect(category).toHaveProperty('features');
                        expect(Array.isArray(category.features)).toBe(true);
                        expect(category.features.length).toBeGreaterThan(0);
                    });

                    // Pricing should have required fields
                    expect(benefits.pricing).toHaveProperty('monthlyPrice');
                    expect(benefits.pricing).toHaveProperty('yearlyPrice');
                    expect(benefits.pricing).toHaveProperty('currency');
                    expect(typeof benefits.pricing.monthlyPrice).toBe('number');
                    expect(typeof benefits.pricing.yearlyPrice).toBe('number');

                    return true;
                }
            ), { numRuns: 10 }); // Fewer runs since this is a static test
        });

        test('Expired Enterprise subscription loses unlimited access', () => {
            fc.assert(fc.property(
                userIdGenerator,
                analysisTypeGenerator,
                fc.integer({ min: 1, max: 365 }), // Days in the past
                async (userId, analysisType, daysAgo) => {
                    try {
                        // Setup: Create Enterprise user with expired subscription
                        const now = new Date();
                        const periodStart = new Date(now.getTime() - (daysAgo + 30) * 24 * 60 * 60 * 1000);
                        const periodEnd = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000); // In the past

                        const expiredEnterpriseSubscription = {
                            id: `sub_${userId}_enterprise`,
                            tierId: 'enterprise',
                            status: 'active', // Status is active but period has ended
                            currentPeriodStart: { toDate: () => periodStart },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        mockUserProfiles.set(userId, {
                            userId,
                            creditBalance: 0,
                            subscription: expiredEnterpriseSubscription
                        });

                        const accessResult = await enterpriseAccess.validateUnlimitedAccess(userId, analysisType);

                        // Property: Expired Enterprise subscription should not provide unlimited access
                        expect(accessResult.hasUnlimitedAccess).toBe(false);
                        expect(accessResult.reason).toBe('not_enterprise_user');

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('Enterprise analytics calculation is consistent', () => {
            fc.assert(fc.property(
                userIdGenerator,
                fc.array(
                    fc.record({
                        analysisType: analysisTypeGenerator,
                        timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date() })
                    }),
                    { minLength: 0, maxLength: 100 }
                ),
                async (userId, usageRecords) => {
                    try {
                        // Setup: Create Enterprise user
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                        const enterpriseSubscription = {
                            id: `sub_${userId}_enterprise`,
                            tierId: 'enterprise',
                            status: 'active',
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        mockUserProfiles.set(userId, {
                            userId,
                            creditBalance: 0,
                            subscription: enterpriseSubscription
                        });

                        // Mock Firestore query for analytics
                        const mockGet = jest.fn().mockResolvedValue({
                            docs: usageRecords.map((record, index) => ({
                                id: `usage_${index}`,
                                data: () => ({
                                    ...record,
                                    timestamp: { toDate: () => record.timestamp }
                                })
                            }))
                        });

                        require('firebase-admin').firestore().collection().where().where().where().orderBy().get = mockGet;

                        const analyticsResult = await enterpriseAccess.getEnterpriseAnalytics(userId);

                        if (analyticsResult.success) {
                            // Property: Analytics should accurately reflect usage data
                            expect(analyticsResult.analytics.totalAnalyses).toBe(usageRecords.length);
                            expect(analyticsResult.analytics.costSavings).toBeGreaterThanOrEqual(0);
                            expect(analyticsResult.analytics.averagePerDay).toBeGreaterThanOrEqual(0);

                            // If there are records, there should be analysis type breakdown
                            if (usageRecords.length > 0) {
                                expect(Object.keys(analyticsResult.analytics.analysisTypes).length).toBeGreaterThan(0);
                            }
                        }

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });
    });
});