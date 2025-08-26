// src/integrations/PayOSManager.ts - Enhanced version with SQL integration
import PayOS from '@payos/node';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';
import { EnhancedSQLiteDatabase, TransactionData, SubscriptionData } from '../database/providers/EnhancedSQLiteDatabase';

export interface SubscriptionPlan {
    id: string;
    name: string;
    price: number;
    days: number;
    description: string;
    features: string[];
    renewalDiscount?: number;
}

export interface ThreadSubscription {
    id: string;
    threadID: string;
    planId: string;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    totalPaid: number;
    renewalCount: number;
    lastPaymentDate: Date;
    features: string[];
    isTrial: boolean;
    createdBy: string;
    history: SubscriptionHistory[];
}

export interface SubscriptionHistory {
    action: 'activated' | 'renewed' | 'extended' | 'deactivated';
    planId: string;
    amount: number;
    days: number;
    promoCode?: string;
    timestamp: Date;
    orderCode?: number;
}

export interface PaymentData {
    orderCode: number;
    amount: number;
    description: string;
    threadID: string;
    planId: string;
    userID: string;
    isRenewal: boolean;
    originalAmount?: number;
    discountAmount?: number;
    promoCode?: string;
    totalDays?: number;
    status: 'pending' | 'success' | 'failed' | 'cancelled';
    timestamp: Date;
    metadata: Record<string, any>;
    paymentMethod: 'payos' | 'manual' | 'promo';
}

export class PayOSManager {
    private payos?: PayOS; // Made optional since it might not be initialized
    private database: EnhancedSQLiteDatabase;
    private config: any;
    private subscriptionPlans: Map<string, SubscriptionPlan> = new Map();

    // Default subscription plans
    private defaultPlans: SubscriptionPlan[] = [
        {
            id: 'trial',
            name: '🆓 Trial Package',
            price: 0,
            days: 7,
            description: 'Free trial for new groups',
            features: ['Basic commands', 'Fun games', 'Economy system'],
            renewalDiscount: 0
        },
        {
            id: 'basic',
            name: '⭐ Basic Package',
            price: 50000,
            days: 30,
            description: 'Perfect for small groups',
            features: ['All basic commands', 'AI features', 'Economy system', 'Welcome messages'],
            renewalDiscount: 10
        },
        {
            id: 'premium',
            name: '🌟 Premium Package',
            price: 120000,
            days: 90,
            description: 'Best value for active groups',
            features: ['All commands', 'Advanced AI', 'Custom features', 'Priority support'],
            renewalDiscount: 15
        },
        {
            id: 'vip',
            name: '💎 VIP Package',
            price: 200000,
            days: 180,
            description: 'Premium experience with exclusive features',
            features: ['All premium features', 'Custom commands', '24/7 support', 'Special badges'],
            renewalDiscount: 20
        }
    ];

    constructor(database: EnhancedSQLiteDatabase, config: any) {
        this.database = database;
        this.config = config;

        if (config.payos?.enable) {
            this.payos = new PayOS(
                config.payos.clientId,
                config.payos.apiKey,
                config.payos.checksumKey
            );
            Logger.info('PAYOS', 'PayOS initialized successfully');
        } else {
            Logger.info('PAYOS', 'PayOS disabled in configuration');
        }

        this.loadSubscriptionPlans();
        this.setupPeriodicTasks();
    }

    private loadSubscriptionPlans(): void {
        // Load default plans
        for (const plan of this.defaultPlans) {
            this.subscriptionPlans.set(plan.id, plan);
        }

        // Load custom plans from config
        if (this.config.payos?.packages) {
            for (const [id, packageInfo] of Object.entries(this.config.payos.packages)) {
                const plan: SubscriptionPlan = {
                    id,
                    name: (packageInfo as any).name,
                    price: (packageInfo as any).price,
                    days: (packageInfo as any).days,
                    description: (packageInfo as any).description,
                    features: (packageInfo as any).features || [],
                    renewalDiscount: (packageInfo as any).renewalDiscount || 10
                };
                this.subscriptionPlans.set(id, plan);
            }
        }

        Logger.info('PAYOS', `Loaded ${this.subscriptionPlans.size} subscription plans`);
    }

