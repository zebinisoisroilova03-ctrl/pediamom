/**
 * AI Analysis API Routes with Payment Integration
 */

const express = require('express');
const admin = require('firebase-admin');
const { AnalysisService } = require('../services/AnalysisService');
const { authenticateUser } = require('../middleware/auth');
const { validateAnalysisRequest } = require('../middleware/validation');
const { analysisLimiter, authorizeChildAccess } = require('../middleware/security');

const router = express.Router();
const analysisService = new AnalysisService();
const db = admin.firestore();

/**
 * POST /api/analysis/estimate
 * Estimate cost for AI analysis
 */
router.post('/estimate', authenticateUser, analysisLimiter, async (req, res) => {
    try {
        const { analysisType, childId, values } = req.body;

        if (!analysisType) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'missing_analysis_type',
                    message: 'Analysis type is required'
                }
            });
        }

        const result = await analysisService.getCostEstimate(req.user.uid, {
            type: analysisType,
            childId,
            values
        });

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);

    } catch (error) {
        console.error('Cost estimation error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'estimation_failed',
                message: 'Failed to estimate analysis cost'
            }
        });
    }
});

/**
 * POST /api/analysis/execute
 * Execute AI analysis with payment processing
 */
router.post('/execute', authenticateUser, analysisLimiter, validateAnalysisRequest, authorizeChildAccess(db), async (req, res) => {
    try {
        const { childId, type, values, paymentPreference } = req.body;

        const result = await analysisService.executeAnalysisWithPayment(req.user.uid, {
            childId,
            type,
            values,
            paymentPreference
        });

        // Set appropriate HTTP status based on result
        if (!result.success) {
            const statusCode = result.retryable ? 402 : 400; // 402 Payment Required for retryable payment issues
            return res.status(statusCode).json(result);
        }

        res.json(result);

    } catch (error) {
        console.error('Analysis execution error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'analysis_failed',
                message: 'Failed to execute analysis'
            }
        });
    }
});

/**
 * GET /api/analysis/history
 * Get analysis history with payment information
 */
router.get('/history', authenticateUser, async (req, res) => {
    try {
        const { startDate, endDate, limit } = req.query;

        const options = {};
        if (startDate) options.startDate = new Date(startDate);
        if (endDate) options.endDate = new Date(endDate);
        if (limit) options.limit = parseInt(limit);

        const result = await analysisService.getAnalysisHistory(req.user.uid, options);

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);

    } catch (error) {
        console.error('Analysis history error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'history_failed',
                message: 'Failed to retrieve analysis history'
            }
        });
    }
});

/**
 * POST /api/analysis/retry
 * Retry failed analysis with different payment method
 */
router.post('/retry', authenticateUser, analysisLimiter, validateAnalysisRequest, authorizeChildAccess(db), async (req, res) => {
    try {
        const { childId, type, values, paymentPreference, originalAnalysisId } = req.body;

        // Log retry attempt for analytics
        console.log(`Analysis retry attempt for user ${req.user.uid}, original analysis: ${originalAnalysisId}`);

        const result = await analysisService.executeAnalysisWithPayment(req.user.uid, {
            childId,
            type,
            values,
            paymentPreference
        });

        if (!result.success) {
            const statusCode = result.retryable ? 402 : 400;
            return res.status(statusCode).json(result);
        }

        res.json({
            ...result,
            retryInfo: {
                originalAnalysisId,
                retryTimestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Analysis retry error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'retry_failed',
                message: 'Failed to retry analysis'
            }
        });
    }
});

module.exports = router;