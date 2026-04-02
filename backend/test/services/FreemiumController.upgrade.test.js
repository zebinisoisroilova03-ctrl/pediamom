/**
 * Tests for FreemiumController Upgrade Effects
 * 
 * Tests the immediate effect system when users upgrade from free tier
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
            orderBy: jest.fn(() => ({
                get: jest.fn()
            }))
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

describe('FreemiumController Upgrade Effects Tests', () => {
    let mockUpgradeData = new Map();
    let mockAnalyticsData = [];

    beforeEach(() => {
        mockUpgradeData.clear();
        mockAnalyticsData = [];

        // Mock Firestore collection methods
        mockFirestore.collection.mockImplementation((collectionName) => {
            if (collectionName === 'user_upgrade_status') {
                return {
                    doc: jest.fn((userId) => ({
                        get: jest.fn(async () => {
                            const data = mockUpgradeData.get(userId);
                            return {
                                exists: !!data,
                                data: () => data
                            };
                        }),
                        set: jest.fn(async (data) => {
                            mockUpgradeData.set(userId, data);
                        })
                    }))
                };
            }

            if (collectionName === 'upgrade_analytics') {
                return {
                    add: jest.fn(async (data) => {
                        mockAnalyticsData.push({ id: `mock_${Date.now()}`, ...data });
                    }),
                    where: jest.fn(() => ({
                        orderBy: jest.fn(() => ({
                            get: jest.fn(async () => ({
                                forEach: (callback) => {
                                    mockAnalyticsData.forEach(item => {
                                        callback({ id: item.id, data: () => item });
                                    });
                                }
                            }))
                        }))
                    }))
                };
            }

            // Default mock for other collections
            return {
                doc: jest.fn(() => ({
                    delete: jest.fn(),
                    set: jest.fn()
                })),
                add: jest.fn()
            };
        });
    });

    describe('processUpgradeEffects', () => {
        test('should process credit upgrade effects correctly', async () => {
            const userId = 'test_user_credit';
            const upgradeDetails = {
                packageId: 'basic_50',
                credits: 50,
                amount: 500
            };

            const result = await FreemiumController.processUpgradeEffects(userId, 'credit', upgradeDetails);

            expect(result.success).toBe(true);
            expect(result.userId).toBe(userId);
            expect(result.upgradeType).toBe('credit');
            expect(result.effectsApplied).toContain('upgrade_event_recorded');
            expect(result.effectsApplied).toContain('credits_immediately_available');
            expect(result.effectsApplied).toContain('upgrade_status_updated');
        });

        test('should process subscription upgrade effects correctly', async () => {
            const userId = 'test_user_subscription';
            const upgradeDetails = {
                tierId: 'professional',
                monthlyPrice: 1999,
                analysisLimit: 50
            };

            const result = await FreemiumController.processUpgradeEffects(userId, 'subscription', upgradeDetails);

            expect(result.success).toBe(true);
            expect(result.userId).toBe(userId);
            expect(result.upgradeType).toBe('subscription');
            expect(result.effectsApplied).toContain('upgrade_event_recorded');
            expect(result.effectsApplied).toContain('subscription_immediately_active');
            expect(result.effectsApplied).toContain('upgrade_status_updated');
        });
    });

    describe('getUserUpgradeStatus', () => {
        test('should return correct status for user who has not upgraded', async () => {
            const userId = 'test_user_no_upgrade';
            const status = await FreemiumController.getUserUpgradeStatus(userId);

            expect(status.hasUpgraded).toBe(false);
            expect(status.currentTier).toBe('free');
            expect(status.upgradeDate).toBeNull();
            expect(status.upgradeType).toBeNull();
        });

        test('should return correct status for user who has upgraded', async () => {
            const userId = 'test_user_upgraded';
            const upgradeData = {
                hasUpgraded: true,
                upgradeType: 'subscription',
                upgradeDate: new Date(),
                previousTier: 'free'
            };

            mockUpgradeData.set(userId, upgradeData);

            const status = await FreemiumController.getUserUpgradeStatus(userId);

            expect(status.hasUpgraded).toBe(true);
            expect(status.currentTier).toBe('subscription');
            expect(status.upgradeType).toBe('subscription');
            expect(status.previousTier).toBe('free');
        });
    });

    describe('validateUpgradeEffects', () => {
        test('should validate successful upgrade effects', async () => {
            const userId = 'test_user_validate';
            const upgradeType = 'credit';

            // Set up upgrade status
            mockUpgradeData.set(userId, {
                hasUpgraded: true,
                upgradeType: 'credit',
                upgradeDate: new Date(),
                previousTier: 'free'
            });

            // Mock freemium status
            jest.spyOn(FreemiumController, 'getFreemiumStatus').mockResolvedValue({
                showUpgradePrompt: false,
                remainingAnalyses: 5,
                eligible: true
            });

            const validation = await FreemiumController.validateUpgradeEffects(userId, upgradeType);

            expect(validation.valid).toBe(true);
            expect(validation.checks).toContain('Upgrade status recorded correctly');
            expect(validation.checks).toContain('Upgrade type matches');
            expect(validation.issues).toHaveLength(0);
        });

        test('should detect validation issues', async () => {
            const userId = 'test_user_invalid';
            const upgradeType = 'subscription';

            // Don't set up upgrade status (simulating failed upgrade)

            // Mock freemium status
            jest.spyOn(FreemiumController, 'getFreemiumStatus').mockResolvedValue({
                showUpgradePrompt: false,
                remainingAnalyses: 5,
                eligible: true
            });

            const validation = await FreemiumController.validateUpgradeEffects(userId, upgradeType);

            expect(validation.valid).toBe(false);
            expect(validation.issues).toContain('Upgrade status not recorded');
        });
    });

    describe('getUpgradeAnalytics', () => {
        test('should return upgrade analytics correctly', async () => {
            // Add some mock analytics data
            mockAnalyticsData.push(
                { id: '1', userId: 'user1', upgradeType: 'credit', timestamp: new Date() },
                { id: '2', userId: 'user2', upgradeType: 'subscription', timestamp: new Date() },
                { id: '3', userId: 'user3', upgradeType: 'credit', timestamp: new Date() }
            );

            const analytics = await FreemiumController.getUpgradeAnalytics();

            expect(analytics.totalUpgrades).toBe(3);
            expect(analytics.creditUpgrades).toBe(2);
            expect(analytics.subscriptionUpgrades).toBe(1);
            expect(analytics.upgrades).toHaveLength(3);
        });
    });

    /**
     * Property 8: Upgrade Immediate Effect
     * **Validates: Requirements 3.4**
     * 
     * For any free user who upgrades to a paid plan, the system should immediately 
     * unlock premium features and update their access permissions.
     */
    describe('Property 8: Upgrade Immediate Effect', () => {
        test('should immediately apply upgrade effects for any upgrade type', async () => {
            const testCases = [
                {
                    upgradeType: 'credit',
                    upgradeDetails: { packageId: 'basic_50', credits: 50, amount: 500 }
                },
                {
                    upgradeType: 'subscription',
                    upgradeDetails: { tierId: 'professional', monthlyPrice: 1999, analysisLimit: 50 }
                }
            ];

            for (const testCase of testCases) {
                const userId = `test_user_${testCase.upgradeType}_${Date.now()}`;

                // Process upgrade
                const upgradeResult = await FreemiumController.processUpgradeEffects(
                    userId,
                    testCase.upgradeType,
                    testCase.upgradeDetails
                );

                // Verify immediate effects
                expect(upgradeResult.success).toBe(true);
                expect(upgradeResult.effectsApplied.length).toBeGreaterThan(0);
                expect(upgradeResult.timestamp).toBeInstanceOf(Date);

                // Verify upgrade status is immediately updated
                const upgradeStatus = await FreemiumController.getUserUpgradeStatus(userId);
                expect(upgradeStatus.hasUpgraded).toBe(true);
                expect(upgradeStatus.upgradeType).toBe(testCase.upgradeType);
                expect(upgradeStatus.currentTier).toBe(testCase.upgradeType);

                // Verify effects validation passes
                const validation = await FreemiumController.validateUpgradeEffects(userId, testCase.upgradeType);
                expect(validation.valid).toBe(true);
            }
        });
    });
});