    // Check if thread has active subscription
    async hasActiveSubscription(threadID: string): Promise<boolean> {
        try {
            const subscription = await this.getThreadSubscription(threadID);

            if (!subscription) {
                return false;
            }

            const now = new Date();
            const isActive = subscription.isActive && subscription.endDate > now;

            if (!isActive && subscription.endDate < now) {
                // Subscription expired, deactivate it
                await this.deactivateSubscription(threadID);
            }

            return isActive;
        } catch (error) {
            Logger.error('PAYOS', 'Error checking subscription status', error);
            return false;
        }
    }

    // Get thread subscription details
    async getThreadSubscription(threadID: string): Promise<ThreadSubscription | null> {
        try {
            const subscription = await this.database.getSubscriptionByThread(threadID);
            return subscription as ThreadSubscription | null;
        } catch (error) {
            Logger.error('PAYOS', 'Error getting subscription', error);
            return null;
        }
    }

    // Create payment link for subscription with promo code support
    async createSubscriptionPayment(
        threadID: string,
        planId: string,
        userID: string,
        promoCode?: string
    ): Promise<{
        checkoutUrl: string;
        orderCode: number;
        amount: number;
        isRenewal: boolean;
        promoApplied?: string;
        discountAmount?: number;
        bonusDays?: number;
    }> {
        if (!this.payos) {
            throw new Error('PayOS not initialized');
        }

        const plan = this.subscriptionPlans.get(planId);
        if (!plan) {
            throw new Error(`Plan ${planId} not found`);
        }

        const existingSubscription = await this.getThreadSubscription(threadID);
        const isRenewal = !!existingSubscription;

        let finalAmount = plan.price;
        let discountAmount = 0;
        let bonusDays = 0;
        let appliedPromoCode = '';

        // Apply renewal discount first
        if (isRenewal && plan.renewalDiscount && plan.renewalDiscount > 0) {
            const renewalDiscount = Math.floor(plan.price * (plan.renewalDiscount / 100));
            finalAmount = plan.price - renewalDiscount;
            discountAmount += renewalDiscount;
        }

        // Apply promo code if provided
        if (promoCode) {
            const promoManager = (global as any).bot.promoCodeManager;
            if (promoManager) {
                const promoResult = await promoManager.validateAndApplyPromoCode(
                    promoCode, threadID, userID, planId, finalAmount
                );

                if (!promoResult.isValid) {
                    throw new Error(promoResult.error);
                }

                if (promoResult.discountedPrice !== undefined) {
                    const promoDiscount = finalAmount - promoResult.discountedPrice;
                    finalAmount = promoResult.discountedPrice;
                    discountAmount += promoDiscount;
                }

                if (promoResult.freeDays) {
                    bonusDays = promoResult.freeDays;
                }

                appliedPromoCode = promoCode;
            }
        }

        // Handle free activation
        if (finalAmount === 0) {
            await this.activateSubscription(
                threadID, planId, userID, 0, plan.id === 'trial', bonusDays, appliedPromoCode
            );

            if (appliedPromoCode) {
                const promoManager = (global as any).bot.promoCodeManager;
                if (promoManager) {
                    await promoManager.markPromoCodeUsed(
                        appliedPromoCode, threadID, userID, plan.price, 0
                    );
                }
            }

            throw new Error('FREE_ACTIVATED');
        }

        const orderCode = this.generateOrderCode();

        // Create proper TransactionData object matching the interface
        const transactionData: Omit<TransactionData, 'id'> = {
            orderCode,
            threadID,
            userID,
            planId,
            amount: finalAmount,
            originalAmount: plan.price,
            discountAmount,
            promoCode: appliedPromoCode || undefined,
            status: 'pending',
            paymentMethod: 'payos',
            timestamp: new Date(),
            completedAt: undefined,
            metadata: {
                description: isRenewal
                    ? `Gia hạn ${plan.name} cho nhóm ${threadID}`
                    : `Đăng ký ${plan.name} cho nhóm ${threadID}`,
                isRenewal,
                bonusDays,
                totalDays: plan.days + bonusDays,
                renewalDiscount: isRenewal ? plan.renewalDiscount : 0,
                features: plan.features
            }
        };

        // Store payment data in database
        await this.database.createTransaction(transactionData);

        const body = {
            orderCode,
            amount: finalAmount,
            description: transactionData.metadata.description,
            items: [
                {
                    name: plan.name + (bonusDays ? ` + ${bonusDays} bonus days` : ''),
                    quantity: 1,
                    price: finalAmount,
                }
            ],
            returnUrl: `${this.config.payos.webhookUrl}/payment/success?orderCode=${orderCode}`,
            cancelUrl: `${this.config.payos.webhookUrl}/payment/cancel?orderCode=${orderCode}`
        };

        const paymentLinkResponse = await this.payos.createPaymentLink(body);

        Logger.info('PAYOS', `Created payment for thread ${threadID}`, {
            orderCode,
            amount: finalAmount,
            plan: plan.name,
            isRenewal,
            discount: discountAmount,
            promoCode: appliedPromoCode,
            bonusDays
        });

        return {
            checkoutUrl: paymentLinkResponse.checkoutUrl,
            orderCode,
            amount: finalAmount,
            isRenewal,
            promoApplied: appliedPromoCode,
            discountAmount,
            bonusDays
        };
    }

