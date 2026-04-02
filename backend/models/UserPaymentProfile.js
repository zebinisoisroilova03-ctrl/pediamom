/**
 * User Payment Profile Data Model
 * 
 * Manages user payment information including credit balance,
 * subscription details, and payment methods
 */

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * User Payment Profile Schema
 */
const UserPaymentProfileSchema = {
    userId: 'string',           // Firebase Auth UID
    stripeCustomerId: 'string', // Stripe customer ID
    creditBalance: 'number',    // Current credit balance
    subscription: {             // Optional subscription object
        id: 'string',           // Stripe subscription ID
        tierId: 'string',       // Subscription tier ID
        status: 'string',       // active, canceled, past_due, etc.
        currentPeriodStart: 'timestamp',
        currentPeriodEnd: 'timestamp',
        cancelAtPeriodEnd: 'boolean'
    },
    paymentMethods: 'array',    // Array of payment method objects
    billingAddress: {           // Optional billing address
        line1: 'string',
        line2: 'string',
        city: 'string',
        state: 'string',
        postalCode: 'string',
        country: 'string'
    },
    createdAt: 'timestamp',
    updatedAt: 'timestamp'
};

/**
 * UserPaymentProfile Class
 */
class UserPaymentProfile {
    constructor(data = {}) {
        this.userId = data.userId || null;
        this.stripeCustomerId = data.stripeCustomerId || null;
        this.creditBalance = data.creditBalance || 0;
        this.subscription = data.subscription || null;
        this.paymentMethods = data.paymentMethods || [];
        this.billingAddress = data.billingAddress || null;
        this.createdAt = data.createdAt || admin.firestore.Timestamp.now();
        this.updatedAt = data.updatedAt || admin.firestore.Timestamp.now();
    }

