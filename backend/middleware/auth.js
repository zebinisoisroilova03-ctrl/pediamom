/**
 * Authentication middleware
 */

const admin = require('firebase-admin');

/**
 * Authenticate user using Firebase Auth token.
 * Verifies token signature, expiry, and revocation.
 */
async function authenticateUser(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'missing_auth_token',
                    message: 'Authentication token is required'
                }
            });
        }

        const token = authHeader.substring(7);

        // checkRevoked: true — rejects tokens invalidated after password change / sign-out
        const decodedToken = await admin.auth().verifyIdToken(token, true);

        // Attach minimal user info (never attach full token to req)
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email || null,
            emailVerified: decodedToken.email_verified || false
        };

        next();
    } catch (error) {
        // Distinguish revoked vs invalid tokens
        if (error.code === 'auth/id-token-revoked') {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'token_revoked',
                    message: 'Session has been revoked. Please sign in again.'
                }
            });
        }

        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'token_expired',
                    message: 'Session has expired. Please sign in again.'
                }
            });
        }

        // Generic auth failure — don't leak error details
        return res.status(401).json({
            success: false,
            error: {
                code: 'invalid_auth_token',
                message: 'Invalid authentication token'
            }
        });
    }
}

module.exports = {
    authenticateUser
};