    // Handle successful payment webhook
    async handlePaymentSuccess(orderCode: number): Promise<boolean> {
        try {
            if (!this.payos) {
                throw new Error('PayOS not initialized');
            }

            // Verify payment with PayOS
            const paymentInfo = await this.payos.getPaymentLinkInformation(orderCode);

            if (paymentInfo.status !== 'PAID') {
                Logger.warn('PAYOS', `Payment ${orderCode} not confirmed as paid`);
                return false;
            }

            // Get stored payment data from database
            const transaction = await this.database.getTransactionByOrderCode(orderCode);

            if (!transaction) {
                Logger.error('PAYOS', `Transaction not found for order ${orderCode}`);
                return false;
            }

            // Update transaction status
            await this.database.updateTransactionStatus(orderCode, 'success', new Date());

            // Calculate bonus days from metadata
            const bonusDays = transaction.metadata?.bonusDays || 0;

            // Activate subscription
            await this.activateSubscription(
                transaction.threadID,
                transaction.planId,
                transaction.userID,
                transaction.amount,
                false,
                bonusDays,
                transaction.promoCode || undefined
            );

            // Mark promo code as used if applicable
            if (transaction.promoCode) {
                const promoManager = (global as any).bot.promoCodeManager;
                if (promoManager) {
                    await promoManager.markPromoCodeUsed(
                        transaction.promoCode,
                        transaction.threadID,
                        transaction.userID,
                        transaction.originalAmount || transaction.amount,
                        transaction.amount
                    );
                }
            }

            Logger.success('PAYOS', `Subscription activated for thread ${transaction.threadID}`, {
                orderCode,
                amount: transaction.amount,
                planId: transaction.planId,
                promoCode: transaction.promoCode
            });

            return true;
        } catch (error) {
            Logger.error('PAYOS', 'Error handling payment success', error);

            // Update transaction status to failed
            try {
                await this.database.updateTransactionStatus(orderCode, 'failed');
            } catch (updateError) {
                Logger.error('PAYOS', 'Failed to update transaction status to failed', updateError);
            }

            return false;
        }
    }

