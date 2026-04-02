/**
 * Validation middleware for API requests
 */

// Allowed analysis types whitelist
const ALLOWED_ANALYSIS_TYPES = new Set(['blood', 'urine', 'vitamin']);

/**
 * Validate analysis request data
 */
function validateAnalysisRequest(req, res, next) {
    const { childId, type, values } = req.body;

    if (!childId || typeof childId !== 'string' || childId.length > 128) {
        return res.status(400).json({
            success: false,
            error: { code: 'missing_child_id', message: 'Valid Child ID is required' }
        });
    }

    if (!type || !ALLOWED_ANALYSIS_TYPES.has(type)) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'invalid_analysis_type',
                message: `Analysis type must be one of: ${[...ALLOWED_ANALYSIS_TYPES].join(', ')}`
            }
        });
    }

    if (!values || typeof values !== 'object' || Array.isArray(values)) {
        return res.status(400).json({
            success: false,
            error: { code: 'missing_analysis_values', message: 'Analysis values must be an object' }
        });
    }

    // Reject extra keys to prevent mass assignment
    const validationResult = validateAnalysisValues(type, values);
    if (!validationResult.valid) {
        return res.status(400).json({
            success: false,
            error: { code: 'invalid_analysis_values', message: validationResult.message }
        });
    }

    next();
}

/**
 * Validate analysis values based on type
 */
function validateAnalysisValues(type, values) {
    switch (type) {
        case 'blood':
            return validateBloodValues(values);
        case 'urine':
            return validateUrineValues(values);
        case 'vitamin':
            return validateVitaminValues(values);
        default:
            return {
                valid: false,
                message: `Unsupported analysis type: ${type}`
            };
    }
}

function validateBloodValues(values) {
    const { hemoglobin, iron } = values;

    if (typeof hemoglobin !== 'number' || hemoglobin < 0 || hemoglobin > 25) {
        return {
            valid: false,
            message: 'Hemoglobin must be a number between 0 and 25'
        };
    }

    if (typeof iron !== 'number' || iron < 0 || iron > 300) {
        return {
            valid: false,
            message: 'Iron must be a number between 0 and 300'
        };
    }

    return { valid: true };
}

function validateUrineValues(values) {
    const { protein, ph } = values;

    if (typeof protein !== 'number' || protein < 0 || protein > 500) {
        return {
            valid: false,
            message: 'Protein must be a number between 0 and 500'
        };
    }

    if (typeof ph !== 'number' || ph < 0 || ph > 14) {
        return {
            valid: false,
            message: 'pH must be a number between 0 and 14'
        };
    }

    return { valid: true };
}

function validateVitaminValues(values) {
    const { vitaminD, vitaminB12 } = values;

    if (typeof vitaminD !== 'number' || vitaminD < 0 || vitaminD > 200) {
        return {
            valid: false,
            message: 'Vitamin D must be a number between 0 and 200'
        };
    }

    if (typeof vitaminB12 !== 'number' || vitaminB12 < 0 || vitaminB12 > 2000) {
        return {
            valid: false,
            message: 'Vitamin B12 must be a number between 0 and 2000'
        };
    }

    return { valid: true };
}

module.exports = {
    validateAnalysisRequest,
    validateAnalysisValues
};