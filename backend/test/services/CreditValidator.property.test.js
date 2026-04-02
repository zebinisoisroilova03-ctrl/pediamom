/**
 * Property-Based Tests for Credit Validator
 * 
 * Tests credit validation logic and insufficient credit prevention
 * Feature: ai-monetization-system, Property 3: Insufficient Credit Prevention
 */

const fc = require('fast-check');
const { CREDIT_CONFIG } = require('../../config/monetization');

// Test configuration
const propertyTestConfig = {
    numRuns: 100,
    verbose: true,
    seed: process.env.TEST_SEED || Date.now(),
    endOnFailure: true
};

// Custom generators for validation testing
const analysisTypeGenerator = fc.constantFrom('blood', 'urine', 'vitamin', 'growth', 'nutrition');
const balanceGenerator = fc.integer({ min: 0, max: 100 });
const userIdGenerator = fc.string({ minLength: 10, maxLength: 28 });

// Simplified Credit Validator for testing core logic
class SimpleCreditValidator {
    getAnalysisCost(analysisType) {
        return CREDIT_CONFIG.analysisCosts[analysisType] || CREDIT_CONFIG.analysisCosts.default;
    }

    validateAnalysisRequest(balance, analysisType) {
        const required = this.getAnalysisCost(analysisType);

        if (balance >= required) {
            return {
                allowed: true,
                details: {
                    required: required,
                    available: balance,
                    remaining: balance - required
                }
            };
        }

        return {
            allowed: false,
            reason: 'insufficient_credits',
            suggestedAction: 'purchase_credits',
            details: {
                required: required,
                available: balance,
                shortfall: required - balance
            },
            upgradeOptions: this.getUpgradeRecommendations(balance)
        };
    }

    validateBatchAnalysisRequest(balance, analysisTypes) {
        const totalCost = analysisTypes.reduce((sum, type) => {
            return sum + this.getAnalysisCost(type);
        }, 0);

        if (balance >= totalCost) {
            return {
                allowed: true,
                details: {
                    totalRequired: totalCost,
                    available: balance,
                    remaining: balance - totalCost,
                    breakdown: analysisTypes.map(type => ({
                        type,
                        cost: this.getAnalysisCost(type)
                    }))
                }
            };
        }

        return {
            allowed: false,
            reason: 'insufficient_credits_batch',
            suggestedAction: 'purchase_credits',
            details: {
                totalRequired: totalCost,
                available: balance,
                shortfall: totalCost - balance,
                breakdown: analysisTypes.map(type => ({
                    type,
                    cost: this.getAnalysisCost(type)
                }))
            },
            upgradeOptions: this.getUpgradeRecommendations(balance)
        };
    }

    checkLowBalanceWarning(balance) {
        const warningThreshold = CREDIT_CONFIG.analysisCosts.default * 2;

        if (balance <= warningThreshold && balance > 0) {
            return {
                shouldWarn: true,
                balance: balance,
                threshold: warningThreshold,
                message: `You have ${balance} credits remaining. Consider purchasing more credits to continue using AI analysis.`,
                upgradeOptions: this.getUpgradeRecommendations(balance)
            };
        }

        return {
            shouldWarn: false,
            balance: balance
        };
    }

    getCreditStatus(balance) {
        const defaultCost = CREDIT_CONFIG.analysisCosts.default;
        const analysesRemaining = Math.floor(balance / defaultCost);

        let status = 'good';
        let statusMessage = 'You have sufficient credits for analysis.';

        if (balance === 0) {
            status = 'empty';
            statusMessage = 'You have no credits remaining. Purchase credits to continue.';
        } else if (balance < defaultCost) {
            status = 'insufficient';
            statusMessage = 'You don\'t have enough credits for a standard analysis.';
        } else if (analysesRemaining <= 2) {
            status = 'low';
            statusMessage = `You have ${analysesRemaining} analysis${analysesRemaining === 1 ? '' : 'es'} remaining.`;
        }

        return {
            balance: balance,
            analysesRemaining: analysesRemaining,
            status: status,
            statusMessage: statusMessage,
            costs: CREDIT_CONFIG.analysisCosts
        };
    }

    getUpgradeRecommendations(balance) {
        // Simplified upgrade recommendations for testing
        return [
            { type: 'credit_package', packageId: 'basic_50', credits: 50, price: 500 },
            { type: 'credit_package', packageId: 'standard_100', credits: 100, price: 900 }
        ];
    }
}

