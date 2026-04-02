/**
 * Simple Unit Tests for FreemiumController
 * 
 * Tests core functionality without complex property-based testing
 */

// Mock Firebase Admin before importing other modules
const mockFirestore = {
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
};

jest.mock('firebase-admin', () => {
    const firestoreFn = jest.fn(() => mockFirestore);
    firestoreFn.Timestamp = {
        now: () => ({ seconds: Date.now() / 1000, toDate: () => new Date() }),
        fromDate: (date) => ({ seconds: date.getTime() / 1000, toDate: () => date })
    };
    return { firestore: firestoreFn, apps: [], initializeApp: jest.fn() };
});

const { FreemiumController } = require('../../services/FreemiumController');
const { FreeUsageTrackingService } = require('../../models/FreeUsageTracking');
const { FREEMIUM_CONFIG } = require('../../config/monetization');

describe('FreemiumController Unit Tests', () => {
    let mockUsageData = new Map();

    beforeEach(() => {
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

        jest.spyOn(FreeUsageTrackingService, 'getUserHistory').mockImplementation(async () => [
            { month: '2024-01', analysisCount: 3 },
            { month: '2024-02', analysisCount: 5 }
        ]);

        jest.spyOn(FreeUsageTrackingService, 'getUpgradeRecommendations').mockImplementation(async () => []);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('checkFreeLimit', () => {
        test('should return correct limit status for new user', async () => {
            const userId = 'test_user_1';
            const status = await FreemiumController.checkFreeLimit(userId);

            expect(status.remainingAnalyses).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit);
            expect(status.eligible).toBe(true);
            expect(status.usedAnalyses).toBe(0);
            expect(status.totalLimit).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit);
        });
    });

    describe('consumeFreeAnalysis', () => {
        test('should successfully consume analysis when limit available', async () => {
            const userId = 'test_user_2';
            const result = await FreemiumController.consumeFreeAnalysis(userId, 'blood');

            expect(result.success).toBe(true);
            expect(result.remainingAnalyses).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit - 1);
            expect(result.analysisType).toBe('blood');
            expect(result.cost).toBe(0);
            expect(result.paymentMethod).toBe('free_tier');
        });

        test('should fail when limit exceeded', async () => {
            const userId = 'test_user_3';

            // Exhaust the limit
            for (let i = 0; i < FREEMIUM_CONFIG.monthlyAnalysisLimit; i++) {
                await FreemiumController.consumeFreeAnalysis(userId, 'test');
            }

            // Next attempt should fail
            const result = await FreemiumController.consumeFreeAnalysis(userId, 'test');
            expect(result.success).toBe(false);
            expect(result.reason).toBe('free_limit_exceeded');
            expect(result.upgradeRecommendations).toBeDefined();
        });
    });

    describe('getUpgradeRecommendations', () => {
        test('should return valid upgrade recommendations', async () => {
            const userId = 'test_user_4';
            const recommendations = await FreemiumController.getUpgradeRecommendations(userId);

            expect(Array.isArray(recommendations)).toBe(true);
            expect(recommendations.length).toBeGreaterThan(0);

            // Check credit recommendations
            const creditRecs = recommendations.filter(r => r.type === 'credit');
            expect(creditRecs.length).toBeGreaterThan(0);

            creditRecs.forEach(rec => {
                expect(rec.id).toBeDefined();
                expect(rec.title).toBeDefined();
                expect(rec.price).toBeGreaterThan(0);
                expect(rec.credits).toBeGreaterThan(0);
            });

            // Check subscription recommendations
            const subRecs = recommendations.filter(r => r.type === 'subscription');
            expect(subRecs.length).toBeGreaterThan(0);

            subRecs.forEach(rec => {
                expect(rec.id).toBeDefined();
                expect(rec.title).toBeDefined();
                expect(rec.price).toBeGreaterThan(0);
                expect(Array.isArray(rec.features)).toBe(true);
            });
        });
    });

    describe('getFreemiumStatus', () => {
        test('should return comprehensive status information', async () => {
            const userId = 'test_user_5';
            const status = await FreemiumController.getFreemiumStatus(userId);

            expect(status.remainingAnalyses).toBeDefined();
            expect(status.eligible).toBeDefined();
            expect(status.usedAnalyses).toBeDefined();
            expect(status.totalLimit).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit);
            expect(status.resetDate).toBeInstanceOf(Date);
            expect(status.config.monthlyLimit).toBe(FREEMIUM_CONFIG.monthlyAnalysisLimit);
            expect(status.config.resetDay).toBe(FREEMIUM_CONFIG.resetDay);
        });
    });
});