    // Activate subscription for thread
    async activateSubscription(
        threadID: string,
        planId: string,
        userID: string,
        amountPaid: number,
        isTrial: boolean = false,
        bonusDays: number = 0,
        promoCode?: string
    ): Promise<ThreadSubscription> {
        const plan = this.subscriptionPlans.get(planId);
        if (!plan) {
            throw new Error(`Plan ${planId} not found`);
        }

        const now = new Date();
        const totalDays = plan.days + bonusDays;
        let endDate = new Date(now.getTime() + (totalDays * 24 * 60 * 60 * 1000));

        const existingSubscription = await this.getThreadSubscription(threadID);

        // If extending existing subscription, add to current end date
        if (existingSubscription && existingSubscription.endDate > now) {
            endDate = new Date(existingSubscription.endDate.getTime() + (totalDays * 24 * 60 * 60 * 1000));
        }

        const subscriptionHistory: SubscriptionHistory = {
            action: existingSubscription ? 'renewed' : 'activated',
            planId,
            amount: amountPaid,
            days: totalDays,
            promoCode,
            timestamp: now
        };

        const subscriptionData: Omit<SubscriptionData, 'id'> = {
            threadID,
            planId,
            startDate: existingSubscription?.startDate || now,
            endDate,
            isActive: true,
            totalPaid: (existingSubscription?.totalPaid || 0) + amountPaid,
            renewalCount: existingSubscription ? existingSubscription.renewalCount + 1 : 0,
            lastPaymentDate: now,
            features: plan.features,
            isTrial,
            createdBy: userID,
            history: [
                ...(existingSubscription?.history || []),
                subscriptionHistory
            ]
        };

        // Save to enhanced database
        const subscription = await this.database.createSubscription(subscriptionData);

        // Update thread data in main database
        const mainDatabase = (global as any).bot.getDatabase();
        if (mainDatabase) {
            await mainDatabase.threads.set(threadID, {
                subscription: {
                    isActive: true,
                    planId,
                    endDate: endDate.toISOString(),
                    isTrial,
                    lastPayment: {
                        amount: amountPaid,
                        date: now.toISOString(),
                        promoCode
                    }
                }
            }, 'subscription');
        }

        Logger.success('PAYOS', `Subscription activated for thread ${threadID}`, {
            planId,
            totalDays,
            endDate: endDate.toISOString(),
            isTrial,
            amountPaid,
            promoCode
        });

        return subscription as ThreadSubscription;
    }

    // Deactivate expired subscription
    async deactivateSubscription(threadID: string): Promise<void> {
        try {
            await this.database.updateSubscription(threadID, { isActive: false });

            const mainDatabase = (global as any).bot.getDatabase();
            if (mainDatabase) {
                await mainDatabase.threads.set(threadID, {
                    subscription: {
                        isActive: false,
                        endDate: null,
                        planId: null
                    }
                }, 'subscription');
            }

            Logger.info('PAYOS', `Subscription deactivated for thread ${threadID}`);
        } catch (error) {
            Logger.error('PAYOS', `Failed to deactivate subscription for thread ${threadID}`, error);
        }
    }

    // Get subscription plans for display
    getSubscriptionPlans(): SubscriptionPlan[] {
        return Array.from(this.subscriptionPlans.values());
    }

    // Get plan by ID
    getPlan(planId: string): SubscriptionPlan | undefined {
        return this.subscriptionPlans.get(planId);
    }

    // Check if thread can use bot
    async canUseBot(threadID: string): Promise<{
        canUse: boolean;
        reason?: string;
        subscription?: ThreadSubscription | null
    }> {
        try {
            const subscription = await this.getThreadSubscription(threadID);

            if (!subscription) {
                return {
                    canUse: false,
                    reason: 'NO_SUBSCRIPTION',
                    subscription: null
                };
            }

            const now = new Date();

            if (!subscription.isActive) {
                return {
                    canUse: false,
                    reason: 'SUBSCRIPTION_INACTIVE',
                    subscription
                };
            }

            if (subscription.endDate < now) {
                // Auto deactivate expired subscription
                await this.deactivateSubscription(threadID);

                return {
                    canUse: false,
                    reason: 'SUBSCRIPTION_EXPIRED',
                    subscription
                };
            }

            return {
                canUse: true,
                subscription
            };
        } catch (error) {
            Logger.error('PAYOS', 'Error checking bot access', error);
            return {
                canUse: false,
                reason: 'ERROR',
                subscription: null
            };
        }
    }

