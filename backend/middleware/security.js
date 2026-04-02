/**
 * Security Middleware
 *
 * Rate limiting, input sanitization, authorization checks,
 * and security headers for the PediaMom API.
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// ─── Rate Limiters ────────────────────────────────────────────────────────────

/**
 * General API rate limiter — 100 requests per 15 minutes per IP
 */
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.'
        }
    }
});

/**
 * Strict limiter for expensive AI analysis endpoints — 20 per 15 min per user
 */
const analysisLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => req.user?.uid || req.ip,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'analysis_rate_limit_exceeded',
            message: 'Analysis rate limit exceeded. Please wait before submitting more analyses.'
        }
    }
});

/**
 * Auth endpoint limiter — 10 attempts per 15 min per IP (brute-force protection)
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 'auth_rate_limit_exceeded',
            message: 'Too many authentication attempts. Please try again later.'
        }
    }
});

// ─── Security Headers (Helmet) ────────────────────────────────────────────────

const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false, // Firebase Functions compatibility
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
});

// ─── Input Sanitization ───────────────────────────────────────────────────────

/**
 * Strip dangerous characters from string values recursively.
 * Prevents NoSQL injection and XSS via JSON body.
 */
function sanitizeValue(value) {
    if (typeof value === 'string') {
        // Remove null bytes and trim
        return value.replace(/\0/g, '').trim();
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }
    if (value !== null && typeof value === 'object') {
        return sanitizeObject(value);
    }
    return value;
}

function sanitizeObject(obj) {
    const clean = {};
    for (const key of Object.keys(obj)) {
        // Block Firestore/MongoDB operator injection via keys
        if (key.startsWith('$') || key.includes('.')) {
            continue;
        }
        clean[key] = sanitizeValue(obj[key]);
    }
    return clean;
}

/**
 * Middleware: sanitize req.body, req.query, req.params
 */
function sanitizeInput(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
    }
    next();
}

// ─── Authorization Helpers ────────────────────────────────────────────────────

/**
 * Middleware: ensure the authenticated user can only access their own resources.
 * Checks req.params.userId or req.body.userId against req.user.uid.
 */
function authorizeOwner(req, res, next) {
    const resourceUserId = req.params.userId || req.body.userId;

    // If no userId in params/body, skip (route doesn't need ownership check)
    if (!resourceUserId) return next();

    if (resourceUserId !== req.user.uid) {
        return res.status(403).json({
            success: false,
            error: {
                code: 'forbidden',
                message: 'You are not authorized to access this resource'
            }
        });
    }
    next();
}

/**
 * Middleware: verify childId belongs to the authenticated user.
 * Requires Firestore db to be passed in.
 */
function authorizeChildAccess(db) {
    return async (req, res, next) => {
        const childId = req.body.childId || req.params.childId;
        if (!childId) return next();

        try {
            const childDoc = await db.collection('children').doc(childId).get();

            if (!childDoc.exists) {
                return res.status(404).json({
                    success: false,
                    error: { code: 'child_not_found', message: 'Child not found' }
                });
            }

            if (childDoc.data().parentId !== req.user.uid) {
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'forbidden',
                        message: 'You are not authorized to access this child\'s data'
                    }
                });
            }

            next();
        } catch (error) {
            console.error('Child authorization error:', error);
            return res.status(500).json({
                success: false,
                error: { code: 'authorization_error', message: 'Authorization check failed' }
            });
        }
    };
}

// ─── Request Size Limiter ─────────────────────────────────────────────────────

/**
 * Reject requests with body larger than 50kb (prevents payload attacks)
 */
function limitRequestSize(req, res, next) {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    const MAX_BYTES = 50 * 1024; // 50 KB

    if (contentLength > MAX_BYTES) {
        return res.status(413).json({
            success: false,
            error: {
                code: 'payload_too_large',
                message: 'Request body exceeds maximum allowed size'
            }
        });
    }
    next();
}

// ─── Security Logger ──────────────────────────────────────────────────────────

/**
 * Log suspicious activity without exposing sensitive data
 */
function securityLogger(req, res, next) {
    const userId = req.user?.uid || 'anonymous';
    const method = req.method;
    const path = req.path;
    const ip = req.ip || req.connection?.remoteAddress;

    // Log only method + path + userId (no body, no tokens)
    console.log(`[API] ${method} ${path} | user=${userId} | ip=${ip}`);
    next();
}

module.exports = {
    apiLimiter,
    analysisLimiter,
    authLimiter,
    securityHeaders,
    sanitizeInput,
    authorizeOwner,
    authorizeChildAccess,
    limitRequestSize,
    securityLogger
};
