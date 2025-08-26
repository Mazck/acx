// src/integrations/AdminDashboard.ts
import express from 'express';
import { EnhancedSQLiteDatabase, SubscriptionData, TransactionData } from '../database/providers/EnhancedSQLiteDatabase';
import { PromoCodeManager } from './PromoCodeManager';
import { Logger } from '../utils/Logger';

export class AdminDashboard {
    private app: express.Application;
    private database: EnhancedSQLiteDatabase;
    private promoManager: PromoCodeManager;
    private adminToken: string;

    constructor(
        database: EnhancedSQLiteDatabase,
        promoManager: PromoCodeManager,
        adminToken: string = 'admin-secret-token'
    ) {
        this.app = express();
        this.database = database;
        this.promoManager = promoManager;
        this.adminToken = adminToken;

        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // CORS
        this.app.use((_req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            next();
        });

        // Handle OPTIONS requests
        this.app.options('*', (_req, res) => {
            res.sendStatus(200);
        });

        // Auth middleware
        this.app.use('/api/admin', this.authenticateAdmin.bind(this));

        // Request logging
        this.app.use((req, _res, next) => {
            Logger.debug('DASHBOARD', `${req.method} ${req.path}`, {
                query: req.query,
                body: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined
            });
            next();
        });
    }

