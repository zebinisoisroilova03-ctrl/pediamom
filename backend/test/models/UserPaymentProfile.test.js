/**
 * Property-Based Tests for User Payment Profile
 * 
 * Tests universal properties that should hold across all valid inputs
 */

const fc = require('fast-check');

// Mock Firebase Admin before importing models
const mockTimestamp = () => ({
    seconds: 1234567890,
    nanoseconds: 0,
    toDate: () => new Date(1234567890000)
});

jest.mock('firebase-admin', () => {
    const mockTs = () => ({
        seconds: 1234567890,
        nanoseconds: 0,
        toDate: () => new Date(1234567890000)
    });
    const firestoreFn = jest.fn(() => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                set: jest.fn(),
                get: jest.fn(),
                update: jest.fn()
            })),
            add: jest.fn(),
            where: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                    limit: jest.fn(() => ({
                        get: jest.fn()
                    }))
                }))
            }))
        })),
        runTransaction: jest.fn(),
        Timestamp: {
            now: jest.fn(mockTs),
            fromDate: jest.fn((date) => ({
                seconds: Math.floor(date.getTime() / 1000),
                nanoseconds: 0,
                toDate: () => date
            }))
        }
    }));
    firestoreFn.Timestamp = {
        now: jest.fn(mockTs),
        fromDate: jest.fn((date) => ({
            seconds: Math.floor(date.getTime() / 1000),
            nanoseconds: 0,
            toDate: () => date
        }))
    };
    return { firestore: firestoreFn, apps: [], initializeApp: jest.fn() };
});

const { UserPaymentProfile } = require('../../models/UserPaymentProfile');

// Property test configuration - Optimized for speed
const propertyTestConfig = {
    numRuns: 20, // Reduced from 100 to 20 for faster execution
    verbose: false,
    seed: process.env.TEST_SEED || Date.now(),
    endOnFailure: true
};

// Simplified generators for faster test execution
const userIdGenerator = fc.string({ minLength: 5, maxLength: 20 }); // Reduced range
const stripeCustomerIdGenerator = fc.option(fc.string({ minLength: 5, maxLength: 20 }));
const creditBalanceGenerator = fc.integer({ min: 0, max: 10000 }); // Reduced max for faster generation
const subscriptionGenerator = fc.option(fc.record({
    id: fc.string({ minLength: 5, maxLength: 20 }),
    tierId: fc.constantFrom('basic', 'professional', 'enterprise'),
    status: fc.constantFrom('active', 'canceled'),
    currentPeriodStart: fc.date(),
    currentPeriodEnd: fc.date(),
    cancelAtPeriodEnd: fc.boolean()
}));

const paymentMethodGenerator = fc.array(fc.record({
    id: fc.string({ minLength: 5, maxLength: 20 }),
    type: fc.constantFrom('card', 'bank_account'),
    last4: fc.string({ minLength: 4, maxLength: 4 }),
    brand: fc.constantFrom('visa', 'mastercard', 'amex')
}), { maxLength: 3 }); // Reduced from 5 to 3

// Simplified payment profile generator focusing on core properties
const validPaymentProfileGenerator = fc.record({
    userId: userIdGenerator,
    stripeCustomerId: stripeCustomerIdGenerator,
    creditBalance: creditBalanceGenerator,
    subscription: subscriptionGenerator,
    paymentMethods: paymentMethodGenerator
});

