/**
 * Property-Based Tests for Payment Failure Handling
 * Feature: ai-monetization-system, Property 10: Payment Failure Handling
 * Validates: Requirements 4.4
 */

const fc = require('fast-check');
const { AnalysisService } = require('../../services/AnalysisService');
const { HybridPaymentSystem } = require('../../services/HybridPaymentSystem');
const { UsageTracker } = require('../../services/UsageTracker');

// Mock Stripe
jest.mock('stripe', () => {
    return jest.fn(() => ({
        paymentIntents: {
            create: jest.fn(),
            confirm: jest.fn(),
            retrieve: jest.fn()
        },
        customers: {
            create: jest.fn(),
            retrieve: jest.fn(),
            update: jest.fn()
        },
        subscriptions: {
            create: jest.fn(),
            retrieve: jest.fn(),
            update: jest.fn(),
            cancel: jest.fn()
        },
        webhooks: {
            constructEvent: jest.fn()
        },
        setApiVersion: jest.fn(),
        setTimeout: jest.fn(),
        setMaxNetworkRetries: jest.fn()
    }));
});

// Mock environment variables
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';

// Mock Firebase Admin
jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: jest.fn(() => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn(),
                set: jest.fn(),
                update: jest.fn()
            })),
            add: jest.fn(),
            where: jest.fn()
        }))
    })),
    FieldValue: {
        serverTimestamp: jest.fn(() => new Date())
    },
    apps: []
}));

// Mock Firebase config
jest.mock('../../config/firebase', () => ({
    admin: require('firebase-admin'),
    db: {
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn().mockResolvedValue({
                    exists: false,
                    data: jest.fn()
                }),
                set: jest.fn(),
                update: jest.fn()
            })),
            add: jest.fn().mockResolvedValue({ id: 'mock-doc-id' }),
            where: jest.fn()
        }))
    }
}));

// Mock dependencies
jest.mock('../../services/HybridPaymentSystem');
jest.mock('../../services/UsageTracker');