    private authenticateAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Missing or invalid authorization header' });
            return;
        }

        const token = authHeader.substring(7);
        if (token !== this.adminToken) {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }

        next();
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', async (_req, res) => {
            try {
                const health = await this.database.healthCheck();
                res.json({
                    status: 'ok',
                    timestamp: new Date().toISOString(),
                    ...health
                });
            } catch (error) {
                res.status(500).json({ error: 'Health check failed' });
            }
        });

        // Dashboard overview
        this.app.get('/api/admin/dashboard', this.getDashboardOverview.bind(this));

        // Subscription management
        this.app.get('/api/admin/subscriptions', this.getSubscriptions.bind(this));
        this.app.get('/api/admin/subscriptions/stats', this.getSubscriptionStats.bind(this));
        this.app.get('/api/admin/subscriptions/:threadId', this.getSubscriptionDetails.bind(this));
        this.app.post('/api/admin/subscriptions/:threadId/activate', this.activateSubscription.bind(this));
        this.app.post('/api/admin/subscriptions/:threadId/deactivate', this.deactivateSubscription.bind(this));
        this.app.post('/api/admin/subscriptions/:threadId/extend', this.extendSubscription.bind(this));

        // Transaction management
        this.app.get('/api/admin/transactions', this.getTransactions.bind(this));
        this.app.get('/api/admin/transactions/stats', this.getTransactionStats.bind(this));
        this.app.get('/api/admin/transactions/:orderCode', this.getTransactionDetails.bind(this));
        this.app.put('/api/admin/transactions/:orderCode/status', this.updateTransactionStatus.bind(this));

        // Promo code management
        this.app.get('/api/admin/promocodes', this.getPromoCodes.bind(this));
        this.app.post('/api/admin/promocodes', this.createPromoCode.bind(this));
        this.app.put('/api/admin/promocodes/:code/deactivate', this.deactivatePromoCode.bind(this));
        this.app.get('/api/admin/promocodes/:code/usage', this.getPromoCodeUsage.bind(this));
        this.app.get('/api/admin/promocodes/stats', this.getPromoCodeStats.bind(this));

        // Analytics
        this.app.get('/api/admin/analytics/revenue', this.getRevenueAnalytics.bind(this));
        this.app.get('/api/admin/analytics/customers', this.getCustomerAnalytics.bind(this));
        this.app.get('/api/admin/analytics/plans', this.getPlanAnalytics.bind(this));

        // System management
        this.app.post('/api/admin/system/cleanup', this.performCleanup.bind(this));
        this.app.get('/api/admin/system/export', this.exportData.bind(this));
        this.app.post('/api/admin/system/backup', this.createBackup.bind(this));

        // Error handler
        this.app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            Logger.error('DASHBOARD', 'API error', error);
            res.status(500).json({ error: 'Internal server error' });
        });
    }

    // Dashboard overview
    private async getDashboardOverview(_req: express.Request, res: express.Response): Promise<void> {
        try {
            const [
                subscriptionStats,
                transactionStats,
                promoStats,
                revenueAnalytics
            ] = await Promise.all([
                this.database.getSubscriptionStats(),
                this.database.getTransactionStats(30),
                this.database.getPromoUsageStats(),
                this.database.getRevenueAnalytics(30)
            ]);

            const overview = {
                subscriptions: {
                    total: subscriptionStats.total,
                    active: subscriptionStats.active,
                    expired: subscriptionStats.expired,
                    trials: subscriptionStats.trials,
                    activeRate: subscriptionStats.total > 0 ?
                        (subscriptionStats.active / subscriptionStats.total * 100).toFixed(1) + '%' : '0%'
                },
                revenue: {
                    total: revenueAnalytics.totalRevenue,
                    recurring: revenueAnalytics.recurringRevenue,
                    newCustomer: revenueAnalytics.newCustomerRevenue,
                    monthlyGrowth: revenueAnalytics.monthlyGrowth.toFixed(1) + '%',
                    lifetimeValue: Math.round(revenueAnalytics.lifetimeValue)
                },
                transactions: {
                    total: transactionStats.total,
                    successful: transactionStats.successful,
                    failed: transactionStats.failed,
                    successRate: transactionStats.total > 0 ?
                        (transactionStats.successful / transactionStats.total * 100).toFixed(1) + '%' : '0%',
                    averageOrderValue: Math.round(transactionStats.averageOrderValue)
                },
                promoCodes: {
                    totalUses: promoStats.totalUses,
                    totalSavings: promoStats.totalSavings,
                    uniqueThreads: promoStats.uniqueThreads,
                    averageDiscount: Math.round(promoStats.averageDiscount)
                },
                plans: subscriptionStats.planDistribution,
                recentActivity: transactionStats.dailyStats.slice(-7),
                metrics: {
                    renewalRate: revenueAnalytics.renewalRate.toFixed(1) + '%',
                    churnRate: revenueAnalytics.churnRate.toFixed(1) + '%'
                }
            };

            res.json(overview);
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting dashboard overview', error);
            res.status(500).json({ error: 'Failed to load dashboard overview' });
        }
    }

    // Subscription management endpoints
    private async getSubscriptions(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { status = 'all', page = 1, limit = 20, search } = req.query;

            let subscriptions: SubscriptionData[];

            switch (status) {
                case 'active':
                    subscriptions = await this.database.getActiveSubscriptions();
                    break;
                case 'expired':
                    subscriptions = await this.database.getExpiredSubscriptions();
                    break;
                default:
                    // Get all subscriptions - combine active and expired
                    const [active, expired] = await Promise.all([
                        this.database.getActiveSubscriptions(),
                        this.database.getExpiredSubscriptions()
                    ]);
                    subscriptions = [...active, ...expired];
            }

            // Apply search filter if provided
            if (search && typeof search === 'string') {
                subscriptions = subscriptions.filter(sub =>
                    sub.threadID.includes(search) ||
                    sub.planId.toLowerCase().includes(search.toLowerCase()) ||
                    sub.createdBy.toLowerCase().includes(search.toLowerCase())
                );
            }

            // Pagination
            const pageNum = parseInt(page as string) || 1;
            const limitNum = parseInt(limit as string) || 20;
            const offset = (pageNum - 1) * limitNum;

            const paginatedSubs = subscriptions.slice(offset, offset + limitNum);

            res.json({
                subscriptions: paginatedSubs,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: subscriptions.length,
                    totalPages: Math.ceil(subscriptions.length / limitNum)
                }
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting subscriptions', error);
            res.status(500).json({ error: 'Failed to load subscriptions' });
        }
    }

    private async getSubscriptionDetails(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { threadId } = req.params;

            const [subscription, transactions] = await Promise.all([
                this.database.getSubscriptionByThread(threadId),
                this.database.getTransactionsByThread(threadId, 10)
            ]);

            if (!subscription) {
                res.status(404).json({ error: 'Subscription not found' });
                return;
            }

            res.json({
                subscription,
                recentTransactions: transactions,
                summary: {
                    totalPaid: subscription.totalPaid,
                    daysRemaining: Math.ceil((subscription.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
                    renewalCount: subscription.renewalCount,
                    isActive: subscription.isActive && subscription.endDate > new Date()
                }
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting subscription details', error);
            res.status(500).json({ error: 'Failed to load subscription details' });
        }
    }

    private async activateSubscription(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { threadId } = req.params;
            const { planId, days, reason } = req.body;

            if (!planId || !days) {
                res.status(400).json({ error: 'planId and days are required' });
                return;
            }

            // Create new subscription or extend existing
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + parseInt(days));

            const subscriptionData = {
                threadID: threadId,
                planId,
                startDate: new Date(),
                endDate,
                isActive: true,
                totalPaid: 0,
                renewalCount: 0,
                lastPaymentDate: new Date(),
                features: [],
                isTrial: false,
                createdBy: 'admin',
                history: [{
                    action: 'activated' as const,
                    planId,
                    amount: 0,
                    days: parseInt(days),
                    timestamp: new Date()
                }]
            };

            const subscription = await this.database.createSubscription(subscriptionData);

            Logger.info('DASHBOARD', `Admin activated subscription for thread ${threadId}`, {
                planId,
                days,
                reason
            });

            res.json({
                success: true,
                subscription,
                message: `Subscription activated successfully for ${days} days`
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error activating subscription', error);
            res.status(500).json({ error: 'Failed to activate subscription' });
        }
    }

    private async deactivateSubscription(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { threadId } = req.params;
            const { reason } = req.body;

            const success = await this.database.updateSubscription(threadId, {
                isActive: false
            });

            if (success) {
                Logger.info('DASHBOARD', `Admin deactivated subscription for thread ${threadId}`, {
                    reason
                });

                res.json({
                    success: true,
                    message: `Subscription deactivated for thread ${threadId}`
                });
            } else {
                res.status(404).json({ error: 'Subscription not found' });
            }
        } catch (error) {
            Logger.error('DASHBOARD', 'Error deactivating subscription', error);
            res.status(500).json({ error: 'Failed to deactivate subscription' });
        }
    }

    private async extendSubscription(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { threadId } = req.params;
            const { days, reason } = req.body;

            if (!days) {
                res.status(400).json({ error: 'days is required' });
                return;
            }

            const subscription = await this.database.getSubscriptionByThread(threadId);
            if (!subscription) {
                res.status(404).json({ error: 'Subscription not found' });
                return;
            }

            // Extend end date
            const newEndDate = new Date(subscription.endDate);
            newEndDate.setDate(newEndDate.getDate() + parseInt(days));

            // Update subscription
            const success = await this.database.updateSubscription(threadId, {
                endDate: newEndDate,
                isActive: true,
                history: [
                    ...subscription.history,
                    {
                        action: 'extended' as const,
                        planId: subscription.planId,
                        amount: 0,
                        days: parseInt(days),
                        timestamp: new Date()
                    }
                ]
            });

            if (success) {
                Logger.info('DASHBOARD', `Admin extended subscription for thread ${threadId}`, {
                    days,
                    newEndDate: newEndDate.toISOString(),
                    reason
                });

                res.json({
                    success: true,
                    message: `Subscription extended by ${days} days`,
                    newEndDate: newEndDate.toISOString()
                });
            } else {
                res.status(500).json({ error: 'Failed to extend subscription' });
            }
        } catch (error) {
            Logger.error('DASHBOARD', 'Error extending subscription', error);
            res.status(500).json({ error: 'Failed to extend subscription' });
        }
    }

    private async getSubscriptionStats(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { days = 30 } = req.query;
            const stats = await this.database.getSubscriptionStats();
            const analytics = await this.database.getRevenueAnalytics(parseInt(days as string) || 30);

            res.json({
                ...stats,
                analytics: {
                    renewalRate: analytics.renewalRate,
                    churnRate: analytics.churnRate,
                    lifetimeValue: analytics.lifetimeValue,
                    monthlyGrowth: analytics.monthlyGrowth
                }
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting subscription stats', error);
            res.status(500).json({ error: 'Failed to load subscription stats' });
        }
    }

    // Transaction management endpoints
    private async getTransactions(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { days = 30 } = req.query;
            const stats = await this.database.getTransactionStats(parseInt(days as string));

            res.json({
                transactions: stats.dailyStats,
                summary: {
                    total: stats.total,
                    successful: stats.successful,
                    failed: stats.failed,
                    totalRevenue: stats.totalRevenue,
                    averageOrderValue: stats.averageOrderValue,
                    successRate: stats.total > 0 ? (stats.successful / stats.total * 100).toFixed(1) + '%' : '0%'
                }
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting transactions', error);
            res.status(500).json({ error: 'Failed to load transactions' });
        }
    }

    private async getTransactionDetails(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { orderCode } = req.params;
            const orderCodeNum = parseInt(orderCode);

            if (isNaN(orderCodeNum)) {
                res.status(400).json({ error: 'Invalid order code' });
                return;
            }

            const transaction = await this.database.getTransactionByOrderCode(orderCodeNum);

            if (!transaction) {
                res.status(404).json({ error: 'Transaction not found' });
                return;
            }

            res.json({ transaction });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting transaction details', error);
            res.status(500).json({ error: 'Failed to load transaction details' });
        }
    }

    private async updateTransactionStatus(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { orderCode } = req.params;
            const { status } = req.body;
            const orderCodeNum = parseInt(orderCode);

            if (isNaN(orderCodeNum)) {
                res.status(400).json({ error: 'Invalid order code' });
                return;
            }

            if (!['pending', 'success', 'failed', 'cancelled'].includes(status)) {
                res.status(400).json({ error: 'Invalid status' });
                return;
            }

            const completedAt = status === 'success' ? new Date() : undefined;
            const success = await this.database.updateTransactionStatus(orderCodeNum, status, completedAt);

            if (success) {
                res.json({
                    success: true,
                    message: `Transaction status updated to ${status}`
                });
            } else {
                res.status(404).json({ error: 'Transaction not found' });
            }
        } catch (error) {
            Logger.error('DASHBOARD', 'Error updating transaction status', error);
            res.status(500).json({ error: 'Failed to update transaction status' });
        }
    }

    private async getTransactionStats(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { days = 30 } = req.query;
            const stats = await this.database.getTransactionStats(parseInt(days as string));

            res.json(stats);
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting transaction stats', error);
            res.status(500).json({ error: 'Failed to load transaction stats' });
        }
    }

    // Promo code management endpoints
    private async getPromoCodes(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { status = 'active' } = req.query;

            const allCodes = await this.promoManager.getAllPromoCodes();
            const now = new Date();

            let filteredCodes = allCodes;

            switch (status) {
                case 'active':
                    filteredCodes = allCodes.filter(code =>
                        code.isActive && code.expiryDate > now && code.currentUses < code.maxUses
                    );
                    break;
                case 'expired':
                    filteredCodes = allCodes.filter(code =>
                        !code.isActive || code.expiryDate <= now
                    );
                    break;
                case 'exhausted':
                    filteredCodes = allCodes.filter(code =>
                        code.currentUses >= code.maxUses
                    );
                    break;
            }

            res.json({
                promoCodes: filteredCodes.map(code => ({
                    ...code,
                    usagePercent: Math.round((code.currentUses / code.maxUses) * 100),
                    isExpired: code.expiryDate <= now,
                    daysUntilExpiry: Math.ceil((code.expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
                })),
                summary: {
                    total: allCodes.length,
                    active: allCodes.filter(c => c.isActive && c.expiryDate > now).length,
                    expired: allCodes.filter(c => !c.isActive || c.expiryDate <= now).length,
                    exhausted: allCodes.filter(c => c.currentUses >= c.maxUses).length
                }
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting promo codes', error);
            res.status(500).json({ error: 'Failed to load promo codes' });
        }
    }

    private async createPromoCode(req: express.Request, res: express.Response): Promise<void> {
        try {
            const {
                code,
                type,
                value,
                maxUses,
                expiryDays,
                planId,
                description
            } = req.body;

            if (!type || value === undefined || !maxUses || !expiryDays) {
                res.status(400).json({
                    error: 'type, value, maxUses, and expiryDays are required'
                });
                return;
            }

            const promoCode = code || PromoCodeManager.generateRandomCode();

            const createdPromo = await this.promoManager.createPromoCode(
                promoCode,
                type,
                value,
                maxUses,
                expiryDays,
                'admin',
                planId,
                description
            );

            Logger.info('DASHBOARD', `Admin created promo code ${promoCode}`, {
                type,
                value,
                maxUses,
                planId
            });

            res.json({
                success: true,
                promoCode: createdPromo,
                message: `Promo code ${promoCode} created successfully`
            });
        } catch (error: any) {
            Logger.error('DASHBOARD', 'Error creating promo code', error);
            res.status(500).json({ error: error.message || 'Failed to create promo code' });
        }
    }

    private async deactivatePromoCode(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { code } = req.params;
            const { reason } = req.body;

            const success = await this.promoManager.deactivatePromoCode(code);

            if (success) {
                Logger.info('DASHBOARD', `Admin deactivated promo code ${code}`, { reason });

                res.json({
                    success: true,
                    message: `Promo code ${code} deactivated successfully`
                });
            } else {
                res.status(404).json({ error: 'Promo code not found' });
            }
        } catch (error) {
            Logger.error('DASHBOARD', 'Error deactivating promo code', error);
            res.status(500).json({ error: 'Failed to deactivate promo code' });
        }
    }

    private async getPromoCodeUsage(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { code } = req.params;
            const usage = await this.promoManager.getPromoCodeUsageHistory(code);

            res.json({
                promoCode: code,
                usage,
                summary: {
                    totalUses: usage.length,
                    totalSavings: usage.reduce((sum, u) => sum + u.discountAmount, 0),
                    uniqueThreads: new Set(usage.map(u => u.threadID)).size
                }
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting promo code usage', error);
            res.status(500).json({ error: 'Failed to load promo code usage' });
        }
    }

    private async getPromoCodeStats(req: express.Request, res: express.Response): Promise<void> {
        try {
            const stats = await this.promoManager.getPromoCodeStats();
            const detailedStats = await this.database.getPromoUsageStats();

            res.json({
                ...stats,
                detailed: detailedStats
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting promo code stats', error);
            res.status(500).json({ error: 'Failed to load promo code stats' });
        }
    }

    // Analytics endpoints
    private async getRevenueAnalytics(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { days = 30 } = req.query;
            const analytics = await this.database.getRevenueAnalytics(parseInt(days as string));

            res.json(analytics);
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting revenue analytics', error);
            res.status(500).json({ error: 'Failed to load revenue analytics' });
        }
    }

    private async getCustomerAnalytics(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { days = 30 } = req.query;

            // Get subscription and transaction data to analyze customer behavior
            const [subscriptionStats, transactionStats] = await Promise.all([
                this.database.getSubscriptionStats(),
                this.database.getTransactionStats(parseInt(days as string))
            ]);

            const customerAnalytics = {
                acquisition: {
                    newSubscriptions: subscriptionStats.total - subscriptionStats.expired,
                    trialConversions: subscriptionStats.total - subscriptionStats.trials,
                    conversionRate: subscriptionStats.trials > 0 ?
                        ((subscriptionStats.total - subscriptionStats.trials) / subscriptionStats.trials * 100).toFixed(1) + '%' : '0%'
                },
                retention: {
                    activeCustomers: subscriptionStats.active,
                    churnedCustomers: subscriptionStats.expired,
                    retentionRate: subscriptionStats.total > 0 ?
                        (subscriptionStats.active / subscriptionStats.total * 100).toFixed(1) + '%' : '0%'
                },
                revenue: {
                    averageOrderValue: transactionStats.averageOrderValue,
                    totalRevenue: transactionStats.totalRevenue,
                    revenuePerCustomer: subscriptionStats.active > 0 ?
                        Math.round(transactionStats.totalRevenue / subscriptionStats.active) : 0
                },
                plans: subscriptionStats.planDistribution
            };

            res.json(customerAnalytics);
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting customer analytics', error);
            res.status(500).json({ error: 'Failed to load customer analytics' });
        }
    }

    private async getPlanAnalytics(req: express.Request, res: express.Response): Promise<void> {
        try {
            const stats = await this.database.getSubscriptionStats();
            const transactionStats = await this.database.getTransactionStats(30);

            // Calculate plan-specific metrics
            const planAnalytics = Object.entries(stats.planDistribution).map(([planId, count]) => ({
                planId,
                subscriptions: count,
                marketShare: stats.total > 0 ? ((count as number) / stats.total * 100).toFixed(1) + '%' : '0%',
                // Additional metrics would require more complex queries
                averageLifetime: 0,
                renewalRate: 0
            }));

            res.json({
                planBreakdown: planAnalytics,
                totalPlans: Object.keys(stats.planDistribution).length,
                mostPopular: Object.entries(stats.planDistribution)
                    .reduce((max, [planId, count]) =>
                        (count as number) > (max.count as number) ? { planId, count } : max,
                        { planId: '', count: 0 }
                    ),
                revenue: {
                    totalRevenue: transactionStats.totalRevenue,
                    averageOrderValue: transactionStats.averageOrderValue
                }
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error getting plan analytics', error);
            res.status(500).json({ error: 'Failed to load plan analytics' });
        }
    }

    // System management endpoints
    private async performCleanup(req: express.Request, res: express.Response): Promise<void> {
        try {
            const {
                cleanTransactions = true,
                cleanPromoUsage = true,
                transactionDays = 90,
                promoUsageDays = 365
            } = req.body;

            const results: any = {};

            if (cleanTransactions) {
                results.cleanedTransactions = await this.database.cleanupExpiredTransactions(transactionDays);
            }

            if (cleanPromoUsage) {
                results.cleanedPromoUsage = await this.database.cleanupOldPromoUsage(promoUsageDays);
            }

            // Clean expired promo codes
            results.cleanedPromoCodes = await this.promoManager.cleanExpiredCodes();

            Logger.info('DASHBOARD', 'Admin performed cleanup', results);

            res.json({
                success: true,
                results,
                message: 'Cleanup completed successfully'
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error performing cleanup', error);
            res.status(500).json({ error: 'Failed to perform cleanup' });
        }
    }

    private async exportData(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { format = 'json' } = req.query;

            const data = await this.database.exportSubscriptionData();
            const promoCodes = await this.promoManager.getAllPromoCodes();

            const exportData = {
                timestamp: new Date().toISOString(),
                ...data,
                promoCodes
            };

            if (format === 'json') {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="uranus-bot-export-${Date.now()}.json"`);
                res.json(exportData);
            } else {
                res.status(400).json({ error: 'Unsupported format. Use: json' });
            }
        } catch (error) {
            Logger.error('DASHBOARD', 'Error exporting data', error);
            res.status(500).json({ error: 'Failed to export data' });
        }
    }

    private async createBackup(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { includeTransactions = true, includePromoCodes = true } = req.body;

            const backup: any = {
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                metadata: {
                    generatedBy: 'admin-dashboard',
                    includes: {
                        subscriptions: true,
                        transactions: includeTransactions,
                        promoCodes: includePromoCodes
                    }
                }
            };

            // Always include subscriptions
            const subscriptionData = await this.database.exportSubscriptionData();
            backup.subscriptions = subscriptionData.subscriptions;

            if (includeTransactions) {
                backup.transactions = subscriptionData.transactions;
            }

            if (includePromoCodes) {
                backup.promoCodes = await this.promoManager.getAllPromoCodes();
                backup.promoUsage = subscriptionData.promoUsage;
            }

            const filename = `uranus-bot-backup-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`;

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.json(backup);

            Logger.info('DASHBOARD', 'Generated backup file', {
                filename,
                subscriptions: backup.subscriptions?.length || 0,
                transactions: backup.transactions?.length || 0,
                promoCodes: backup.promoCodes?.length || 0
            });
        } catch (error) {
            Logger.error('DASHBOARD', 'Error creating backup', error);
            res.status(500).json({ error: 'Failed to create backup' });
        }
    }

    public getApp(): express.Application {
        return this.app;
    }

    public start(port: number = 3001): Promise<void> {
        return new Promise((resolve) => {
            this.app.listen(port, () => {
                Logger.success('DASHBOARD', `Admin dashboard started on port ${port}`);
                Logger.info('DASHBOARD', 'Dashboard endpoints:');
                Logger.info('DASHBOARD', `  GET  /health - Health check`);
                Logger.info('DASHBOARD', `  GET  /api/admin/dashboard - Overview`);
                Logger.info('DASHBOARD', `  GET  /api/admin/subscriptions - List subscriptions`);
                Logger.info('DASHBOARD', `  POST /api/admin/subscriptions/:threadId/activate - Activate`);
                Logger.info('DASHBOARD', `  GET  /api/admin/promocodes - List promo codes`);
                Logger.info('DASHBOARD', `  POST /api/admin/promocodes - Create promo code`);
                Logger.info('DASHBOARD', `  GET  /api/admin/analytics/revenue - Revenue analytics`);
                resolve();
            });
        });
    }
}