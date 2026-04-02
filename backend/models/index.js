/**
 * AI Monetization System - Data Models
 * 
 * Central export for all data models and services
 */

const {
    UserPaymentProfile,
    UserPaymentProfileService,
    UserPaymentProfileSchema
} = require('./UserPaymentProfile');

const {
    TransactionRecord,
    TransactionRecordService,
    TransactionRecordSchema,
    TRANSACTION_TYPES,
    TRANSACTION_STATUS
} = require('./TransactionRecord');

const {
    UsageRecord,
    UsageRecordService,
    UsageRecordSchema,
    PAYMENT_METHODS,
    ANALYSIS_TYPES
} = require('./UsageRecord');

const {
    FreeUsageRecord,
    FreeUsageTrackingService,
    FreeUsageRecordSchema
} = require('./FreeUsageTracking');

module.exports = {
    // User Payment Profile
    UserPaymentProfile,
    UserPaymentProfileService,
    UserPaymentProfileSchema,

    // Transaction Records
    TransactionRecord,
    TransactionRecordService,
    TransactionRecordSchema,
    TRANSACTION_TYPES,
    TRANSACTION_STATUS,

    // Usage Records
    UsageRecord,
    UsageRecordService,
    UsageRecordSchema,
    PAYMENT_METHODS,
    ANALYSIS_TYPES,

    // Free Usage Tracking
    FreeUsageRecord,
    FreeUsageTrackingService,
    FreeUsageRecordSchema
};