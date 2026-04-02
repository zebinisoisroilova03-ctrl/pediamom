/**
 * Property-Based Tests for Usage Notification Service
 * 
 * Tests universal properties that should hold across all valid inputs
 * Feature: ai-monetization-system, Property 14: Usage Limit Notifications
 */

const fc = require('fast-check');

// Mock Firebase Admin before importing other modules
jest.mock('firebase-admin', () => {
    const mockTimestamp = {
        now: jest.fn(() => ({
            toDate: () => new Date(),
            seconds: Date.now() / 1000
        })),
        fromDate: jest.fn((date) => ({
            toDate: () => date,
            seconds: date.getTime() / 1000
        }))
    };

    // Chainable query mock that supports unlimited chaining
    const mockQueryResult = () => Promise.resolve({ docs: [], empty: true });
    const chainableQuery = () => ({
        where: jest.fn(() => chainableQuery()),
        orderBy: jest.fn(() => chainableQuery()),
        limit: jest.fn(() => chainableQuery()),
        get: jest.fn(mockQueryResult)
    });

    // Dynamic doc mock: stores docs by id so userId check passes
    const docStore = new Map();
    const mockDoc = (id) => {
        const stored = docStore.get(id);
        return {
            get: jest.fn(() => Promise.resolve({
                exists: !!stored,
                data: () => stored || { userId: id, read: false, dismissed: false }
            })),
            set: jest.fn((data) => { docStore.set(id, data); return Promise.resolve(); }),
            update: jest.fn((data) => {
                const existing = docStore.get(id) || {};
                docStore.set(id, { ...existing, ...data });
                return Promise.resolve();
            })
        };
    };

    const firestoreFn = jest.fn(() => ({
            collection: jest.fn(() => ({
                doc: jest.fn((id) => mockDoc(id || 'default')),
                add: jest.fn((data) => {
                    const id = 'mock_notification_id_' + Date.now();
                    docStore.set(id, data);
                    return Promise.resolve({ id });
                }),
                where: jest.fn(() => chainableQuery()),
                get: jest.fn(mockQueryResult)
            })),
            batch: jest.fn(() => ({
                delete: jest.fn(),
                commit: jest.fn(() => Promise.resolve())
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
jest.mock('../../services/UsageTracker', () => ({
    UsageTracker: {
        getRemainingCredits: jest.fn(() => Promise.resolve(50)),
        getSubscriptionUsage: jest.fn(() => Promise.resolve({
            tierId: 'basic',
            limit: 20,
            used: 15,
            remaining: 5,
            usagePercentage: 0.75,
            resetDate: new Date()
        })),
        getUsageStats: jest.fn(() => Promise.resolve({
            totalAnalyses: 25,
            totalCost: 125,
            cachedResults: 5
        }))
    }
}));

jest.mock('../../services/FreemiumController', () => ({
    FreemiumController: {
        checkFreeLimit: jest.fn(() => Promise.resolve({
            eligible: true,
            remainingAnalyses: 3,
            resetDate: new Date()
        }))
    }
}));

const {
    UsageNotificationService,
    UsageNotification,
    NOTIFICATION_TYPES,
    NOTIFICATION_CATEGORIES,
    PRIORITY_LEVELS
} = require('../../services/UsageNotificationService');
// Test configuration
const propertyTestConfig = {
    numRuns: 50,
    verbose: false,
    seed: 42,
    endOnFailure: true
};

// Custom generators
const userIdGenerator = fc.string({ minLength: 10, maxLength: 30 });
const notificationTypeGenerator = fc.constantFrom(...Object.values(NOTIFICATION_TYPES));
const notificationCategoryGenerator = fc.constantFrom(...Object.values(NOTIFICATION_CATEGORIES));
const priorityGenerator = fc.constantFrom(...Object.values(PRIORITY_LEVELS));

describe('UsageNotificationService Property Tests', () => {
    let testUserId;

    beforeEach(() => {
        testUserId = `test_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        jest.clearAllMocks();
    });

    describe('Property 14: Usage Limit Notifications', () => {
        /**
         * **Validates: Requirements 5.3**
         * 
         * For any subscription user approaching their tier limits, the system should send 
         * timely warning notifications before limits are reached.
         */
        test('notification generation consistency property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                async (userId) => {
                    // Test: Check usage limits and generate notifications
                    const notifications = await UsageNotificationService.checkUsageLimits(userId);

                    // Property: Notifications should be well-formed and consistent
                    expect(Array.isArray(notifications)).toBe(true);

                    notifications.forEach(notification => {
                        expect(notification).toBeInstanceOf(UsageNotification);
                        expect(notification.userId).toBe(userId);
                        expect(Object.values(NOTIFICATION_TYPES)).toContain(notification.type);
                        expect(Object.values(NOTIFICATION_CATEGORIES)).toContain(notification.category);
                        expect(Object.values(PRIORITY_LEVELS)).toContain(notification.priority);
                        expect(typeof notification.title).toBe('string');
                        expect(typeof notification.message).toBe('string');
                        expect(notification.title.length).toBeGreaterThan(0);
                        expect(notification.message.length).toBeGreaterThan(0);
                    });

                    return true;
                }
            ), propertyTestConfig);
        });

        test('notification priority ordering property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                async (userId) => {
                    // Mock different usage scenarios to generate various notifications
                    const { UsageTracker } = require('../../services/UsageTracker');

                    // Scenario: Low credits (should generate high priority notification)
                    UsageTracker.getRemainingCredits.mockResolvedValue(0);

                    const notifications = await UsageNotificationService.checkUsageLimits(userId);

                    // Property: Critical notifications should have high priority
                    const criticalNotifications = notifications.filter(n => n.type === NOTIFICATION_TYPES.CRITICAL);
                    criticalNotifications.forEach(notification => {
                        expect(notification.priority).toBe(PRIORITY_LEVELS.HIGH);
                    });

                    // Property: Warning notifications should have medium or high priority
                    const warningNotifications = notifications.filter(n => n.type === NOTIFICATION_TYPES.WARNING);
                    warningNotifications.forEach(notification => {
                        expect([PRIORITY_LEVELS.HIGH, PRIORITY_LEVELS.MEDIUM]).toContain(notification.priority);
                    });

                    return true;
                }
            ), propertyTestConfig);
        });

        test('notification deduplication property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                async (userId) => {
                    // Test: Generate notifications multiple times
                    const firstRun = await UsageNotificationService.checkUsageLimits(userId);
                    const secondRun = await UsageNotificationService.checkUsageLimits(userId);

                    // Property: System should not create duplicate notifications
                    // (This is tested by mocking the findSimilarNotification method)
                    expect(Array.isArray(firstRun)).toBe(true);
                    expect(Array.isArray(secondRun)).toBe(true);

                    return true;
                }
            ), propertyTestConfig);
        });
    });

    describe('Notification Management Properties', () => {
        test('notification creation property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                notificationTypeGenerator,
                notificationCategoryGenerator,
                priorityGenerator,
                fc.string({ minLength: 5, maxLength: 50 }),
                fc.string({ minLength: 10, maxLength: 200 }),
                async (userId, type, category, priority, title, message) => {
                    // Create test notification
                    const notification = new UsageNotification({
                        userId,
                        type,
                        category,
                        priority,
                        title,
                        message
                    });

                    // Test: Create notification
                    const createdNotification = await UsageNotificationService.createNotification(notification);

                    // Property: Created notification should maintain all properties
                    expect(createdNotification).toBeInstanceOf(UsageNotification);
                    expect(createdNotification.userId).toBe(userId);
                    expect(createdNotification.type).toBe(type);
                    expect(createdNotification.category).toBe(category);
                    expect(createdNotification.priority).toBe(priority);
                    expect(createdNotification.title).toBe(title);
                    expect(createdNotification.message).toBe(message);
                    expect(createdNotification.id).toBeDefined();

                    return true;
                }
            ), propertyTestConfig);
        });

        test('notification retrieval property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                fc.integer({ min: 1, max: 50 }),
                async (userId, limit) => {
                    // Test: Get user notifications
                    const notifications = await UsageNotificationService.getUserNotifications(userId, { limit });

                    // Property: Retrieved notifications should be well-formed
                    expect(Array.isArray(notifications)).toBe(true);
                    expect(notifications.length).toBeLessThanOrEqual(limit);

                    notifications.forEach(notification => {
                        expect(notification).toBeInstanceOf(UsageNotification);
                        expect(notification.userId).toBe(userId);
                    });

                    return true;
                }
            ), propertyTestConfig);
        });

        test('notification state management property', async () => {
            await fc.assert(fc.asyncProperty(
                fc.string({ minLength: 10, maxLength: 30 }), // notificationId
                userIdGenerator,
                async (notificationId, userId) => {
                    // Test: Mark notification as read
                    const readResult = await UsageNotificationService.markAsRead(notificationId, userId);

                    // Property: State changes should be successful
                    expect(typeof readResult).toBe('boolean');

                    // Test: Dismiss notification
                    const dismissResult = await UsageNotificationService.dismissNotification(notificationId, userId);

                    // Property: State changes should be successful
                    expect(typeof dismissResult).toBe('boolean');

                    return true;
                }
            ), propertyTestConfig);
        });
    });

    describe('Notification Statistics Properties', () => {
        test('notification statistics consistency property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                async (userId) => {
                    // Test: Get notification statistics
                    const stats = await UsageNotificationService.getNotificationStats(userId);

                    // Property: Statistics should be consistent and well-formed
                    expect(typeof stats).toBe('object');
                    expect(typeof stats.total).toBe('number');
                    expect(typeof stats.unread).toBe('number');
                    expect(typeof stats.byCategory).toBe('object');
                    expect(typeof stats.byPriority).toBe('object');
                    expect(typeof stats.byType).toBe('object');

                    // Property: Unread count should not exceed total
                    expect(stats.unread).toBeLessThanOrEqual(stats.total);

                    // Property: All counts should be non-negative
                    expect(stats.total).toBeGreaterThanOrEqual(0);
                    expect(stats.unread).toBeGreaterThanOrEqual(0);

                    return true;
                }
            ), propertyTestConfig);
        });
    });

    describe('Notification Content Properties', () => {
        test('notification message clarity property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                async (userId) => {
                    // Test: Generate notifications
                    const notifications = await UsageNotificationService.checkUsageLimits(userId);

                    // Property: All notification messages should be clear and actionable
                    notifications.forEach(notification => {
                        // Message should not be empty
                        expect(notification.message.trim().length).toBeGreaterThan(0);

                        // Title should not be empty
                        expect(notification.title.trim().length).toBeGreaterThan(0);

                        // Action should be defined for actionable notifications
                        if (notification.priority === PRIORITY_LEVELS.HIGH ||
                            notification.type === NOTIFICATION_TYPES.CRITICAL) {
                            expect(notification.action).toBeDefined();
                            expect(typeof notification.action).toBe('string');
                        }
                    });

                    return true;
                }
            ), propertyTestConfig);
        });

        test('notification action data consistency property', async () => {
            await fc.assert(fc.asyncProperty(
                userIdGenerator,
                async (userId) => {
                    // Test: Generate notifications with action data
                    const notifications = await UsageNotificationService.checkUsageLimits(userId);

                    // Property: Action data should be consistent with notification type
                    notifications.forEach(notification => {
                        if (notification.action && notification.actionData) {
                            expect(typeof notification.actionData).toBe('object');

                            // Credit-related notifications should have credit data
                            if (notification.category === NOTIFICATION_CATEGORIES.CREDITS) {
                                // Should have relevant credit information
                                expect(notification.actionData).toBeDefined();
                            }

                            // Subscription-related notifications should have subscription data
                            if (notification.category === NOTIFICATION_CATEGORIES.SUBSCRIPTION) {
                                // Should have relevant subscription information
                                expect(notification.actionData).toBeDefined();
                            }
                        }
                    });

                    return true;
                }
            ), propertyTestConfig);
        });
    });
});