describe('Payment Failure Handling Properties', () => {
    let analysisService;
    let mockPaymentSystem;
    let mockUsageTracker;

    beforeEach(() => {
        jest.clearAllMocks();
        analysisService = new AnalysisService();
        mockPaymentSystem = new HybridPaymentSystem();
        mockUsageTracker = UsageTracker;
    });

    // Property test configuration
    const propertyTestConfig = {
        numRuns: 100,
        verbose: false,
        seed: 42
    };

    // Custom generators for payment failure scenarios
    const paymentFailureTypeGenerator = fc.constantFrom(
        'insufficient_funds',
        'payment_method_declined',
        'network_error',
        'stripe_api_error',
        'invalid_payment_method',
        'expired_card',
        'processing_error'
    );

    const analysisRequestGenerator = fc.record({
        childId: fc.uuid(),
        type: fc.constantFrom('blood', 'urine', 'vitamin'),
        values: fc.record({
            hemoglobin: fc.float({ min: 5, max: 20 }),
            iron: fc.float({ min: 20, max: 200 }),
            protein: fc.float({ min: 0, max: 100 }),
            ph: fc.float({ min: 4, max: 9 }),
            vitaminD: fc.float({ min: 5, max: 100 }),
            vitaminB12: fc.float({ min: 50, max: 1000 })
        })
    });

    const userIdGenerator = fc.uuid();

    /**
     * Property 10: Payment Failure Handling
     * **Validates: Requirements 4.4**
     * 
     * For any failed payment attempt, the system should prevent analysis execution,
     * display appropriate error messages, and maintain system state consistency.
     */
    describe('Property 10: Payment Failure Handling', () => {

        test('should prevent analysis execution when payment fails', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisRequestGenerator,
                paymentFailureTypeGenerator,
                async (userId, analysisRequest, failureType) => {
                    // Mock payment failure
                    mockPaymentSystem.determinePaymentMethod.mockResolvedValue({
                        canProceed: false,
                        reason: failureType,
                        message: `Payment failed: ${failureType}`,
                        availablePaymentMethods: [],
                        upgradeOptions: []
                    });

                    const result = await analysisService.executeAnalysisWithPayment(userId, analysisRequest);

                    // Analysis should not succeed when payment fails
                    expect(result.success).toBe(false);

                    // Should have appropriate error information
                    expect(result.error).toBeDefined();
                    expect(result.error.code).toBe(failureType);
                    expect(result.error.message).toContain('Payment failed');

                    // Should not execute analysis when payment fails
                    expect(result.analysisId).toBeUndefined();
                    expect(result.result).toBeUndefined();
                }
            ), propertyTestConfig);
        });

        test('should display appropriate error messages for different failure types', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisRequestGenerator,
                paymentFailureTypeGenerator,
                async (userId, analysisRequest, failureType) => {
                    // Mock specific payment failure scenarios
                    const failureMessages = {
                        'insufficient_funds': 'Insufficient credits or subscription limits exceeded',
                        'payment_method_declined': 'Payment method was declined',
                        'network_error': 'Network connection failed',
                        'stripe_api_error': 'Payment processing service unavailable',
                        'invalid_payment_method': 'Invalid payment method',
                        'expired_card': 'Payment method has expired',
                        'processing_error': 'Payment processing failed'
                    };

                    mockPaymentSystem.determinePaymentMethod.mockResolvedValue({
                        canProceed: false,
                        reason: failureType,
                        message: failureMessages[failureType],
                        availablePaymentMethods: [],
                        upgradeOptions: []
                    });

                    const result = await analysisService.executeAnalysisWithPayment(userId, analysisRequest);

                    // Should have user-friendly error message
                    expect(result.error.message).toBeDefined();
                    expect(result.error.message).toContain(failureMessages[failureType] || 'Payment failed');

                    // Error message should be informative and actionable
                    expect(result.error.message.length).toBeGreaterThan(10);
                    expect(result.error.message.length).toBeLessThan(200);
                }
            ), propertyTestConfig);
        });

        test('should maintain system state consistency during payment failures', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisRequestGenerator,
                paymentFailureTypeGenerator,
                async (userId, analysisRequest, failureType) => {
                    // Mock payment failure
                    mockPaymentSystem.determinePaymentMethod.mockResolvedValue({
                        canProceed: false,
                        reason: failureType,
                        message: `Payment failed: ${failureType}`,
                        availablePaymentMethods: [],
                        upgradeOptions: []
                    });

                    const result = await analysisService.executeAnalysisWithPayment(userId, analysisRequest);

                    // System state should remain consistent
                    expect(result.success).toBe(false);

                    // No partial state should be created
                    expect(result.analysisId).toBeUndefined();
                    expect(result.paymentInfo).toBeUndefined();

                    // Should provide cost estimate even on failure
                    expect(result.costEstimate).toBeDefined();
                    expect(result.costEstimate.cost).toBeGreaterThan(0);
                }
            ), propertyTestConfig);
        });

        test('should provide upgrade options for recoverable payment failures', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisRequestGenerator,
                fc.constantFrom('insufficient_funds', 'subscription_expired'),
                async (userId, analysisRequest, recoverableFailureType) => {
                    // Mock recoverable payment failure with upgrade options
                    const mockUpgradeOptions = [
                        { type: 'credit', title: 'Buy Credits', price: 1000 },
                        { type: 'subscription', title: 'Upgrade Subscription', price: 2000 }
                    ];

                    mockPaymentSystem.determinePaymentMethod.mockResolvedValue({
                        canProceed: false,
                        reason: recoverableFailureType,
                        message: `Payment failed: ${recoverableFailureType}`,
                        availablePaymentMethods: [],
                        upgradeOptions: mockUpgradeOptions
                    });

                    const result = await analysisService.executeAnalysisWithPayment(userId, analysisRequest);

                    // Should provide upgrade options for recoverable failures
                    expect(result.error.details.upgradeOptions).toBeDefined();
                    expect(Array.isArray(result.error.details.upgradeOptions)).toBe(true);

                    if (result.error.details.upgradeOptions.length > 0) {
                        const option = result.error.details.upgradeOptions[0];
                        expect(option.type).toBeDefined();
                        expect(option.title).toBeDefined();
                        expect(option.price).toBeGreaterThan(0);
                    }
                }
            ), propertyTestConfig);
        });

        test('should handle network and service failures gracefully', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisRequestGenerator,
                fc.constantFrom('network_error', 'stripe_api_error', 'processing_error'),
                async (userId, analysisRequest, serviceFailureType) => {
                    // Mock service failure
                    mockPaymentSystem.determinePaymentMethod.mockRejectedValue(
                        new Error(`Service failure: ${serviceFailureType}`)
                    );

                    const result = await analysisService.executeAnalysisWithPayment(userId, analysisRequest);

                    // Should handle service failures gracefully
                    expect(result.success).toBe(false);
                    expect(result.error).toBeDefined();

                    // Should indicate if the failure is retryable
                    if (serviceFailureType === 'network_error' || serviceFailureType === 'processing_error') {
                        // Network and processing errors are typically retryable
                        expect(result.retryable).toBeTruthy();
                    }

                    // Should not expose internal error details to user
                    expect(result.error.message).not.toContain('Service failure');
                    expect(result.error.message).not.toContain('Error:');
                }
            ), propertyTestConfig);
        });

        test('should log payment failures without exposing sensitive data', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisRequestGenerator,
                paymentFailureTypeGenerator,
                async (userId, analysisRequest, failureType) => {
                    // Mock console.error to capture logs
                    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

                    mockPaymentSystem.determinePaymentMethod.mockResolvedValue({
                        canProceed: false,
                        reason: failureType,
                        message: `Payment failed: ${failureType}`,
                        availablePaymentMethods: [],
                        upgradeOptions: []
                    });

                    await analysisService.executeAnalysisWithPayment(userId, analysisRequest);

                    // Should not log sensitive user data
                    const logCalls = consoleSpy.mock.calls;
                    logCalls.forEach(call => {
                        const logMessage = call.join(' ');

                        // Should not contain sensitive information
                        expect(logMessage).not.toContain('password');
                        expect(logMessage).not.toContain('credit_card');
                        expect(logMessage).not.toContain('ssn');
                        expect(logMessage).not.toContain('social_security');
                    });

                    consoleSpy.mockRestore();
                }
            ), propertyTestConfig);
        });

        test('should provide cost estimates even when payment fails', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisRequestGenerator,
                paymentFailureTypeGenerator,
                async (userId, analysisRequest, failureType) => {
                    // Mock cost estimation to succeed
                    mockUsageTracker.estimateCost.mockResolvedValue({
                        estimatedCost: 5,
                        currency: 'usd',
                        factors: [{ name: 'base_cost', value: 5 }]
                    });

                    // Mock payment failure
                    mockPaymentSystem.determinePaymentMethod.mockResolvedValue({
                        canProceed: false,
                        reason: failureType,
                        message: `Payment failed: ${failureType}`,
                        availablePaymentMethods: [],
                        upgradeOptions: []
                    });

                    const result = await analysisService.executeAnalysisWithPayment(userId, analysisRequest);

                    // Should provide cost estimate even on payment failure
                    expect(result.costEstimate).toBeDefined();
                    expect(result.costEstimate.cost).toBeGreaterThan(0);
                    expect(result.costEstimate.currency).toBe('usd');

                    // Cost estimate should be reasonable
                    expect(result.costEstimate.cost).toBeLessThan(1000); // Less than $10
                }
            ), propertyTestConfig);
        });
    });

    /**
     * Additional edge cases for payment failure handling
     */
    describe('Payment Failure Edge Cases', () => {

        test('should handle malformed payment responses', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                analysisRequestGenerator,
                async (userId, analysisRequest) => {
                    // Mock malformed payment response
                    mockPaymentSystem.determinePaymentMethod.mockResolvedValue(null);

                    const result = await analysisService.executeAnalysisWithPayment(userId, analysisRequest);

                    // Should handle malformed responses gracefully
                    expect(result.success).toBe(false);
                    expect(result.error).toBeDefined();
                    expect(result.error.code).toBeDefined();
                }
            ), propertyTestConfig);
        });

        test('should handle concurrent payment failures consistently', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                fc.array(analysisRequestGenerator, { minLength: 2, maxLength: 5 }),
                async (userId, analysisRequests) => {
                    // Mock payment failure for all requests
                    mockPaymentSystem.determinePaymentMethod.mockResolvedValue({
                        canProceed: false,
                        reason: 'insufficient_funds',
                        message: 'Insufficient funds',
                        availablePaymentMethods: [],
                        upgradeOptions: []
                    });

                    // Execute multiple concurrent requests
                    const promises = analysisRequests.map(request =>
                        analysisService.executeAnalysisWithPayment(userId, request)
                    );

                    const results = await Promise.all(promises);

                    // All requests should fail consistently
                    results.forEach(result => {
                        expect(result.success).toBe(false);
                        expect(result.error.code).toBe('insufficient_funds');
                    });

                    // Results should be consistent across concurrent requests
                    const firstResult = results[0];
                    results.forEach(result => {
                        expect(result.error.code).toBe(firstResult.error.code);
                        expect(result.success).toBe(firstResult.success);
                    });
                }
            ), propertyTestConfig);
        });
    });
});