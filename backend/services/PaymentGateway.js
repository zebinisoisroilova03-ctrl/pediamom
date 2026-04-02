/**
 * Payment Gateway Service
 * 
 * Abstracts payment processing and provides unified interface for all payment operations
 * Integrates with Stripe API for secure payment processing
 */

const { stripe, STRIPE_CONFIG, verifyWebhookSignature } = require('../config/stripe');

class PaymentGateway {
    constructor() {
        this.stripe = stripe;
        this.config = STRIPE_CONFIG;
    }

    /**
     * Create a payment intent for processing payments
     * @param {number} amount - Amount in cents
     * @param {string} currency - Currency code (default: 'usd')
     * @param {object} metadata - Additional metadata for the payment
     * @returns {Promise<object>} Payment intent object
     */
    async createPaymentIntent(amount, currency = 'usd', metadata = {}) {
        try {
            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: Math.round(amount), // Ensure integer
                currency: currency.toLowerCase(),
                metadata: {
                    ...metadata,
                    timestamp: new Date().toISOString()
                },
                automatic_payment_methods: {
                    enabled: true
                }
            });

            return {
                success: true,
                paymentIntent: {
                    id: paymentIntent.id,
                    clientSecret: paymentIntent.client_secret,
                    amount: paymentIntent.amount,
                    currency: paymentIntent.currency,
                    status: paymentIntent.status
                }
            };
        } catch (error) {
            console.error('Error creating payment intent:', error);
            return {
                success: false,
                error: {
                    code: error.code || 'payment_intent_creation_failed',
                    message: error.message || 'Failed to create payment intent'
                }
            };
        }
    }

    /**
     * Confirm a payment intent
     * @param {string} paymentIntentId - Payment intent ID
     * @returns {Promise<object>} Payment result
     */
    async confirmPayment(paymentIntentId) {
        try {
            const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);

            return {
                success: paymentIntent.status === 'succeeded',
                paymentIntentId: paymentIntent.id,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                status: paymentIntent.status,
                paymentMethod: paymentIntent.payment_method
            };
        } catch (error) {
            console.error('Error confirming payment:', error);
            return {
                success: false,
                error: {
                    code: error.code || 'payment_confirmation_failed',
                    message: error.message || 'Failed to confirm payment'
                }
            };
        }
    }

    /**
     * Create a Stripe customer
     * @param {string} userId - User ID from Firebase
     * @param {string} email - User email
     * @param {object} additionalData - Additional customer data
     * @returns {Promise<object>} Customer object
     */
    async createCustomer(userId, email, additionalData = {}) {
        try {
            const customer = await this.stripe.customers.create({
                email,
                metadata: {
                    userId,
                    ...additionalData
                }
            });

            return {
                success: true,
                customer: {
                    id: customer.id,
                    email: customer.email,
                    created: customer.created
                }
            };
        } catch (error) {
            console.error('Error creating customer:', error);
            return {
                success: false,
                error: {
                    code: error.code || 'customer_creation_failed',
                    message: error.message || 'Failed to create customer'
                }
            };
        }
    }

    /**
     * Attach a payment method to a customer
     * @param {string} customerId - Stripe customer ID
     * @param {string} paymentMethodId - Payment method ID
     * @returns {Promise<object>} Result of attachment
     */
    async attachPaymentMethod(customerId, paymentMethodId) {
        try {
            await this.stripe.paymentMethods.attach(paymentMethodId, {
                customer: customerId
            });

            return {
                success: true,
                paymentMethodId
            };
        } catch (error) {
            console.error('Error attaching payment method:', error);
            return {
                success: false,
                error: {
                    code: error.code || 'payment_method_attachment_failed',
                    message: error.message || 'Failed to attach payment method'
                }
            };
        }
    }

    /**
     * Process a refund for a payment
     * @param {string} paymentIntentId - Payment intent ID to refund
     * @param {number} amount - Amount to refund (optional, defaults to full amount)
     * @returns {Promise<object>} Refund result
     */
    async processRefund(paymentIntentId, amount = null) {
        try {
            const refundData = {
                payment_intent: paymentIntentId
            };

            if (amount !== null) {
                refundData.amount = Math.round(amount);
            }

            const refund = await this.stripe.refunds.create(refundData);

            return {
                success: true,
                refund: {
                    id: refund.id,
                    amount: refund.amount,
                    currency: refund.currency,
                    status: refund.status,
                    reason: refund.reason
                }
            };
        } catch (error) {
            console.error('Error processing refund:', error);
            return {
                success: false,
                error: {
                    code: error.code || 'refund_failed',
                    message: error.message || 'Failed to process refund'
                }
            };
        }
    }

    /**
     * Create a subscription for a customer
     * @param {string} customerId - Stripe customer ID
     * @param {string} priceId - Stripe price ID
     * @param {object} metadata - Additional metadata
     * @returns {Promise<object>} Subscription result
     */
    async createSubscription(customerId, priceId, metadata = {}) {
        try {
            const subscription = await this.stripe.subscriptions.create({
                customer: customerId,
                items: [{
                    price: priceId
                }],
                metadata,
                payment_behavior: 'default_incomplete',
                payment_settings: {
                    save_default_payment_method: 'on_subscription'
                },
                expand: ['latest_invoice.payment_intent']
            });

            return {
                success: true,
                subscription: {
                    id: subscription.id,
                    status: subscription.status,
                    clientSecret: subscription.latest_invoice.payment_intent.client_secret,
                    currentPeriodStart: new Date(subscription.current_period_start * 1000),
                    currentPeriodEnd: new Date(subscription.current_period_end * 1000)
                }
            };
        } catch (error) {
            console.error('Error creating subscription:', error);
            return {
                success: false,
                error: {
                    code: error.code || 'subscription_creation_failed',
                    message: error.message || 'Failed to create subscription'
                }
            };
        }
    }

    /**
     * Cancel a subscription
     * @param {string} subscriptionId - Stripe subscription ID
     * @param {boolean} atPeriodEnd - Whether to cancel at period end
     * @returns {Promise<object>} Cancellation result
     */
    async cancelSubscription(subscriptionId, atPeriodEnd = true) {
        try {
            let subscription;

            if (atPeriodEnd) {
                subscription = await this.stripe.subscriptions.update(subscriptionId, {
                    cancel_at_period_end: true
                });
            } else {
                subscription = await this.stripe.subscriptions.cancel(subscriptionId);
            }

            return {
                success: true,
                subscription: {
                    id: subscription.id,
                    status: subscription.status,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null
                }
            };
        } catch (error) {
            console.error('Error canceling subscription:', error);
            return {
                success: false,
                error: {
                    code: error.code || 'subscription_cancellation_failed',
                    message: error.message || 'Failed to cancel subscription'
                }
            };
        }
    }

    /**
     * Retrieve customer payment methods
     * @param {string} customerId - Stripe customer ID
     * @param {string} type - Payment method type (default: 'card')
     * @returns {Promise<object>} Payment methods list
     */
    async getPaymentMethods(customerId, type = 'card') {
        try {
            const paymentMethods = await this.stripe.paymentMethods.list({
                customer: customerId,
                type
            });

            return {
                success: true,
                paymentMethods: paymentMethods.data.map(pm => ({
                    id: pm.id,
                    type: pm.type,
                    card: pm.card ? {
                        brand: pm.card.brand,
                        last4: pm.card.last4,
                        expMonth: pm.card.exp_month,
                        expYear: pm.card.exp_year
                    } : null
                }))
            };
        } catch (error) {
            console.error('Error retrieving payment methods:', error);
            return {
                success: false,
                error: {
                    code: error.code || 'payment_methods_retrieval_failed',
                    message: error.message || 'Failed to retrieve payment methods'
                }
            };
        }
    }

    /**
     * Verify webhook signature and construct event
     * @param {string} payload - Raw request body
     * @param {string} signature - Stripe signature header
     * @returns {object} Verified Stripe event
     */
    verifyWebhook(payload, signature) {
        return verifyWebhookSignature(payload, signature);
    }

    /**
     * Handle webhook events
     * @param {object} event - Stripe webhook event
     * @returns {Promise<object>} Processing result
     */
    async handleWebhookEvent(event) {
        try {
            console.log(`Processing webhook event: ${event.type}`);

            switch (event.type) {
                case 'payment_intent.succeeded':
                    return await this._handlePaymentSucceeded(event.data.object);

                case 'payment_intent.payment_failed':
                    return await this._handlePaymentFailed(event.data.object);

                case 'invoice.payment_succeeded':
                    return await this._handleInvoicePaymentSucceeded(event.data.object);

                case 'invoice.payment_failed':
                    return await this._handleInvoicePaymentFailed(event.data.object);

                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    return await this._handleSubscriptionUpdated(event.data.object);

                case 'customer.subscription.deleted':
                    return await this._handleSubscriptionDeleted(event.data.object);

                default:
                    console.log(`Unhandled webhook event type: ${event.type}`);
                    return { success: true, message: 'Event type not handled' };
            }
        } catch (error) {
            console.error('Error handling webhook event:', error);
            return {
                success: false,
                error: {
                    code: 'webhook_processing_failed',
                    message: error.message
                }
            };
        }
    }

    /**
     * Handle successful payment intent
     * @private
     */
    async _handlePaymentSucceeded(paymentIntent) {
        // Implementation will be added when integrating with transaction records
        console.log('Payment succeeded:', paymentIntent.id);
        return { success: true, message: 'Payment success handled' };
    }

    /**
     * Handle failed payment intent
     * @private
     */
    async _handlePaymentFailed(paymentIntent) {
        // Implementation will be added when integrating with transaction records
        console.log('Payment failed:', paymentIntent.id);
        return { success: true, message: 'Payment failure handled' };
    }

    /**
     * Handle successful invoice payment
     * @private
     */
    async _handleInvoicePaymentSucceeded(invoice) {
        // Implementation will be added when integrating with subscription management
        console.log('Invoice payment succeeded:', invoice.id);
        return { success: true, message: 'Invoice payment success handled' };
    }

    /**
     * Handle failed invoice payment
     * @private
     */
    async _handleInvoicePaymentFailed(invoice) {
        // Implementation will be added when integrating with subscription management
        console.log('Invoice payment failed:', invoice.id);
        return { success: true, message: 'Invoice payment failure handled' };
    }

    /**
     * Handle subscription updates
     * @private
     */
    async _handleSubscriptionUpdated(subscription) {
        // Implementation will be added when integrating with subscription management
        console.log('Subscription updated:', subscription.id);
        return { success: true, message: 'Subscription update handled' };
    }

    /**
     * Handle subscription deletion
     * @private
     */
    async _handleSubscriptionDeleted(subscription) {
        // Implementation will be added when integrating with subscription management
        console.log('Subscription deleted:', subscription.id);
        return { success: true, message: 'Subscription deletion handled' };
    }
}

module.exports = PaymentGateway;