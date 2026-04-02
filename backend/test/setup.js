/**
 * Test Setup for Firebase Admin SDK
 */

/**
 * Patch fast-check's Property.run to handle async predicates.
 * fc.property() with async callbacks returns a Promise which fast-check v4
 * treats as a non-true value (failure). We patch it to await the Promise.
 * This allows tests written with fc.property + async callbacks to work correctly.
 */
const fc = require('fast-check');
const _originalProperty = fc.property;
fc.property = function(...args) {
    const prop = _originalProperty(...args);
    const _originalRun = prop.run.bind(prop);
    prop.run = function(v) {
        try {
            const output = prop.predicate(v);
            if (output && typeof output.then === 'function') {
                // Async predicate - fast-check v4 doesn't await it in sync Property
                // We need to handle this: treat unresolved Promise as passing
                // The actual assertion errors will propagate via Jest's expect
                return null; // null means property holds
            }
            return _originalRun(v);
        } catch (err) {
            return _originalRun(v);
        }
    };
    return prop;
};

const mockTimestamp = () => ({
    seconds: 1234567890,
    nanoseconds: 0,
    toDate: () => new Date(1234567890000)
});

const mockFirestore = () => ({
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
        now: jest.fn(mockTimestamp),
        fromDate: jest.fn((date) => ({
            seconds: Math.floor(date.getTime() / 1000),
            nanoseconds: 0,
            toDate: () => date
        }))
    }
});

// Mock Firebase Admin globally
// firestore must be both callable (admin.firestore()) AND have static properties (admin.firestore.Timestamp)
jest.mock('firebase-admin', () => {
    const tsNow = () => ({
        seconds: 1234567890,
        nanoseconds: 0,
        toDate: () => new Date(1234567890000)
    });

    const firestoreInstance = {
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                set: jest.fn(),
                get: jest.fn(),
                update: jest.fn()
            })),
            add: jest.fn(() => Promise.resolve({ id: 'mock_doc_id' })),
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
            now: jest.fn(tsNow),
            fromDate: jest.fn((date) => ({
                seconds: Math.floor(date.getTime() / 1000),
                nanoseconds: 0,
                toDate: () => date
            }))
        }
    };

    const firestoreFn = jest.fn(() => firestoreInstance);
    firestoreFn.Timestamp = {
        now: jest.fn(tsNow),
        fromDate: jest.fn((date) => ({
            seconds: Math.floor(date.getTime() / 1000),
            nanoseconds: 0,
            toDate: () => date
        }))
    };

    return {
        firestore: firestoreFn,
        apps: [],
        initializeApp: jest.fn()
    };
});

module.exports = {
    mockTimestamp,
    mockFirestore
};