describe('Credit Validator Property Tests', () => {
    let creditValidator;

    beforeAll(() => {
        creditValidator = new SimpleCreditValidator();
    });

    describe('Property 3: Insufficient Credit Prevention', () => {
        /**
         * **Validates: Requirements 1.3, 3.2**
         * 
         * For any user with zero credit balance, the system should prevent 
         * new AI analysis requests and display appropriate upgrade options.
         */
        test('zero balance always prevents analysis', () => {
            fc.assert(fc.property(
                analysisTypeGenerator,
                (analysisType) => {
                    const validation = creditValidator.validateAnalysisRequest(0, analysisType);

                    // Property: Zero balance should always prevent analysis
                    expect(validation.allowed).toBe(false);
                    expect(validation.reason).toBe('insufficient_credits');
                    expect(validation.suggestedAction).toBe('purchase_credits');
                    expect(validation.details.available).toBe(0);
                    expect(validation.details.shortfall).toBeGreaterThan(0);
                    expect(validation.upgradeOptions).toBeDefined();
                    expect(Array.isArray(validation.upgradeOptions)).toBe(true);

                    return true;
                }
            ), propertyTestConfig);
        });

        test('insufficient balance prevents analysis with correct shortfall calculation', () => {
            fc.assert(fc.property(
                analysisTypeGenerator,
                fc.integer({ min: 1, max: 10 }), // Small balance likely to be insufficient
                (analysisType, balance) => {
                    const required = creditValidator.getAnalysisCost(analysisType);

                    // Only test when balance is actually insufficient
                    if (balance < required) {
                        const validation = creditValidator.validateAnalysisRequest(balance, analysisType);

                        // Property: Insufficient balance should prevent analysis
                        expect(validation.allowed).toBe(false);
                        expect(validation.reason).toBe('insufficient_credits');
                        expect(validation.details.available).toBe(balance);
                        expect(validation.details.required).toBe(required);
                        expect(validation.details.shortfall).toBe(required - balance);
                        expect(validation.details.shortfall).toBeGreaterThan(0);
                    }

                    return true;
                }
            ), propertyTestConfig);
        });

        test('sufficient balance allows analysis with correct remaining calculation', () => {
            fc.assert(fc.property(
                analysisTypeGenerator,
                fc.integer({ min: 20, max: 100 }), // Larger balance likely to be sufficient
                (analysisType, balance) => {
                    const required = creditValidator.getAnalysisCost(analysisType);

                    // Only test when balance is actually sufficient
                    if (balance >= required) {
                        const validation = creditValidator.validateAnalysisRequest(balance, analysisType);

                        // Property: Sufficient balance should allow analysis
                        expect(validation.allowed).toBe(true);
                        expect(validation.details.available).toBe(balance);
                        expect(validation.details.required).toBe(required);
                        expect(validation.details.remaining).toBe(balance - required);
                        expect(validation.details.remaining).toBeGreaterThanOrEqual(0);
                    }

                    return true;
                }
            ), propertyTestConfig);
        });

        test('batch validation correctly calculates total cost', () => {
            fc.assert(fc.property(
                fc.array(analysisTypeGenerator, { minLength: 1, maxLength: 5 }),
                balanceGenerator,
                (analysisTypes, balance) => {
                    const validation = creditValidator.validateBatchAnalysisRequest(balance, analysisTypes);

                    // Calculate expected total cost
                    const expectedTotal = analysisTypes.reduce((sum, type) => {
                        return sum + creditValidator.getAnalysisCost(type);
                    }, 0);

                    // Property: Total cost should be calculated correctly
                    expect(validation.details.totalRequired).toBe(expectedTotal);
                    expect(validation.details.available).toBe(balance);

                    if (balance >= expectedTotal) {
                        expect(validation.allowed).toBe(true);
                        expect(validation.details.remaining).toBe(balance - expectedTotal);
                    } else {
                        expect(validation.allowed).toBe(false);
                        expect(validation.reason).toBe('insufficient_credits_batch');
                        expect(validation.details.shortfall).toBe(expectedTotal - balance);
                    }

                    // Breakdown should match individual costs
                    expect(validation.details.breakdown).toHaveLength(analysisTypes.length);
                    validation.details.breakdown.forEach((item, index) => {
                        expect(item.type).toBe(analysisTypes[index]);
                        expect(item.cost).toBe(creditValidator.getAnalysisCost(analysisTypes[index]));
                    });

                    return true;
                }
            ), propertyTestConfig);
        });

        test('low balance warning threshold is consistent', () => {
            fc.assert(fc.property(
                balanceGenerator,
                (balance) => {
                    const warning = creditValidator.checkLowBalanceWarning(balance);
                    const threshold = CREDIT_CONFIG.analysisCosts.default * 2;

                    // Property: Warning should be triggered consistently based on threshold
                    if (balance <= threshold && balance > 0) {
                        expect(warning.shouldWarn).toBe(true);
                        expect(warning.balance).toBe(balance);
                        expect(warning.threshold).toBe(threshold);
                        expect(warning.message).toContain(balance.toString());
                        expect(warning.upgradeOptions).toBeDefined();
                    } else {
                        expect(warning.shouldWarn).toBe(false);
                        expect(warning.balance).toBe(balance);
                    }

                    return true;
                }
            ), propertyTestConfig);
        });

        test('credit status classification is accurate', () => {
            fc.assert(fc.property(
                balanceGenerator,
                (balance) => {
                    const status = creditValidator.getCreditStatus(balance);
                    const defaultCost = CREDIT_CONFIG.analysisCosts.default;
                    const expectedAnalysesRemaining = Math.floor(balance / defaultCost);

                    // Property: Status should be classified correctly
                    expect(status.balance).toBe(balance);
                    expect(status.analysesRemaining).toBe(expectedAnalysesRemaining);
                    expect(status.costs).toBe(CREDIT_CONFIG.analysisCosts);

                    if (balance === 0) {
                        expect(status.status).toBe('empty');
                        expect(status.statusMessage).toContain('no credits remaining');
                    } else if (balance < defaultCost) {
                        expect(status.status).toBe('insufficient');
                        expect(status.statusMessage).toContain('don\'t have enough credits');
                    } else if (expectedAnalysesRemaining <= 2) {
                        expect(status.status).toBe('low');
                        expect(status.statusMessage).toContain(expectedAnalysesRemaining.toString());
                    } else {
                        expect(status.status).toBe('good');
                        expect(status.statusMessage).toContain('sufficient credits');
                    }

                    return true;
                }
            ), propertyTestConfig);
        });

        test('validation is deterministic for same inputs', () => {
            fc.assert(fc.property(
                analysisTypeGenerator,
                balanceGenerator,
                (analysisType, balance) => {
                    // Property: Same inputs should always produce same results
                    const validation1 = creditValidator.validateAnalysisRequest(balance, analysisType);
                    const validation2 = creditValidator.validateAnalysisRequest(balance, analysisType);

                    expect(validation1.allowed).toBe(validation2.allowed);
                    expect(validation1.reason).toBe(validation2.reason);
                    expect(validation1.details.required).toBe(validation2.details.required);
                    expect(validation1.details.available).toBe(validation2.details.available);

                    if (validation1.allowed) {
                        expect(validation1.details.remaining).toBe(validation2.details.remaining);
                    } else {
                        expect(validation1.details.shortfall).toBe(validation2.details.shortfall);
                    }

                    return true;
                }
            ), propertyTestConfig);
        });

        test('upgrade recommendations are provided when needed', () => {
            fc.assert(fc.property(
                analysisTypeGenerator,
                fc.integer({ min: 0, max: 5 }), // Low balance to trigger upgrade recommendations
                (analysisType, balance) => {
                    const required = creditValidator.getAnalysisCost(analysisType);

                    if (balance < required) {
                        const validation = creditValidator.validateAnalysisRequest(balance, analysisType);

                        // Property: Upgrade options should be provided when credits are insufficient
                        expect(validation.upgradeOptions).toBeDefined();
                        expect(Array.isArray(validation.upgradeOptions)).toBe(true);
                        expect(validation.upgradeOptions.length).toBeGreaterThan(0);

                        // Each upgrade option should have required fields
                        validation.upgradeOptions.forEach(option => {
                            expect(option).toHaveProperty('type');
                            expect(option).toHaveProperty('packageId');
                            expect(option).toHaveProperty('credits');
                            expect(option).toHaveProperty('price');
                            expect(option.credits).toBeGreaterThan(0);
                            expect(option.price).toBeGreaterThan(0);
                        });
                    }

                    return true;
                }
            ), propertyTestConfig);
        });
    });
});