    // Get subscription status message
    async getSubscriptionStatusMessage(threadID: string): Promise<string> {
        const { canUse, reason, subscription } = await this.canUseBot(threadID);

        if (canUse && subscription) {
            const plan = this.getPlan(subscription.planId);
            const daysLeft = Math.ceil((subscription.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

            return `✅ **Subscription Active**\n\n` +
                `📦 **Plan:** ${plan?.name || subscription.planId}\n` +
                `📅 **Days Left:** ${daysLeft} days\n` +
                `🔄 **Renewals:** ${subscription.renewalCount}\n` +
                `💰 **Total Paid:** ${Utils.formatNumber(subscription.totalPaid)}đ\n` +
                `📊 **Features:** ${subscription.features.join(', ')}`;
        }

        switch (reason) {
            case 'NO_SUBSCRIPTION':
                return `❌ **No Active Subscription**\n\n` +
                    `This group needs an active subscription to use the bot.\n` +
                    `Use \`!subscribe\` to see available plans.`;

            case 'SUBSCRIPTION_EXPIRED':
                const plan = subscription ? this.getPlan(subscription.planId) : null;
                const renewalDiscount = plan?.renewalDiscount || 10;
                return `⏰ **Subscription Expired**\n\n` +
                    `Your subscription expired on ${subscription?.endDate.toLocaleDateString()}.\n` +
                    `Renew now with \`!renew\` to get ${renewalDiscount}% discount!`;

            case 'SUBSCRIPTION_INACTIVE':
                return `⚠️ **Subscription Inactive**\n\n` +
                    `Your subscription is currently inactive.\n` +
                    `Contact support for assistance.`;

            default:
                return `❌ **Unable to check subscription status**\n\n` +
                    `Please try again later or contact support.`;
        }
    }

    // Get renewal discount info
    async getRenewalDiscount(threadID: string): Promise<{
        hasDiscount: boolean;
        discount: number;
        newPrice: number;
    } | null> {
        try {
            const subscription = await this.getThreadSubscription(threadID);

            if (!subscription) {
                return null;
            }

            const plan = this.getPlan(subscription.planId);

            if (!plan || !plan.renewalDiscount) {
                return { hasDiscount: false, discount: 0, newPrice: plan?.price || 0 };
            }

            const discountAmount = Math.floor(plan.price * (plan.renewalDiscount / 100));
            const newPrice = plan.price - discountAmount;

            return {
                hasDiscount: true,
                discount: plan.renewalDiscount,
                newPrice
            };
        } catch (error) {
            Logger.error('PAYOS', 'Error getting renewal discount', error);
            return null;
        }
    }

    // Get subscription statistics - fixed return type
    async getSubscriptionStats(): Promise<{
        totalSubscriptions: number;
        activeSubscriptions: number;
        expiredSubscriptions: number;
        totalRevenue: number;
        planStats: Record<string, number>;
    }> {
        try {
            const stats = await this.database.getSubscriptionStats();

            return {
                totalSubscriptions: stats.total,
                activeSubscriptions: stats.active,
                expiredSubscriptions: stats.expired,
                totalRevenue: stats.totalRevenue,
                planStats: stats.planDistribution
            };
        } catch (error) {
            Logger.error('PAYOS', 'Error getting subscription statistics', error);
            return {
                totalSubscriptions: 0,
                activeSubscriptions: 0,
                expiredSubscriptions: 0,
                totalRevenue: 0,
                planStats: {}
            };
        }
    }

    // Get enhanced subscription statistics
    async getEnhancedSubscriptionStats(): Promise<any> {
        try {
            const [subscriptionStats, transactionStats, revenueAnalytics] = await Promise.all([
                this.database.getSubscriptionStats(),
                this.database.getTransactionStats(30),
                this.database.getRevenueAnalytics(30)
            ]);

            return {
                revenue: {
                    total: revenueAnalytics.totalRevenue,
                    thisMonth: transactionStats.totalRevenue,
                    lastMonth: 0, // Would need additional query
                    growth: revenueAnalytics.monthlyGrowth
                },
                subscriptions: {
                    total: subscriptionStats.total,
                    active: subscriptionStats.active,
                    expired: subscriptionStats.expired,
                    trials: subscriptionStats.trials
                },
                plans: subscriptionStats.planDistribution,
                promoCodes: {
                    totalUses: 0, // Would be populated by promo manager
                    totalSavings: 0,
                    topCodes: []
                },
                transactions: {
                    total: transactionStats.total,
                    thisMonth: transactionStats.successful,
                    averageOrderValue: transactionStats.averageOrderValue
                }
            };
        } catch (error) {
            Logger.error('PAYOS', 'Error getting enhanced statistics', error);
            throw error;
        }
    }

    // Setup periodic tasks
    private setupPeriodicTasks(): void {
        // Check expired subscriptions every hour
        setInterval(async () => {
            await this.checkExpiredSubscriptions();
        }, 60 * 60 * 1000);

        // Notify expiring subscriptions daily
        setInterval(async () => {
            await this.notifyExpiringSubscriptions();
        }, 24 * 60 * 60 * 1000);

        Logger.info('PAYOS', 'Subscription checker setup completed');
    }

    // Check and deactivate expired subscriptions
    private async checkExpiredSubscriptions(): Promise<void> {
        try {
            const expiredSubscriptions = await this.database.getExpiredSubscriptions();

            for (const subscription of expiredSubscriptions) {
                if (subscription.isActive) {
                    await this.deactivateSubscription(subscription.threadID);
                    Logger.info('PAYOS', `Auto-deactivated expired subscription for thread ${subscription.threadID}`);
                }
            }
        } catch (error) {
            Logger.error('PAYOS', 'Error checking expired subscriptions', error);
        }
    }

    // Notify about expiring subscriptions
    private async notifyExpiringSubscriptions(): Promise<void> {
        try {
            // Get subscriptions expiring in 3 days
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            const activeSubscriptions = await this.database.getActiveSubscriptions();
            const expiringSubscriptions = activeSubscriptions.filter(
                sub => sub.endDate <= threeDaysFromNow
            );

            const api = (global as any).bot.getAPI();
            if (!api) return;

            for (const subscription of expiringSubscriptions) {
                const plan = this.getPlan(subscription.planId);
                const daysLeft = Math.ceil((subscription.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

                if (daysLeft <= 3 && daysLeft > 0) {
                    const renewalDiscount = plan?.renewalDiscount || 10;
                    const notificationMessage = `⚠️ **Subscription Expiring Soon!**\n\n` +
                        `📅 **${daysLeft} day${daysLeft > 1 ? 's' : ''} remaining**\n` +
                        `🎉 **Renew now and save ${renewalDiscount}%!**\n` +
                        `Use \`!renew\` to extend your subscription`;

                    try {
                        await api.sendMessage(notificationMessage, subscription.threadID);
                        Logger.info('PAYOS', `Sent expiry notification to thread ${subscription.threadID}`);
                    } catch (error) {
                        Logger.warn('PAYOS', `Failed to send expiry notification to thread ${subscription.threadID}`, error);
                    }
                }
            }
        } catch (error) {
            Logger.error('PAYOS', 'Error notifying expiring subscriptions', error);
        }
    }

    // Utility methods
    private generateOrderCode(): number {
        return Math.floor(Math.random() * 9999999) + 1000000;
    }

    // Handle payment cancellation
    async handlePaymentCancellation(orderCode: number): Promise<void> {
        try {
            await this.database.updateTransactionStatus(orderCode, 'cancelled');
            Logger.info('PAYOS', `Payment ${orderCode} marked as cancelled`);
        } catch (error) {
            Logger.error('PAYOS', `Failed to update cancelled payment ${orderCode}`, error);
        }
    }

    // Get transaction history for thread - fixed return type
    async getTransactionHistory(threadID: string, limit: number = 10): Promise<PaymentData[]> {
        try {
            const transactions = await this.database.getTransactionsByThread(threadID, limit);

            // Convert TransactionData to PaymentData format
            return transactions.map((transaction): PaymentData => ({
                orderCode: transaction.orderCode,
                amount: transaction.amount,
                description: transaction.metadata?.description || `Transaction ${transaction.orderCode}`,
                threadID: transaction.threadID,
                planId: transaction.planId,
                userID: transaction.userID,
                isRenewal: transaction.metadata?.isRenewal || false,
                originalAmount: transaction.originalAmount,
                discountAmount: transaction.discountAmount,
                promoCode: transaction.promoCode,
                totalDays: transaction.metadata?.totalDays,
                status: transaction.status,
                timestamp: transaction.timestamp,
                metadata: transaction.metadata,
                paymentMethod: transaction.paymentMethod
            }));
        } catch (error) {
            Logger.error('PAYOS', `Error getting transaction history for thread ${threadID}`, error);
            return [];
        }
    }

    // Manual subscription activation (admin)
    async manualActivation(
        threadID: string,
        planId: string,
        adminUserID: string,
        reason: string
    ): Promise<ThreadSubscription> {
        const plan = this.getPlan(planId);
        if (!plan) {
            throw new Error(`Plan ${planId} not found`);
        }

        Logger.info('PAYOS', `Manual activation requested by admin ${adminUserID}`, {
            threadID,
            planId,
            reason
        });

        return await this.activateSubscription(threadID, planId, adminUserID, 0, false, 0);
    }
}