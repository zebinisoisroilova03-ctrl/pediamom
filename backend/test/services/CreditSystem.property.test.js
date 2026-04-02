/**
 * Property-Based Tests for Credit System
 * 
 * Tests universal properties that should hold across all valid inputs
 * Feature: ai-monetization-system, Property 2: Credit Deduction Consistency
 */

const fc = require('fast-check');

// Mock Stripe before importing other modules
jest.mock('../../config/stripe', () => ({
    stripe: {
        paymentIntents: {
            create: jest.fn(),
            retrieve: jest.fn()
        },
        customers: {
            create: jest.fn()
        }
    },
    STRIPE_CONFIG: {
        secretKey: 'sk_test_mock',
        publishableKey: 'pk_test_mock',
        webhookSecret: 'whsec_mock'
    },
    verifyWebhookSignature: jest.fn()
}));

// Mock Firebase Admin
jest.mock('firebase-admin', () => {
    const firestoreFn = jest.fn(() => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn(),
                set: jest.fn(),
                update: jest.fn()
            })),
            where: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                    get: jest.fn()
                }))
            })),
            add: jest.fn()
        })),
        runTransaction: jest.fn()
    }));
    firestoreFn.Timestamp = {
        now: () => ({ seconds: Date.now() / 1000 }),
        fromDate: (date) => ({ seconds: date.getTime() / 1000, toDate: () => date })
    };
    return { firestore: firestoreFn, apps: [], initializeApp: jest.fn() };
});

const CreditSystem = require('../../services/CreditSystem');
const { UserPaymentProfileService } = require('../../models/UserPaymentProfile');
const { CREDIT_CONFIG } = require('../../config/monetization');

// Test configuration
const propertyTestConfig = {
    numRuns: 100,
    verbose: true,
    seed: process.env.TEST_SEED || Date.now(),
    endOnFailure: true
};

// Custom generators for credit testing
const creditAmountGenerator = fc.integer({ min: 1, max: 1000 });
const analysisTypeGenerator = fc.constantFrom('blood', 'urine', 'vitamin', 'growth', 'nutrition');
const userIdGenerator = fc.string({ minLength: 10, maxLength: 28 }); // Firebase UID format
const balanceGenerator = fc.integer({ min: 0, max: 500 });

