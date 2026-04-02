/**
 * Unit Tests for Hybrid Payment System
 * 
 * Tests the subscription-first, credit-fallback payment logic
 * and transparent payment method indication
 */

// Mock Stripe before any imports
jest.mock('stripe', () => {
    return jest.fn(() => ({
        paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
        customers: { create: jest.fn() },
        webhooks: { constructEvent: jest.fn() },
        setApiVersion: jest.fn(),
        setTimeout: jest.fn(),
        setMaxNetworkRetries: jest.fn()
    }));
});
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key';

const { HybridPaymentSystem, PaymentDecision, HybridAccountStatus, PAYMENT_PRIORITY, PAYMENT_METHOD_USED } = require('../../services/HybridPaymentSystem');
const SubscriptionManager = require('../../services/SubscriptionManager');
const CreditSystem = require('../../services/CreditSystem');
const { UsageTracker } = require('../../services/UsageTracker');
const { UserPaymentProfileService } = require('../../models/UserPaymentProfile');

// Mock dependencies
jest.mock('../../services/SubscriptionManager');
jest.mock('../../services/CreditSystem');
jest.mock('../../services/UsageTracker');
jest.mock('../../models/UserPaymentProfile');
jest.mock('../../services/FreemiumController');

describe('HybridPaymentSystem', () => {
    let hybridPaymentSystem;
    let mockSubscriptionManager;
    let mockCreditSystem;

    beforeEach(() => {
        jest.clearAllMocks();

        hybridPaymentSystem = new HybridPaymentSystem();
        mockSubscriptionManager = hybridPaymentSystem.subscriptionManager;
        mockCreditSystem = hybridPaymentSystem.creditSystem;

        // Setup default mocks
        mockCreditSystem.getAnalysisCost.mockReturnValue(5);
        UsageTracker.recordUsage.mockResolvedValue({ success: true });
    });

    describe('determinePaymentMethod', () => {
        test('should use subscription first when active and has remaining usage', async () => {
            // Setup: User has active subscription with remaining usage
            const mockAccountStatus = new HybridAccountStatus({
                userId: 'user123',
                hasActiveSubscription: true,
                hasCredits: true,
                subscriptionStatus: {
                    active: true,
                    analysisUsed: 5,
                    analysisLimit: 100,
                    tierName: 'Professional'
                },
                creditBalance: 50
            });

            hybridPaymentSystem.getHybridAccountStatus = jest.fn().mockResolvedValue(mockAccountStatus);

            mockSubscriptionManager.checkAnalysisAccess.mockResolvedValue({
                allowed: true,
                remainingAnalyses: 95,
                accessType: 'subscription'
            });

            const result = await hybridPaymentSystem.determinePaymentMethod('user123', 'blood');

            expect(result.allowed).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.SUBSCRIPTION);
            expect(result.cost).toBe(0);
            expect(result.fallbackUsed).toBe(false);
            expect(result.transparencyInfo.message).toContain('Using subscription');
        });

        test('should fallback to credits when subscription limit exceeded', async () => {
            // Setup: User has subscription but limit exceeded, has credits
            const mockAccountStatus = new HybridAccountStatus({
                userId: 'user123',
                hasActiveSubscription: true,
                hasCredits: true,
                subscriptionStatus: {
                    active: true,
                    analysisUsed: 100,
                    analysisLimit: 100,
                    tierName: 'Professional'
                },
                creditBalance: 50
            });

            hybridPaymentSystem.getHybridAccountStatus = jest.fn().mockResolvedValue(mockAccountStatus);

            // Subscription access denied (limit exceeded)
            mockSubscriptionManager.checkAnalysisAccess.mockResolvedValue({
                allowed: false,
                reason: 'subscription_limit_exceeded'
            });

            // Credits are sufficient
            mockCreditSystem.checkSufficientCredits.mockResolvedValue({
                sufficient: true,
                required: 5,
                available: 50
            });

            const result = await hybridPaymentSystem.determinePaymentMethod('user123', 'blood');

            expect(result.allowed).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.CREDITS);
            expect(result.cost).toBe(5);
            expect(result.fallbackUsed).toBe(true);
            expect(result.transparencyInfo.originalMethod).toBe(PAYMENT_METHOD_USED.SUBSCRIPTION);
            expect(result.transparencyInfo.fallbackReason).toBe('Subscription limit exceeded');
        });

        test('should use credits when no active subscription', async () => {
            // Setup: User has no subscription but has credits
            const mockAccountStatus = new HybridAccountStatus({
                userId: 'user123',
                hasActiveSubscription: false,
                hasCredits: true,
                subscriptionStatus: { active: false },
                creditBalance: 25
            });

            hybridPaymentSystem.getHybridAccountStatus = jest.fn().mockResolvedValue(mockAccountStatus);

            mockCreditSystem.checkSufficientCredits.mockResolvedValue({
                sufficient: true,
                required: 5,
                available: 25
            });

            const result = await hybridPaymentSystem.determinePaymentMethod('user123', 'blood');

            expect(result.allowed).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.CREDITS);
            expect(result.cost).toBe(5);
            expect(result.fallbackUsed).toBe(false);
            expect(result.transparencyInfo.message).toContain('Using 5 credits');
        });

        test('should use free tier when no paid options available', async () => {
            // Setup: User has no subscription or credits
            const mockAccountStatus = new HybridAccountStatus({
                userId: 'user123',
                hasActiveSubscription: false,
                hasCredits: false,
                subscriptionStatus: { active: false },
                creditBalance: 0
            });

            hybridPaymentSystem.getHybridAccountStatus = jest.fn().mockResolvedValue(mockAccountStatus);

            // Mock FreemiumController
            const { FreemiumController } = require('../../services/FreemiumController');
            FreemiumController.checkFreeLimit = jest.fn().mockResolvedValue({
                eligible: true,
                remainingAnalyses: 3,
                resetDate: new Date()
            });

            const result = await hybridPaymentSystem.determinePaymentMethod('user123', 'blood');

            expect(result.allowed).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.FREE_TIER);
            expect(result.cost).toBe(0);
            expect(result.transparencyInfo.message).toContain('Using free tier');
        });

        test('should deny payment when no options available', async () => {
            // Setup: User has no subscription, credits, or free tier
            const mockAccountStatus = new HybridAccountStatus({
                userId: 'user123',
                hasActiveSubscription: false,
                hasCredits: false,
                subscriptionStatus: { active: false },
                creditBalance: 0
            });

            hybridPaymentSystem.getHybridAccountStatus = jest.fn().mockResolvedValue(mockAccountStatus);

            // Mock insufficient credits
            mockCreditSystem.checkSufficientCredits.mockResolvedValue({
                sufficient: false,
                required: 5,
                available: 0
            });

            // Mock FreemiumController - no free tier available
            const { FreemiumController } = require('../../services/FreemiumController');
            FreemiumController.checkFreeLimit = jest.fn().mockResolvedValue({
                eligible: false,
                remainingAnalyses: 0
            });

            // Mock upgrade recommendations
            mockCreditSystem.getUpgradeRecommendations = jest.fn().mockResolvedValue([]);
            hybridPaymentSystem.subscriptionManager.getSubscriptionTiers = jest.fn().mockResolvedValue([]);

            const result = await hybridPaymentSystem.determinePaymentMethod('user123', 'blood');

            expect(result.allowed).toBe(false);
            expect(result.reason).toBe('no_payment_method_available');
            expect(result.transparencyInfo.message).toContain('No available payment method');
        });

        test('should respect user preferred payment method when valid', async () => {
            // Setup: User prefers credits and has both subscription and credits
            const mockAccountStatus = new HybridAccountStatus({
                userId: 'user123',
                hasActiveSubscription: true,
                hasCredits: true,
                subscriptionStatus: {
                    active: true,
                    analysisUsed: 5,
                    analysisLimit: 100
                },
                creditBalance: 50
            });

            hybridPaymentSystem.getHybridAccountStatus = jest.fn().mockResolvedValue(mockAccountStatus);

            mockCreditSystem.checkSufficientCredits.mockResolvedValue({
                sufficient: true,
                required: 5,
                available: 50
            });

            const result = await hybridPaymentSystem.determinePaymentMethod(
                'user123',
                'blood',
                PAYMENT_METHOD_USED.CREDITS
            );

            expect(result.allowed).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.CREDITS);
            expect(result.cost).toBe(5);
        });
    });

    describe('executePayment', () => {
        test('should execute subscription payment successfully', async () => {
            const paymentDecision = new PaymentDecision({
                allowed: true,
                paymentMethod: PAYMENT_METHOD_USED.SUBSCRIPTION,
                cost: 0,
                transparencyInfo: { message: 'Using subscription' }
            });

            mockSubscriptionManager.recordSubscriptionUsage.mockResolvedValue(true);
            hybridPaymentSystem._getUpdatedBalance = jest.fn().mockResolvedValue({
                credits: 50,
                subscription: { remaining: 95 }
            });

            const result = await hybridPaymentSystem.executePayment(
                'user123',
                'blood',
                paymentDecision,
                { analysisId: 'test123' }
            );

            expect(result.success).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.SUBSCRIPTION);
            expect(result.cost).toBe(0);
            expect(mockSubscriptionManager.recordSubscriptionUsage).toHaveBeenCalledWith(
                'user123',
                'blood',
                expect.objectContaining({ analysisId: 'test123' })
            );
            expect(UsageTracker.recordUsage).toHaveBeenCalled();
        });

        test('should execute credit payment successfully', async () => {
            const paymentDecision = new PaymentDecision({
                allowed: true,
                paymentMethod: PAYMENT_METHOD_USED.CREDITS,
                cost: 5,
                transparencyInfo: { message: 'Using credits' }
            });

            mockCreditSystem.deductCredits.mockResolvedValue({
                success: true,
                creditsDeducted: 5,
                newBalance: 45
            });

            hybridPaymentSystem._getUpdatedBalance = jest.fn().mockResolvedValue({
                credits: 45,
                subscription: null
            });

            const result = await hybridPaymentSystem.executePayment(
                'user123',
                'blood',
                paymentDecision,
                { analysisId: 'test123' }
            );

            expect(result.success).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.CREDITS);
            expect(result.cost).toBe(5);
            expect(result.creditsDeducted).toBe(5);
            expect(result.newCreditBalance).toBe(45);
            expect(mockCreditSystem.deductCredits).toHaveBeenCalledWith(
                'user123',
                'blood',
                expect.any(String)
            );
        });

        test('should execute free tier payment successfully', async () => {
            const paymentDecision = new PaymentDecision({
                allowed: true,
                paymentMethod: PAYMENT_METHOD_USED.FREE_TIER,
                cost: 0,
                transparencyInfo: { message: 'Using free tier' }
            });

            const { FreemiumController } = require('../../services/FreemiumController');
            FreemiumController.consumeFreeAnalysis = jest.fn().mockResolvedValue({
                success: true,
                remainingAnalyses: 2
            });

            hybridPaymentSystem._getUpdatedBalance = jest.fn().mockResolvedValue({
                credits: 0,
                subscription: null
            });

            const result = await hybridPaymentSystem.executePayment(
                'user123',
                'blood',
                paymentDecision,
                { analysisId: 'test123' }
            );

            expect(result.success).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.FREE_TIER);
            expect(result.cost).toBe(0);
            expect(result.freeAnalysisConsumed).toBe(true);
            expect(result.remainingFreeAnalyses).toBe(2);
        });

        test('should handle payment execution failure', async () => {
            const paymentDecision = new PaymentDecision({
                allowed: true,
                paymentMethod: PAYMENT_METHOD_USED.CREDITS,
                cost: 5
            });

            mockCreditSystem.deductCredits.mockResolvedValue({
                success: false,
                error: { message: 'Insufficient credits' }
            });

            const result = await hybridPaymentSystem.executePayment(
                'user123',
                'blood',
                paymentDecision
            );

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('payment_execution_failed');
            expect(result.error.message).toContain('Insufficient credits');
        });
    });

    describe('getHybridAccountStatus', () => {
        test('should return comprehensive account status', async () => {
            const mockSubscriptionStatus = {
                active: true,
                tierId: 'professional',
                tierName: 'Professional',
                analysisUsed: 10,
                analysisLimit: 100
            };

            const mockProfile = {
                paymentPriority: PAYMENT_PRIORITY.SUBSCRIPTION_FIRST
            };

            mockSubscriptionManager.getSubscriptionStatus.mockResolvedValue(mockSubscriptionStatus);
            mockCreditSystem.getCreditBalance.mockResolvedValue(25);
            UserPaymentProfileService.getByUserId.mockResolvedValue(mockProfile);

            const result = await hybridPaymentSystem.getHybridAccountStatus('user123');

            expect(result.userId).toBe('user123');
            expect(result.hasActiveSubscription).toBe(true);
            expect(result.hasCredits).toBe(true);
            expect(result.subscriptionStatus).toEqual(mockSubscriptionStatus);
            expect(result.creditBalance).toBe(25);
            expect(result.paymentPriority).toBe(PAYMENT_PRIORITY.SUBSCRIPTION_FIRST);
            expect(result.availablePaymentMethods).toHaveLength(3); // subscription, credits, free tier
        });

        test('should handle user with no payment profile', async () => {
            mockSubscriptionManager.getSubscriptionStatus.mockResolvedValue({ active: false });
            mockCreditSystem.getCreditBalance.mockResolvedValue(0);
            UserPaymentProfileService.getByUserId.mockResolvedValue(null);

            const result = await hybridPaymentSystem.getHybridAccountStatus('user123');

            expect(result.hasActiveSubscription).toBe(false);
            expect(result.hasCredits).toBe(false);
            expect(result.paymentPriority).toBe(PAYMENT_PRIORITY.SUBSCRIPTION_FIRST);
            expect(result.recommendedAction.type).toBe('subscribe_or_purchase_credits');
        });
    });

    describe('getPaymentTransparencyInfo', () => {
        test('should provide transparent payment information', async () => {
            const mockAccountStatus = new HybridAccountStatus({
                userId: 'user123',
                hasActiveSubscription: true,
                hasCredits: true,
                subscriptionStatus: {
                    active: true,
                    analysisUsed: 10,
                    analysisLimit: 100,
                    currentPeriodEnd: new Date('2024-02-01')
                },
                creditBalance: 50
            });

            const mockPaymentDecision = new PaymentDecision({
                allowed: true,
                paymentMethod: PAYMENT_METHOD_USED.SUBSCRIPTION,
                cost: 0,
                transparencyInfo: { message: 'Using subscription (90 analyses remaining)' }
            });

            hybridPaymentSystem.getHybridAccountStatus = jest.fn().mockResolvedValue(mockAccountStatus);
            hybridPaymentSystem.determinePaymentMethod = jest.fn().mockResolvedValue(mockPaymentDecision);

            const result = await hybridPaymentSystem.getPaymentTransparencyInfo('user123', 'blood');

            expect(result.currentBalance.credits).toBe(50);
            expect(result.currentBalance.subscription.remaining).toBe(90);
            expect(result.willUseMethod).toBe(PAYMENT_METHOD_USED.SUBSCRIPTION);
            expect(result.cost).toBe(0);
            expect(result.transparencyMessage).toContain('Using subscription');
        });
    });

    describe('setPaymentPriority', () => {
        test('should set valid payment priority', async () => {
            UserPaymentProfileService.update.mockResolvedValue(true);

            const result = await hybridPaymentSystem.setPaymentPriority(
                'user123',
                PAYMENT_PRIORITY.CREDITS_FIRST
            );

            expect(result).toBe(true);
            expect(UserPaymentProfileService.update).toHaveBeenCalledWith(
                'user123',
                expect.objectContaining({
                    paymentPriority: PAYMENT_PRIORITY.CREDITS_FIRST
                })
            );
        });

        test('should reject invalid payment priority', async () => {
            const result = await hybridPaymentSystem.setPaymentPriority('user123', 'invalid_priority');

            expect(result).toBe(false);
            expect(UserPaymentProfileService.update).not.toHaveBeenCalled();
        });
    });

    describe('Enterprise unlimited access', () => {
        test('should handle Enterprise unlimited access correctly', async () => {
            const mockAccountStatus = new HybridAccountStatus({
                userId: 'user123',
                hasActiveSubscription: true,
                subscriptionStatus: {
                    active: true,
                    tierId: 'enterprise',
                    analysisLimit: -1
                }
            });

            hybridPaymentSystem.getHybridAccountStatus = jest.fn().mockResolvedValue(mockAccountStatus);

            mockSubscriptionManager.checkAnalysisAccess.mockResolvedValue({
                allowed: true,
                remainingAnalyses: -1,
                accessType: 'enterprise'
            });

            const result = await hybridPaymentSystem.determinePaymentMethod('user123', 'blood');

            expect(result.allowed).toBe(true);
            expect(result.paymentMethod).toBe(PAYMENT_METHOD_USED.SUBSCRIPTION);
            expect(result.cost).toBe(0);
            expect(result.transparencyInfo.message).toContain('Enterprise unlimited access');
            expect(result.transparencyInfo.unlimited).toBe(true);
        });
    });
});