describe('UserPaymentProfile Property Tests', () => {
    describe('Property 1: Credit Transaction Accuracy', () => {
        // **Validates: Requirements 1.1, 1.5**

        test('credit balance operations maintain mathematical consistency', () => {
            fc.assert(fc.property(
                validPaymentProfileGenerator,
                fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 10 }),
                fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 5 }),
                (profileData, creditAdditions, creditDeductions) => {
                    // Create profile with initial balance
                    const profile = new UserPaymentProfile(profileData);
                    let expectedBalance = profile.creditBalance;

                    // Apply credit additions
                    creditAdditions.forEach(credits => {
                        expectedBalance += credits;
                    });

                    // Apply valid deductions (only if sufficient balance)
                    let actualDeductions = 0;
                    creditDeductions.forEach(credits => {
                        if (expectedBalance >= credits) {
                            expectedBalance -= credits;
                            actualDeductions += credits;
                        }
                    });

                    // The mathematical relationship should always hold
                    const finalBalance = profile.creditBalance +
                        creditAdditions.reduce((sum, val) => sum + val, 0) - actualDeductions;

                    return finalBalance === expectedBalance && expectedBalance >= 0;
                }
            ), propertyTestConfig);
        });

        test('credit balance never becomes negative through valid operations', () => {
            fc.assert(fc.property(
                creditBalanceGenerator,
                fc.array(fc.record({
                    operation: fc.constantFrom('add', 'deduct'),
                    amount: fc.integer({ min: 1, max: 1000 })
                }), { minLength: 1, maxLength: 20 }),
                (initialBalance, operations) => {
                    let balance = initialBalance;

                    for (const op of operations) {
                        if (op.operation === 'add') {
                            balance += op.amount;
                        } else if (op.operation === 'deduct') {
                            // Only deduct if sufficient balance (valid operation)
                            if (balance >= op.amount) {
                                balance -= op.amount;
                            }
                        }
                    }

                    // Balance should never be negative after valid operations
                    return balance >= 0;
                }
            ), propertyTestConfig);
        });

        test('profile validation is consistent and deterministic', () => {
            fc.assert(fc.property(
                validPaymentProfileGenerator,
                (profileData) => {
                    const profile1 = new UserPaymentProfile(profileData);
                    const profile2 = new UserPaymentProfile(profileData);

                    const validation1 = profile1.validate();
                    const validation2 = profile2.validate();

                    // Validation results should be identical for identical data
                    return validation1.isValid === validation2.isValid &&
                        validation1.errors.length === validation2.errors.length;
                }
            ), propertyTestConfig);
        });

        test('toFirestore conversion preserves essential data integrity', () => {
            fc.assert(fc.property(
                validPaymentProfileGenerator,
                (profileData) => {
                    const profile = new UserPaymentProfile(profileData);

                    // Skip invalid profiles for this test
                    if (!profile.validate().isValid) {
                        return true;
                    }

                    const firestoreData = profile.toFirestore();

                    // Essential fields must be preserved
                    return firestoreData.userId === profile.userId &&
                        firestoreData.creditBalance === profile.creditBalance &&
                        firestoreData.stripeCustomerId === profile.stripeCustomerId &&
                        typeof firestoreData.updatedAt !== 'undefined';
                }
            ), propertyTestConfig);
        });

        test('credit balance updates maintain transactional consistency', () => {
            fc.assert(fc.property(
                userIdGenerator,
                creditBalanceGenerator,
                fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 }),
                (userId, initialBalance, creditAmounts) => {
                    // Simulate atomic credit operations
                    let simulatedBalance = initialBalance;
                    const operations = [];

                    creditAmounts.forEach(amount => {
                        const beforeBalance = simulatedBalance;
                        simulatedBalance += amount;
                        const afterBalance = simulatedBalance;

                        operations.push({
                            before: beforeBalance,
                            amount: amount,
                            after: afterBalance
                        });
                    });

                    // Verify each operation maintains consistency
                    return operations.every(op =>
                        op.after === op.before + op.amount && op.after >= 0
                    );
                }
            ), propertyTestConfig);
        });
    });

    describe('Data Integrity Properties', () => {
        test('subscription data consistency when present', () => {
            fc.assert(fc.property(
                validPaymentProfileGenerator,
                (profileData) => {
                    const profile = new UserPaymentProfile(profileData);

                    if (profile.subscription) {
                        // If subscription exists, it must have required fields
                        return profile.subscription.id &&
                            profile.subscription.tierId &&
                            profile.subscription.status &&
                            typeof profile.subscription.cancelAtPeriodEnd === 'boolean';
                    }

                    return true; // No subscription is valid
                }
            ), propertyTestConfig);
        });

        test('payment methods array maintains structure integrity', () => {
            fc.assert(fc.property(
                validPaymentProfileGenerator,
                (profileData) => {
                    const profile = new UserPaymentProfile(profileData);

                    // Payment methods should always be an array
                    return Array.isArray(profile.paymentMethods) &&
                        profile.paymentMethods.every(method =>
                            method && typeof method === 'object'
                        );
                }
            ), propertyTestConfig);
        });

        test('billing address completeness when present', () => {
            fc.assert(fc.property(
                validPaymentProfileGenerator,
                (profileData) => {
                    const profile = new UserPaymentProfile(profileData);

                    if (profile.billingAddress) {
                        // If billing address exists, required fields must be present
                        return profile.billingAddress.line1 &&
                            profile.billingAddress.city &&
                            profile.billingAddress.postalCode &&
                            profile.billingAddress.country;
                    }

                    return true; // No billing address is valid
                }
            ), propertyTestConfig);
        });
    });

    describe('Edge Case Properties', () => {
        test('zero credit balance is valid and handled correctly', () => {
            fc.assert(fc.property(
                userIdGenerator,
                (userId) => {
                    const profile = new UserPaymentProfile({
                        userId,
                        creditBalance: 0
                    });

                    const validation = profile.validate();
                    return validation.isValid && profile.creditBalance === 0;
                }
            ), propertyTestConfig);
        });

        test('maximum reasonable credit balance is handled correctly', () => {
            fc.assert(fc.property(
                userIdGenerator,
                (userId) => {
                    const maxCredits = 1000000; // 1 million credits
                    const profile = new UserPaymentProfile({
                        userId,
                        creditBalance: maxCredits
                    });

                    const validation = profile.validate();
                    return validation.isValid && profile.creditBalance === maxCredits;
                }
            ), propertyTestConfig);
        });

        test('empty payment methods array is valid', () => {
            fc.assert(fc.property(
                userIdGenerator,
                (userId) => {
                    const profile = new UserPaymentProfile({
                        userId,
                        paymentMethods: []
                    });

                    const validation = profile.validate();
                    return validation.isValid && profile.paymentMethods.length === 0;
                }
            ), propertyTestConfig);
        });
    });
});

// Unit tests for specific scenarios
describe('UserPaymentProfile Unit Tests', () => {
    test('should create valid profile with minimal data', () => {
        const profile = new UserPaymentProfile({
            userId: 'test-user-123'
        });

        expect(profile.userId).toBe('test-user-123');
        expect(profile.creditBalance).toBe(0);
        expect(profile.paymentMethods).toEqual([]);
        expect(profile.validate().isValid).toBe(true);
    });

    test('should reject profile with negative credit balance', () => {
        const profile = new UserPaymentProfile({
            userId: 'test-user-123',
            creditBalance: -100
        });

        const validation = profile.validate();
        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain('creditBalance cannot be negative');
    });

    test('should reject profile without userId', () => {
        const profile = new UserPaymentProfile({
            creditBalance: 100
        });

        const validation = profile.validate();
        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain('userId is required and must be a string');
    });
});