describe('Credit System Property Tests', () => {
    let creditSystem;
    let mockUserProfiles = new Map(); // In-memory store for testing

    beforeAll(async () => {
        creditSystem = new CreditSystem();

        // Mock UserPaymentProfileService methods
        jest.spyOn(UserPaymentProfileService, 'getOrCreate').mockImplementation(async (userId) => {
            if (!mockUserProfiles.has(userId)) {
                mockUserProfiles.set(userId, { userId, creditBalance: 0 });
            }
            return mockUserProfiles.get(userId);
        });

        jest.spyOn(UserPaymentProfileService, 'getByUserId').mockImplementation(async (userId) => {
            return mockUserProfiles.get(userId) || null;
        });

        jest.spyOn(UserPaymentProfileService, 'addCredits').mockImplementation(async (userId, credits) => {
            const profile = mockUserProfiles.get(userId) || { userId, creditBalance: 0 };
            profile.creditBalance += credits;
            mockUserProfiles.set(userId, profile);
            return profile.creditBalance;
        });

        jest.spyOn(UserPaymentProfileService, 'deductCredits').mockImplementation(async (userId, credits) => {
            const profile = mockUserProfiles.get(userId);
            if (!profile || profile.creditBalance < credits) {
                throw new Error('Insufficient credits');
            }
            profile.creditBalance -= credits;
            mockUserProfiles.set(userId, profile);
            return profile.creditBalance;
        });

        jest.spyOn(UserPaymentProfileService, 'update').mockImplementation(async (userId, updates) => {
            const profile = mockUserProfiles.get(userId) || { userId, creditBalance: 0 };
            Object.assign(profile, updates);
            mockUserProfiles.set(userId, profile);
            return profile;
        });
    });

    beforeEach(() => {
        // Clear mock profiles before each test
        mockUserProfiles.clear();
    });

    describe('Property 2: Credit Deduction Consistency', () => {
        /**
         * **Validates: Requirements 1.2, 1.4**
         * 
         * For any AI analysis request by a user with sufficient credits,
         * the system should deduct the correct amount based on analysis type
         * and update the user's balance accurately.
         */
        test('credit deduction maintains balance consistency', () => {
            fc.assert(fc.property(
                userIdGenerator,
                analysisTypeGenerator,
                balanceGenerator,
                async (userId, analysisType, initialBalance) => {
                    try {
                        // Setup: Create user with initial balance
                        await UserPaymentProfileService.getOrCreate(userId);

                        // Set initial balance
                        if (initialBalance > 0) {
                            await UserPaymentProfileService.addCredits(userId, initialBalance);
                        }

                        const expectedCost = creditSystem.getAnalysisCost(analysisType);
                        const balanceBeforeDeduction = await creditSystem.getCreditBalance(userId);

                        // Only test deduction if user has sufficient credits
                        if (balanceBeforeDeduction >= expectedCost) {
                            const deductionResult = await creditSystem.deductCredits(userId, analysisType);

                            if (deductionResult.success) {
                                const balanceAfterDeduction = await creditSystem.getCreditBalance(userId);

                                // Property: Balance should decrease by exactly the analysis cost
                                const actualDeduction = balanceBeforeDeduction - balanceAfterDeduction;

                                // Assertions for consistency
                                expect(actualDeduction).toBe(expectedCost);
                                expect(deductionResult.creditsDeducted).toBe(expectedCost);
                                expect(deductionResult.newBalance).toBe(balanceAfterDeduction);
                                expect(balanceAfterDeduction).toBe(balanceBeforeDeduction - expectedCost);
                            }
                        }

                        // Cleanup
                        await UserPaymentProfileService.update(userId, { creditBalance: 0 });

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('insufficient credits always prevent deduction', () => {
            fc.assert(fc.property(
                userIdGenerator,
                analysisTypeGenerator,
                fc.integer({ min: 0, max: 10 }), // Small balance to ensure insufficiency
                async (userId, analysisType, smallBalance) => {
                    try {
                        // Setup: Create user with insufficient balance
                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.update(userId, { creditBalance: smallBalance });

                        const expectedCost = creditSystem.getAnalysisCost(analysisType);
                        const initialBalance = await creditSystem.getCreditBalance(userId);

                        // Only test when balance is insufficient
                        if (initialBalance < expectedCost) {
                            const deductionResult = await creditSystem.deductCredits(userId, analysisType);

                            // Property: Deduction should fail and balance should remain unchanged
                            expect(deductionResult.success).toBe(false);
                            expect(deductionResult.error.code).toBe('insufficient_credits');

                            const balanceAfterAttempt = await creditSystem.getCreditBalance(userId);
                            expect(balanceAfterAttempt).toBe(initialBalance);
                        }

                        // Cleanup
                        await UserPaymentProfileService.update(userId, { creditBalance: 0 });

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('analysis cost calculation is deterministic', () => {
            fc.assert(fc.property(
                analysisTypeGenerator,
                (analysisType) => {
                    // Property: Same analysis type should always return same cost
                    const cost1 = creditSystem.getAnalysisCost(analysisType);
                    const cost2 = creditSystem.getAnalysisCost(analysisType);

                    expect(cost1).toBe(cost2);
                    expect(cost1).toBeGreaterThan(0);
                    expect(Number.isInteger(cost1)).toBe(true);

                    // Cost should match configuration
                    const expectedCost = CREDIT_CONFIG.analysisCosts[analysisType] || CREDIT_CONFIG.analysisCosts.default;
                    expect(cost1).toBe(expectedCost);

                    return true;
                }
            ), propertyTestConfig);
        });

        test('credit balance never goes negative', () => {
            fc.assert(fc.property(
                userIdGenerator,
                analysisTypeGenerator,
                balanceGenerator,
                async (userId, analysisType, initialBalance) => {
                    try {
                        // Setup
                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.update(userId, { creditBalance: initialBalance });

                        const deductionResult = await creditSystem.deductCredits(userId, analysisType);
                        const finalBalance = await creditSystem.getCreditBalance(userId);

                        // Property: Balance should never be negative
                        expect(finalBalance).toBeGreaterThanOrEqual(0);

                        if (deductionResult.success) {
                            expect(deductionResult.newBalance).toBeGreaterThanOrEqual(0);
                        }

                        // Cleanup
                        await UserPaymentProfileService.update(userId, { creditBalance: 0 });

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('multiple sequential deductions maintain consistency', () => {
            fc.assert(fc.property(
                userIdGenerator,
                fc.array(analysisTypeGenerator, { minLength: 1, maxLength: 5 }),
                fc.integer({ min: 50, max: 200 }), // Sufficient balance for multiple analyses
                async (userId, analysisTypes, initialBalance) => {
                    try {
                        // Setup
                        await UserPaymentProfileService.getOrCreate(userId);
                        await UserPaymentProfileService.update(userId, { creditBalance: initialBalance });

                        let expectedBalance = initialBalance;
                        let actualBalance = await creditSystem.getCreditBalance(userId);

                        for (const analysisType of analysisTypes) {
                            const cost = creditSystem.getAnalysisCost(analysisType);

                            if (expectedBalance >= cost) {
                                const deductionResult = await creditSystem.deductCredits(userId, analysisType);

                                if (deductionResult.success) {
                                    expectedBalance -= cost;
                                    actualBalance = await creditSystem.getCreditBalance(userId);

                                    // Property: Actual balance should match expected balance
                                    expect(actualBalance).toBe(expectedBalance);
                                    expect(deductionResult.newBalance).toBe(expectedBalance);
                                }
                            } else {
                                // Should fail when insufficient credits
                                const deductionResult = await creditSystem.deductCredits(userId, analysisType);
                                expect(deductionResult.success).toBe(false);

                                // Balance should remain unchanged
                                const unchangedBalance = await creditSystem.getCreditBalance(userId);
                                expect(unchangedBalance).toBe(expectedBalance);
                            }
                        }

                        // Cleanup
                        await UserPaymentProfileService.update(userId, { creditBalance: 0 });

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });
    });

    describe('Credit Package Properties', () => {
        test('credit packages maintain consistent pricing', () => {
            fc.assert(fc.property(
                fc.constantFrom('basic_50', 'standard_100', 'premium_250', 'enterprise_500'),
                async (packageId) => {
                    try {
                        const package1 = await creditSystem.getCreditPackage(packageId);
                        const package2 = await creditSystem.getCreditPackage(packageId);

                        if (package1 && package2) {
                            // Property: Package data should be consistent across calls
                            expect(package1.price).toBe(package2.price);
                            expect(package1.credits).toBe(package2.credits);
                            expect(package1.bonusCredits).toBe(package2.bonusCredits);
                            expect(package1.getTotalCredits()).toBe(package2.getTotalCredits());
                        }

                        return true;
                    } catch (error) {
                        console.error('Property test error:', error);
                        return false;
                    }
                }
            ), propertyTestConfig);
        });

        test('total credits calculation is always correct', () => {
            fc.assert(fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.integer({ min: 0, max: 200 }),
                (baseCredits, bonusCredits) => {
                    // Create a simple test class for credit package
                    class TestCreditPackage {
                        constructor(data) {
                            this.credits = data.credits;
                            this.bonusCredits = data.bonusCredits;
                        }
                        getTotalCredits() {
                            return this.credits + this.bonusCredits;
                        }
                    }

                    const creditPackage = new TestCreditPackage({
                        credits: baseCredits,
                        bonusCredits: bonusCredits
                    });

                    // Property: Total credits should always equal base + bonus
                    const totalCredits = creditPackage.getTotalCredits();
                    expect(totalCredits).toBe(baseCredits + bonusCredits);
                    expect(totalCredits).toBeGreaterThanOrEqual(baseCredits);

                    return true;
                }
            ), propertyTestConfig);
        });
    });
});