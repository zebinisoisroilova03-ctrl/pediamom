/**
 * Property-Based Tests for Subscription Manager
 * 
 * Tests universal properties that should hold across all subscription operations
 * Feature: ai-monetization-system, Property 4: Subscription Access Control
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
        add: jest.fn(() => Promise.resolve({ id: 'mock_doc_id' }))
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

// Mock Stripe before importing other modules
jest.mock('../../config/stripe', () => ({
    stripe: {
        paymentIntents: {
            create: jest.fn(),
            retrieve: jest.fn()
        },
        customers: {
            create: jest.fn()
        },
        paymentMethods: {
            attach: jest.fn()
        },
        subscriptions: {
            create: jest.fn(),
            update: jest.fn(),
            cancel: jest.fn()
        }
    },
    STRIPE_CONFIG: {
        secretKey: 'sk_test_mock',
        publishableKey: 'pk_test_mock',
        webhookSecret: 'whsec_mock'
    },
    verifyWebhookSignature: jest.fn()
}));

const SubscriptionManager = require('../../services/SubscriptionManager');
const { UserPaymentProfileService } = require('../../models/UserPaymentProfile');
const { SUBSCRIPTION_CONFIG } = require('../../config/monetization');

// Test configuration
const propertyTestConfig = {
    numRuns: 100,
    verbose: true,
    seed: process.env.TEST_SEED || Date.now(),
    endOnFailure: true
};

// Custom generators for subscription testing
const userIdGenerator = fc.string({ minLength: 10, maxLength: 28 }); // Firebase UID format
const tierIdGenerator = fc.constantFrom('basic', 'professional', 'enterprise');
const analysisTypeGenerator = fc.constantFrom('blood', 'urine', 'vitamin', 'growth', 'nutrition');
const subscriptionStatusGenerator = fc.constantFrom('active', 'canceled', 'past_due', 'incomplete');

// Generate subscription usage count within reasonable limits
const usageCountGenerator = fc.integer({ min: 0, max: 100 });

describe('Subscription Manager Property Tests', () => {
    let subscriptionManager;
    let mockUserProfiles = new Map(); // In-memory store for testing
    let mockSubscriptionTiers = new Map(); // In-memory store for tiers
    let mockUsageRecords = new Map(); // In-memory store for usage

    beforeAll(async () => {
        subscriptionManager = new SubscriptionManager();

        // Initialize mock subscription tiers
        SUBSCRIPTION_CONFIG.defaultTiers.forEach(tier => {
            mockSubscriptionTiers.set(tier.id, tier);
        });

        // Mock UserPaymentProfileService methods
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

        jest.spyOn(UserPaymentProfileService, 'getByUserId').mockImplementation(async (userId) => {
            return mockUserProfiles.get(userId) || null;
        });

        jest.spyOn(UserPaymentProfileService, 'updateSubscription').mockImplementation(async (userId, subscriptionData) => {
            const profile = mockUserProfiles.get(userId) || { userId, creditBalance: 0 };
            profile.subscription = subscriptionData;
            mockUserProfiles.set(userId, profile);
            return profile;
        });

        jest.spyOn(UserPaymentProfileService, 'update').mockImplementation(async (userId, updates) => {
            const profile = mockUserProfiles.get(userId) || { userId, creditBalance: 0 };
            Object.assign(profile, updates);
            mockUserProfiles.set(userId, profile);
            return profile;
        });

        // Mock SubscriptionManager methods that interact with Firestore
        jest.spyOn(subscriptionManager, 'getSubscriptionTier').mockImplementation(async (tierId) => {
            return mockSubscriptionTiers.get(tierId) || null;
        });

        jest.spyOn(subscriptionManager, 'getSubscriptionTiers').mockImplementation(async () => {
            return Array.from(mockSubscriptionTiers.values());
        });

        jest.spyOn(subscriptionManager, '_getCurrentPeriodUsage').mockImplementation(async (userId, subscription) => {
            const key = `${userId}_${subscription.id}`;
            return mockUsageRecords.get(key) || 0;
        });
    });

    beforeEach(() => {
        // Clear mock data before each test
        mockUserProfiles.clear();
        mockUsageRecords.clear();
    });

    describe('Property 4: Subscription Access Control', () => {
        /**
         * **Validates: Requirements 2.2, 2.4**
         * 
         * For any user with an active subscription, the system should allow AI analyses
         * within their tier limits and prevent access when limits are exceeded.
         */
        test('active subscription within limits always allows access', () => {
            fc.assert(fc.property(
                userIdGenerator,
                tierIdGenerator,
                analysisTypeGenerator,
                usageCountGenerator,
                async (userId, tierId, analysisType, currentUsage) => {
                    try {
                        const tier = mockSubscriptionTiers.get(tierId);
                        if (!tier) return true; // Skip if tier not found

                        // Setup: Create user with active subscription
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

                        const subscription = {
                            id: `sub_${userId}_${tierId}`,
                            tierId,
                            status: 'active',
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.updateSubscription(userId, subscription);

                        // Set current usage (only test when within limits or unlimited)
                        const isWithinLimits = tier.analysisLimit === -1 || currentUsage < tier.analysisLimit;
                        if (isWithinLimits) {
                            mockUsageRecords.set(`${userId}_${subscription.id}`, currentUsage);

                            const accessResult = await subscriptionManager.checkAnalysisAccess(userId, analysisType);

                            // Property: Active subscription within limits should always allow access
                            expect(accessResult.allowed).toBe(true);
                            expect(['subscription_active', 'enterprise_unlimited']).toContain(accessResult.reason);

                            if (tier.analysisLimit === -1) {
                                // Enterprise tier should have unlimited access
                                expect(accessResult.remainingAnalyses).toBe(-1);
                                expect(accessResult.accessType).toBe('enterprise');
                            } else {
                                // Regular tiers should show remaining analyses
                                expect(accessResult.remainingAnalyses).toBe(tier.analysisLimit - currentUsage);
                                expect(accessResult.currentUsage).toBe(currentUsage);
                                expect(accessResult.limit).toBe(tier.analysisLimit);
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

        test('subscription limit exceeded always prevents access', () => {
            fc.assert(fc.property(
                userIdGenerator,
                fc.constantFrom('basic', 'professional'), // Exclude enterprise (unlimited)
                analysisTypeGenerator,
                async (userId, tierId, analysisType) => {
                    try {
                        const tier = mockSubscriptionTiers.get(tierId);
                        if (!tier || tier.analysisLimit === -1) return true; // Skip unlimited tiers

                        // Setup: Create user with active subscription at limit
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

                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.updateSubscription(userId, subscription);

                        // Set usage at or above limit
                        const usageAtLimit = tier.analysisLimit;
                        mockUsageRecords.set(`${userId}_${subscription.id}`, usageAtLimit);

                        const accessResult = await subscriptionManager.checkAnalysisAccess(userId, analysisType);

                        // Property: Subscription at limit should prevent access
                        expect(accessResult.allowed).toBe(false);
                        expect(accessResult.reason).toBe('subscription_limit_exceeded');
                        expect(accessResult.suggestedAction).toBe('upgrade');
                        expect(accessResult.currentUsage).toBe(usageAtLimit);
                        expect(accessResult.limit).toBe(tier.analysisLimit);

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('inactive subscription always prevents access', () => {
            fc.assert(fc.property(
                userIdGenerator,
                tierIdGenerator,
                fc.constantFrom('canceled', 'past_due', 'incomplete'),
                analysisTypeGenerator,
                async (userId, tierId, inactiveStatus, analysisType) => {
                    try {
                        // Setup: Create user with inactive subscription
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                        const subscription = {
                            id: `sub_${userId}_${tierId}`,
                            tierId,
                            status: inactiveStatus,
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.updateSubscription(userId, subscription);

                        const accessResult = await subscriptionManager.checkAnalysisAccess(userId, analysisType);

                        // Property: Inactive subscription should always prevent access
                        expect(accessResult.allowed).toBe(false);
                        expect(accessResult.reason).toBe('no_active_subscription');
                        expect(accessResult.suggestedAction).toBe('subscribe');
                        expect(accessResult.subscriptionTiers).toBeDefined();

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('expired subscription always prevents access', () => {
            fc.assert(fc.property(
                userIdGenerator,
                tierIdGenerator,
                analysisTypeGenerator,
                fc.integer({ min: 1, max: 365 }), // Days in the past
                async (userId, tierId, analysisType, daysAgo) => {
                    try {
                        // Setup: Create user with expired subscription
                        const now = new Date();
                        const periodStart = new Date(now.getTime() - (daysAgo + 30) * 24 * 60 * 60 * 1000);
                        const periodEnd = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000); // In the past

                        const subscription = {
                            id: `sub_${userId}_${tierId}`,
                            tierId,
                            status: 'active', // Status is active but period has ended
                            currentPeriodStart: { toDate: () => periodStart },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.updateSubscription(userId, subscription);

                        const accessResult = await subscriptionManager.checkAnalysisAccess(userId, analysisType);

                        // Property: Expired subscription should prevent access
                        expect(accessResult.allowed).toBe(false);
                        expect(accessResult.reason).toBe('no_active_subscription');

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('no subscription always prevents access', () => {
            fc.assert(fc.property(
                userIdGenerator,
                analysisTypeGenerator,
                async (userId, analysisType) => {
                    try {
                        // Setup: Create user without subscription
                        await UserPaymentProfileService.getOrCreate(userId);

                        const accessResult = await subscriptionManager.checkAnalysisAccess(userId, analysisType);

                        // Property: No subscription should always prevent access
                        expect(accessResult.allowed).toBe(false);
                        expect(accessResult.reason).toBe('no_active_subscription');
                        expect(accessResult.suggestedAction).toBe('subscribe');
                        expect(accessResult.subscriptionTiers).toBeDefined();

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('subscription status consistency across multiple checks', () => {
            fc.assert(fc.property(
                userIdGenerator,
                tierIdGenerator,
                subscriptionStatusGenerator,
                usageCountGenerator,
                async (userId, tierId, status, usage) => {
                    try {
                        const tier = mockSubscriptionTiers.get(tierId);
                        if (!tier) return true;

                        // Setup: Create consistent subscription state
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                        const subscription = {
                            id: `sub_${userId}_${tierId}`,
                            tierId,
                            status,
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.updateSubscription(userId, subscription);
                        mockUsageRecords.set(`${userId}_${subscription.id}`, usage);

                        // Check access multiple times
                        const result1 = await subscriptionManager.checkAnalysisAccess(userId, 'blood');
                        const result2 = await subscriptionManager.checkAnalysisAccess(userId, 'urine');
                        const result3 = await subscriptionManager.checkAnalysisAccess(userId, 'vitamin');

                        // Property: Multiple access checks should return consistent results
                        expect(result1.allowed).toBe(result2.allowed);
                        expect(result2.allowed).toBe(result3.allowed);
                        expect(result1.reason).toBe(result2.reason);
                        expect(result2.reason).toBe(result3.reason);

                        if (result1.allowed && tier.analysisLimit !== -1) {
                            expect(result1.remainingAnalyses).toBe(result2.remainingAnalyses);
                            expect(result2.remainingAnalyses).toBe(result3.remainingAnalyses);
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

    describe('Subscription Status Properties', () => {
        test('subscription status reflects actual subscription state', () => {
            fc.assert(fc.property(
                userIdGenerator,
                tierIdGenerator,
                subscriptionStatusGenerator,
                usageCountGenerator,
                async (userId, tierId, status, usage) => {
                    try {
                        const tier = mockSubscriptionTiers.get(tierId);
                        if (!tier) return true;

                        // Setup subscription
                        const now = new Date();
                        const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                        const subscription = {
                            id: `sub_${userId}_${tierId}`,
                            tierId,
                            status,
                            currentPeriodStart: { toDate: () => now },
                            currentPeriodEnd: { toDate: () => periodEnd },
                            cancelAtPeriodEnd: false
                        };

                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.updateSubscription(userId, subscription);
                        mockUsageRecords.set(`${userId}_${subscription.id}`, usage);

                        const statusResult = await subscriptionManager.getSubscriptionStatus(userId);

                        // Property: Status should accurately reflect subscription state
                        expect(statusResult.tierId).toBe(tierId);
                        expect(statusResult.status).toBe(status);
                        expect(statusResult.analysisUsed).toBe(usage);
                        expect(statusResult.analysisLimit).toBe(tier.analysisLimit);
                        expect(statusResult.tierName).toBe(tier.name);
                        expect(statusResult.features).toEqual(tier.features);

                        // Active status should match subscription status and period
                        const expectedActive = status === 'active' && periodEnd > now;
                        expect(statusResult.active).toBe(expectedActive);

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('usage recording maintains consistency', () => {
            fc.assert(fc.property(
                userIdGenerator,
                tierIdGenerator,
                analysisTypeGenerator,
                async (userId, tierId, analysisType) => {
                    try {
                        // Setup active subscription
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

                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.updateSubscription(userId, subscription);

                        const initialUsage = mockUsageRecords.get(`${userId}_${subscription.id}`) || 0;

                        // Record usage
                        const recordResult = await subscriptionManager.recordSubscriptionUsage(userId, analysisType, {
                            testMetadata: 'property_test'
                        });

                        // Property: Usage recording should succeed for active subscriptions
                        expect(recordResult).toBe(true);

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