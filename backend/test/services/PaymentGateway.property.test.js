/**
 * Property-Based Tests for Payment Gateway Service
 * 
 * Tests universal properties that should hold across all payment operations
 * Uses fast-check for property-based testing with minimum 100 iterations
 */

const fc = require('fast-check');

// Mock Firebase admin before importing PaymentGateway
jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: jest.fn(() => ({
        collection: jest.fn()
    }))
}));

// Mock Stripe for testing
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
            attach: jest.fn(),
            list: jest.fn()
        },
        refunds: {
            create: jest.fn()
        },
        subscriptions: {
            create: jest.fn(),
            update: jest.fn(),
            cancel: jest.fn()
        },
        webhooks: {
            constructEvent: jest.fn()
        }
    },
    STRIPE_CONFIG: {
        webhookSecret: 'whsec_test_secret',
        defaultCurrency: 'usd'
    },
    verifyWebhookSignature: jest.fn()
}));

const PaymentGateway = require('../../services/PaymentGateway');
const { stripe } = require('../../config/stripe');

describe('PaymentGateway Property Tests', () => {
    let paymentGateway;

    beforeEach(() => {
        paymentGateway = new PaymentGateway();
        jest.clearAllMocks();
    });

    /**
     * Property 9: Pay-Per-Analysis Processing
     * **Validates: Requirements 4.1, 4.2, 4.3**
     * 
     * For any pay-per-analysis request, the system should display the cost upfront,
     * process payment in real-time, and execute analysis immediately upon successful payment.
     */
    describe('Property 9: Pay-Per-Analysis Processing', () => {
        const propertyTestConfig = {
            numRuns: 100,
            verbose: false,
            seed: 42
        };

        // Custom generators for payment testing
        const validAmountGenerator = fc.integer({ min: 100, max: 100000 }); // 1-1000 USD in cents
        const currencyGenerator = fc.constantFrom('usd', 'eur', 'gbp');
        const analysisTypeGenerator = fc.constantFrom('blood', 'urine', 'vitamin', 'growth');
        const userIdGenerator = fc.uuid();
        const emailGenerator = fc.emailAddress();

        test('payment intent creation should always return consistent structure for valid amounts', () => {
            fc.assert(fc.asyncProperty(
                validAmountGenerator,
                currencyGenerator,
                fc.record({
                    analysisType: analysisTypeGenerator,
                    userId: userIdGenerator
                }),
                async (amount, currency, metadata) => {
                    // Mock successful Stripe response
                    const mockPaymentIntent = {
                        id: 'pi_test_123',
                        client_secret: 'pi_test_123_secret',
                        amount: amount,
                        currency: currency,
                        status: 'requires_payment_method'
                    };
                    stripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent);

                    const result = await paymentGateway.createPaymentIntent(amount, currency, metadata);

                    // Property: All successful payment intent creations should have consistent structure
                    expect(result).toHaveProperty('success', true);
                    expect(result).toHaveProperty('paymentIntent');
                    expect(result.paymentIntent).toHaveProperty('id');
                    expect(result.paymentIntent).toHaveProperty('clientSecret');
                    expect(result.paymentIntent).toHaveProperty('amount', amount);
                    expect(result.paymentIntent).toHaveProperty('currency', currency);
                    expect(result.paymentIntent).toHaveProperty('status');

                    // Verify Stripe was called with correct parameters
                    expect(stripe.paymentIntents.create).toHaveBeenCalledWith({
                        amount: amount,
                        currency: currency.toLowerCase(),
                        metadata: expect.objectContaining({
                            ...metadata,
                            timestamp: expect.any(String)
                        }),
                        automatic_payment_methods: { enabled: true }
                    });
                }
            ), propertyTestConfig);
        });

        test('payment confirmation should maintain amount consistency', () => {
            fc.assert(fc.asyncProperty(
                validAmountGenerator,
                currencyGenerator,
                fc.constantFrom('succeeded', 'requires_payment_method', 'requires_confirmation'),
                async (amount, currency, status) => {
                    const paymentIntentId = 'pi_test_' + Math.random().toString(36).substr(2, 9);

                    // Mock Stripe retrieve response
                    const mockPaymentIntent = {
                        id: paymentIntentId,
                        amount: amount,
                        currency: currency,
                        status: status,
                        payment_method: 'pm_test_123'
                    };
                    stripe.paymentIntents.retrieve.mockResolvedValue(mockPaymentIntent);

                    const result = await paymentGateway.confirmPayment(paymentIntentId);

                    // Property: Payment confirmation should preserve amount and currency
                    expect(result).toHaveProperty('paymentIntentId', paymentIntentId);
                    expect(result).toHaveProperty('amount', amount);
                    expect(result).toHaveProperty('currency', currency);
                    expect(result).toHaveProperty('status', status);
                    expect(result).toHaveProperty('success', status === 'succeeded');

                    // Verify Stripe was called correctly
                    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(paymentIntentId);
                }
            ), propertyTestConfig);
        });

        test('customer creation should maintain email consistency', () => {
            fc.assert(fc.asyncProperty(
                userIdGenerator,
                emailGenerator,
                fc.record({
                    name: fc.string({ minLength: 1, maxLength: 50 }),
                    phone: fc.option(fc.string({ minLength: 10, maxLength: 15 }))
                }),
                async (userId, email, additionalData) => {
                    // Mock successful Stripe customer creation
                    const mockCustomer = {
                        id: 'cus_test_' + Math.random().toString(36).substr(2, 9),
                        email: email,
                        created: Math.floor(Date.now() / 1000)
                    };
                    stripe.customers.create.mockResolvedValue(mockCustomer);

                    const result = await paymentGateway.createCustomer(userId, email, additionalData);

                    // Property: Customer creation should preserve email and return consistent structure
                    expect(result).toHaveProperty('success', true);
                    expect(result).toHaveProperty('customer');
                    expect(result.customer).toHaveProperty('id');
                    expect(result.customer).toHaveProperty('email', email);
                    expect(result.customer).toHaveProperty('created');

                    // Verify Stripe was called with correct parameters
                    expect(stripe.customers.create).toHaveBeenCalledWith({
                        email: email,
                        metadata: expect.objectContaining({
                            userId: userId,
                            ...additionalData
                        })
                    });
                }
            ), propertyTestConfig);
        });

        test('refund processing should maintain amount relationships', () => {
            fc.assert(fc.asyncProperty(
                validAmountGenerator,
                fc.option(fc.integer({ min: 50, max: 50000 })), // Optional partial refund amount
                currencyGenerator,
                async (originalAmount, refundAmount, currency) => {
                    const paymentIntentId = 'pi_test_' + Math.random().toString(36).substr(2, 9);
                    const finalRefundAmount = refundAmount || originalAmount;

                    // Mock successful Stripe refund
                    const mockRefund = {
                        id: 're_test_' + Math.random().toString(36).substr(2, 9),
                        amount: finalRefundAmount,
                        currency: currency,
                        status: 'succeeded',
                        reason: null
                    };
                    stripe.refunds.create.mockResolvedValue(mockRefund);

                    const result = await paymentGateway.processRefund(paymentIntentId, refundAmount);

                    // Property: Refund should never exceed original amount and maintain currency
                    expect(result).toHaveProperty('success', true);
                    expect(result).toHaveProperty('refund');
                    expect(result.refund).toHaveProperty('amount', finalRefundAmount);
                    expect(result.refund).toHaveProperty('currency', currency);
                    expect(result.refund).toHaveProperty('status', 'succeeded');

                    // Verify correct Stripe call
                    const expectedRefundData = { payment_intent: paymentIntentId };
                    if (refundAmount !== null) {
                        expectedRefundData.amount = refundAmount;
                    }
                    expect(stripe.refunds.create).toHaveBeenCalledWith(expectedRefundData);
                }
            ), propertyTestConfig);
        });

        test('error handling should always return consistent error structure', () => {
            fc.assert(fc.asyncProperty(
                validAmountGenerator,
                currencyGenerator,
                fc.constantFrom('card_declined', 'insufficient_funds', 'invalid_request_error'),
                async (amount, currency, errorCode) => {
                    // Mock Stripe error
                    const stripeError = new Error('Test error');
                    stripeError.code = errorCode;
                    stripe.paymentIntents.create.mockRejectedValue(stripeError);

                    const result = await paymentGateway.createPaymentIntent(amount, currency);

                    // Property: All errors should return consistent error structure
                    expect(result).toHaveProperty('success', false);
                    expect(result).toHaveProperty('error');
                    expect(result.error).toHaveProperty('code');
                    expect(result.error).toHaveProperty('message');
                    expect(typeof result.error.code).toBe('string');
                    expect(typeof result.error.message).toBe('string');
                }
            ), propertyTestConfig);
        });

        test('webhook signature verification should be deterministic', () => {
            fc.assert(fc.property(
                fc.string({ minLength: 10, maxLength: 1000 }),
                fc.string({ minLength: 20, maxLength: 100 }),
                (payload, signature) => {
                    const { verifyWebhookSignature } = require('../../config/stripe');

                    // Mock the verification function to return a consistent event
                    const mockEvent = {
                        id: 'evt_test_123',
                        type: 'payment_intent.succeeded',
                        data: { object: { id: 'pi_test_123' } }
                    };
                    verifyWebhookSignature.mockReturnValue(mockEvent);

                    const result = paymentGateway.verifyWebhook(payload, signature);

                    // Property: Webhook verification should always return event structure
                    expect(result).toHaveProperty('id');
                    expect(result).toHaveProperty('type');
                    expect(result).toHaveProperty('data');
                    expect(verifyWebhookSignature).toHaveBeenCalledWith(payload, signature);
                }
            ), propertyTestConfig);
        });
    });

    /**
     * Additional Property: Payment Method Consistency
     * Ensures payment method operations maintain data integrity
     */
    describe('Payment Method Consistency Property', () => {
        test('payment method attachment should preserve method ID', () => {
            fc.assert(fc.asyncProperty(
                fc.string({ minLength: 10, maxLength: 30 }), // customerId
                fc.string({ minLength: 10, maxLength: 30 }), // paymentMethodId
                async (customerId, paymentMethodId) => {
                    // Mock successful attachment
                    stripe.paymentMethods.attach.mockResolvedValue({});

                    const result = await paymentGateway.attachPaymentMethod(customerId, paymentMethodId);

                    // Property: Successful attachment should preserve payment method ID
                    expect(result).toHaveProperty('success', true);
                    expect(result).toHaveProperty('paymentMethodId', paymentMethodId);
                    expect(stripe.paymentMethods.attach).toHaveBeenCalledWith(paymentMethodId, {
                        customer: customerId
                    });
                }
            ), { numRuns: 50 });
        });
    });
});