    /**
     * Validate payment profile data
     */
    validate() {
        const errors = [];

        if (!this.userId || typeof this.userId !== 'string') {
            errors.push('userId is required and must be a string');
        }

        if (this.creditBalance < 0) {
            errors.push('creditBalance cannot be negative');
        }

        if (this.subscription) {
            if (!this.subscription.id || typeof this.subscription.id !== 'string') {
                errors.push('subscription.id is required when subscription exists');
            }
            if (!this.subscription.tierId || typeof this.subscription.tierId !== 'string') {
                errors.push('subscription.tierId is required when subscription exists');
            }
            if (!this.subscription.status || typeof this.subscription.status !== 'string') {
                errors.push('subscription.status is required when subscription exists');
            }
        }

        if (this.billingAddress) {
            if (!this.billingAddress.line1 || !this.billingAddress.city ||
                !this.billingAddress.postalCode || !this.billingAddress.country) {
                errors.push('billingAddress requires line1, city, postalCode, and country');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Convert to Firestore document format
     */
    toFirestore() {
        const validation = this.validate();
        if (!validation.isValid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        return {
            userId: this.userId,
            stripeCustomerId: this.stripeCustomerId,
            creditBalance: this.creditBalance,
            subscription: this.subscription,
            paymentMethods: this.paymentMethods,
            billingAddress: this.billingAddress,
            createdAt: this.createdAt,
            updatedAt: admin.firestore.Timestamp.now()
        };
    }

    /**
     * Create from Firestore document
     */
    static fromFirestore(doc) {
        if (!doc.exists) {
            return null;
        }

        const data = doc.data();
        return new UserPaymentProfile({
            ...data,
            id: doc.id
        });
    }
}

/**
 * UserPaymentProfile Service Functions
 */
class UserPaymentProfileService {
    static get collection() {
        return db.collection('user_payment_profiles');
    }

    /**
     * Create a new user payment profile
     */
    static async create(userId, stripeCustomerId = null) {
        try {
            const profile = new UserPaymentProfile({
                userId,
                stripeCustomerId,
                creditBalance: 0
            });

            const docRef = this.collection.doc(userId);
            await docRef.set(profile.toFirestore());

            return profile;
        } catch (error) {
            console.error('Error creating user payment profile:', error);
            throw new Error('Failed to create user payment profile');
        }
    }

    /**
     * Get user payment profile by userId
     */
    static async getByUserId(userId) {
        try {
            const doc = await this.collection.doc(userId).get();
            return UserPaymentProfile.fromFirestore(doc);
        } catch (error) {
            console.error('Error getting user payment profile:', error);
            throw new Error('Failed to get user payment profile');
        }
    }

    /**
     * Update user payment profile
     */
    static async update(userId, updates) {
        try {
            const docRef = this.collection.doc(userId);
            const updateData = {
                ...updates,
                updatedAt: admin.firestore.Timestamp.now()
            };

            await docRef.update(updateData);

            // Return updated profile
            return await this.getByUserId(userId);
        } catch (error) {
            console.error('Error updating user payment profile:', error);
            throw new Error('Failed to update user payment profile');
        }
    }

    /**
     * Add credits to user balance (atomic operation)
     */
    static async addCredits(userId, credits) {
        try {
            const docRef = this.collection.doc(userId);

            return await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);

                if (!doc.exists) {
                    throw new Error('User payment profile not found');
                }

                const currentBalance = doc.data().creditBalance || 0;
                const newBalance = currentBalance + credits;

                transaction.update(docRef, {
                    creditBalance: newBalance,
                    updatedAt: admin.firestore.Timestamp.now()
                });

                return newBalance;
            });
        } catch (error) {
            console.error('Error adding credits:', error);
            throw new Error('Failed to add credits');
        }
    }

    /**
     * Deduct credits from user balance (atomic operation)
     */
    static async deductCredits(userId, credits) {
        try {
            const docRef = this.collection.doc(userId);

            return await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);

                if (!doc.exists) {
                    throw new Error('User payment profile not found');
                }

                const currentBalance = doc.data().creditBalance || 0;

                if (currentBalance < credits) {
                    throw new Error('Insufficient credits');
                }

                const newBalance = currentBalance - credits;

                transaction.update(docRef, {
                    creditBalance: newBalance,
                    updatedAt: admin.firestore.Timestamp.now()
                });

                return newBalance;
            });
        } catch (error) {
            console.error('Error deducting credits:', error);
            throw error; // Re-throw to preserve specific error messages
        }
    }

    /**
     * Update subscription information
     */
    static async updateSubscription(userId, subscriptionData) {
        try {
            return await this.update(userId, {
                subscription: subscriptionData
            });
        } catch (error) {
            console.error('Error updating subscription:', error);
            throw new Error('Failed to update subscription');
        }
    }

    /**
     * Add payment method
     */
    static async addPaymentMethod(userId, paymentMethod) {
        try {
            const profile = await this.getByUserId(userId);
            if (!profile) {
                throw new Error('User payment profile not found');
            }

            const updatedMethods = [...profile.paymentMethods, paymentMethod];

            return await this.update(userId, {
                paymentMethods: updatedMethods
            });
        } catch (error) {
            console.error('Error adding payment method:', error);
            throw new Error('Failed to add payment method');
        }
    }

    /**
     * Remove payment method
     */
    static async removePaymentMethod(userId, paymentMethodId) {
        try {
            const profile = await this.getByUserId(userId);
            if (!profile) {
                throw new Error('User payment profile not found');
            }

            const updatedMethods = profile.paymentMethods.filter(
                method => method.id !== paymentMethodId
            );

            return await this.update(userId, {
                paymentMethods: updatedMethods
            });
        } catch (error) {
            console.error('Error removing payment method:', error);
            throw new Error('Failed to remove payment method');
        }
    }

    /**
     * Get or create user payment profile
     */
    static async getOrCreate(userId, stripeCustomerId = null) {
        try {
            let profile = await this.getByUserId(userId);

            if (!profile) {
                profile = await this.create(userId, stripeCustomerId);
            }

            return profile;
        } catch (error) {
            console.error('Error getting or creating user payment profile:', error);
            throw new Error('Failed to get or create user payment profile');
        }
    }
}

module.exports = {
    UserPaymentProfile,
    UserPaymentProfileService,
    UserPaymentProfileSchema
};