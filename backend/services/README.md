# AI Monetization System Services

This directory contains the core business logic services for the AI Monetization System.

## Service Architecture

Each service is responsible for a specific domain of functionality:

- **CreditSystem.js** - Manages credit purchases, balance tracking, and deductions
- **SubscriptionManager.js** - Handles subscription tiers, billing, and renewals
- **PaymentGateway.js** - Abstracts Stripe payment processing operations
- **UsageTracker.js** - Monitors AI analysis consumption and generates analytics
- **FreemiumController.js** - Manages free tier limitations and upgrade prompts
- **AIAnalysisEngine.js** - Integrates monetization with existing analysis workflow

## Design Principles

- **Single Responsibility**: Each service handles one specific domain
- **Dependency Injection**: Services can be easily tested and mocked
- **Error Handling**: Consistent error patterns across all services
- **Async/Await**: Modern JavaScript patterns for better readability
- **Firestore Integration**: Atomic transactions for data consistency

## Usage

Services are imported and used by the API routes and other components:

```javascript
const CreditSystem = require('./services/CreditSystem');
const creditSystem = new CreditSystem();

// Use service methods
const balance = await creditSystem.getCreditBalance(userId);
```

## Testing

Each service includes comprehensive unit tests and property-based tests to ensure correctness and reliability.