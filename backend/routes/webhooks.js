/**
 * Webhook Routes for AI Monetization System
 * 
 * Handles webhook events from external payment providers
 * Requires raw body parsing for signature verification
 */

const express = require('express');
const router = express.Router();
const PaymentGateway = require('../services/PaymentGateway');

/**
 * Stripe Webhook Handler
 * 
 * Processes Stripe webhook events with signature verification
 * Handles payment intents, subscriptions, and invoice events
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
        console.error('Missing Stripe signature header');
        return res.status(400).json({
            success: false,
            error: {
                code: 'missing_signature',
                message: 'Missing Stripe signature header'
            }
        });
    }

    try {
        const paymentGateway = new PaymentGateway();

        // Verify webhook signature and construct event
        const event = paymentGateway.verifyWebhook(req.body, signature);

        console.log(`Received Stripe webhook: ${event.type} (ID: ${event.id})`);

        // Process the webhook event
        const result = await paymentGateway.handleWebhookEvent(event);

        if (result.success) {
            console.log(`Successfully processed webhook: ${event.type}`);
            res.status(200).json({
                received: true,
                eventId: event.id,
                eventType: event.type
            });
        } else {
            console.error('Webhook processing failed:', result.error);
            res.status(500).json({
                success: false,
                error: result.error
            });
        }
    } catch (error) {
        console.error('Webhook signature verification failed:', error.message);

        // Return 400 for signature verification failures
        // This tells Stripe the webhook was received but invalid
        return res.status(400).json({
            success: false,
            error: {
                code: 'invalid_signature',
                message: 'Invalid webhook signature'
            }
        });
    }
});

/**
 * Webhook Health Check
 * 
 * Simple endpoint to verify webhook endpoint is accessible
 */
router.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Webhook endpoint is healthy',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;