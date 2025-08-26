// src/integrations/PayOSManager.ts
import PayOS from '@payos/node';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';
import { DatabaseManager } from '../types/interfaces';

export interface SubscriptionPlan {
    id: string;
    name: string;
    price: number;
    days: number;
    description: string;
    features: string[];
    renewalDiscount?: number; // Phần trăm giảm giá khi gia hạn
}

export interface ThreadSubscription {
    threadID: string;
    planId: string;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    totalPaid: number;
    renewalCount: number;
    lastPaymentDate: Date;
    features: string[];
}

export interface PaymentData {
    orderCode: number;
    amount: number;
    description: string;
    threadID: string;
    planId: string;
    isRenewal: boolean;
    originalAmount?: number; // Giá gốc trước khi giảm
    discountAmount?: number; // Số tiền được giảm
}

export class PayOSManager {
    private payos: PayOS;
    private database: DatabaseManager;
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
            renewalDiscount: 10 // 10% giảm giá khi gia hạn
        },
        {
            id: 'premium',
            name: '🌟 Premium Package',
            price: 120000,
            days: 90,
            description: 'Best value for active groups',
            features: ['All commands', 'Advanced AI', 'Custom features', 'Priority support'],
            renewalDiscount: 15 // 15% giảm giá khi gia hạn
        },
        {
            id: 'vip',
            name: '💎 VIP Package',
            price: 200000,
            days: 180,
            description: 'Premium experience with exclusive features',
            features: ['All premium features', 'Custom commands', '24/7 support', 'Special badges'],
            renewalDiscount: 20 // 20% giảm giá khi gia hạn
        }
    ];

    constructor(database: DatabaseManager, config: any) {
        this.database = database;
        this.config = config;

        if (config.payos?.enable) {
            this.payos = new PayOS(
                config.payos.clientId,
                config.payos.apiKey,
                config.payos.checksumKey
            );

            Logger.info('PAYOS', 'PayOS initialized successfully');
        }

        // Load subscription plans
        this.loadSubscriptionPlans();

        // Setup periodic subscription checks
        this.setupSubscriptionChecker();
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
            const subscription = await this.database.global.get(`subscription_${threadID}`);

            if (!subscription) {
                return null;
            }

            return {
                ...subscription,
                startDate: new Date(subscription.startDate),
                endDate: new Date(subscription.endDate),
                lastPaymentDate: new Date(subscription.lastPaymentDate)
            };
        } catch (error) {
            Logger.error('PAYOS', 'Error getting subscription', error);
            return null;
        }
    }

    // Create payment link for subscription
    async createSubscriptionPayment(
        threadID: string,
        planId: string,
        userID: string
    ): Promise<{ checkoutUrl: string; orderCode: number; amount: number; isRenewal: boolean }> {

        if (!this.payos) {
            throw new Error('PayOS not initialized');
        }

        const plan = this.subscriptionPlans.get(planId);
        if (!plan) {
            throw new Error(`Plan ${planId} not found`);
        }

        const existingSubscription = await this.getThreadSubscription(threadID);
        const isRenewal = !!existingSubscription;

        // Calculate price with renewal discount
        let finalAmount = plan.price;
        let discountAmount = 0;

        if (isRenewal && plan.renewalDiscount && plan.renewalDiscount > 0) {
            discountAmount = Math.floor(plan.price * (plan.renewalDiscount / 100));
            finalAmount = plan.price - discountAmount;
        }

        // Free trial handling
        if (plan.price === 0) {
            await this.activateSubscription(threadID, planId, userID, 0, true);
            throw new Error('TRIAL_ACTIVATED'); // Special case for trial
        }

        const orderCode = this.generateOrderCode();

        const paymentData: PaymentData = {
            orderCode,
            amount: finalAmount,
            description: isRenewal
                ? `Gia hạn ${plan.name} cho nhóm ${threadID}`
                : `Đăng ký ${plan.name} cho nhóm ${threadID}`,
            threadID,
            planId,
            isRenewal,
            originalAmount: plan.price,
            discountAmount: isRenewal ? discountAmount : 0
        };

        // Store payment data for verification
        await this.database.global.set(`payment_${orderCode}`, paymentData);

        const body = {
            orderCode,
            amount: finalAmount,
            description: paymentData.description,
            items: [
                {
                    name: plan.name,
                    quantity: 1,
                    price: finalAmount,
                }
            ],
            returnUrl: `${this.config.payos.webhookUrl}/payment/success`,
            cancelUrl: `${this.config.payos.webhookUrl}/payment/cancel`
        };

        const paymentLinkResponse = await this.payos.createPaymentLink(body);

        Logger.info('PAYOS', `Created payment for thread ${threadID}`, {
            orderCode,
            amount: finalAmount,
            plan: plan.name,
            isRenewal,
            discount: discountAmount
        });

        return {
            checkoutUrl: paymentLinkResponse.checkoutUrl,
            orderCode,
            amount: finalAmount,
            isRenewal
        };
    }

    // Handle successful payment webhook
    async handlePaymentSuccess(orderCode: number): Promise<boolean> {
        try {
            // Verify payment with PayOS
            const paymentInfo = await this.payos.getPaymentLinkInformation(orderCode);

            if (paymentInfo.status !== 'PAID') {
                Logger.warn('PAYOS', `Payment ${orderCode} not confirmed as paid`);
                return false;
            }

            // Get stored payment data
            const paymentData = await this.database.global.get(`payment_${orderCode}`) as PaymentData;

            if (!paymentData) {
                Logger.error('PAYOS', `Payment data not found for order ${orderCode}`);
                return false;
            }

            // Activate subscription
            await this.activateSubscription(
                paymentData.threadID,
                paymentData.planId,
                'system', // Will be updated with actual user info
                paymentData.amount,
                false
            );

            // Clean up payment data
            await this.database.global.remove(`payment_${orderCode}`);

            Logger.success('PAYOS', `Subscription activated for thread ${paymentData.threadID}`, {
                orderCode,
                amount: paymentData.amount,
                planId: paymentData.planId,
                isRenewal: paymentData.isRenewal
            });

            return true;
        } catch (error) {
            Logger.error('PAYOS', 'Error handling payment success', error);
            return false;
        }
    }

    // Activate subscription for thread
    async activateSubscription(
        threadID: string,
        planId: string,
        userID: string,
        amountPaid: number,
        isTrial: boolean = false
    ): Promise<ThreadSubscription> {

        const plan = this.subscriptionPlans.get(planId);
        if (!plan) {
            throw new Error(`Plan ${planId} not found`);
        }

        const now = new Date();
        const endDate = new Date(now.getTime() + (plan.days * 24 * 60 * 60 * 1000));

        const existingSubscription = await this.getThreadSubscription(threadID);

        const subscription: ThreadSubscription = {
            threadID,
            planId,
            startDate: now,
            endDate,
            isActive: true,
            totalPaid: (existingSubscription?.totalPaid || 0) + amountPaid,
            renewalCount: existingSubscription ? existingSubscription.renewalCount + 1 : 0,
            lastPaymentDate: now,
            features: plan.features
        };

        await this.database.global.set(`subscription_${threadID}`, subscription);

        // Update thread data
        await this.database.threads.set(threadID, {
            subscription: {
                isActive: true,
                planId,
                endDate: endDate.toISOString(),
                isTrial
            }
        }, 'subscription');

        Logger.success('PAYOS', `Subscription activated for thread ${threadID}`, {
            planId,
            days: plan.days,
            endDate: endDate.toISOString(),
            isTrial
        });

        return subscription;
    }

    // Deactivate expired subscription
    async deactivateSubscription(threadID: string): Promise<void> {
        const subscription = await this.getThreadSubscription(threadID);

        if (subscription) {
            subscription.isActive = false;
            await this.database.global.set(`subscription_${threadID}`, subscription);
        }

        await this.database.threads.set(threadID, {
            subscription: {
                isActive: false,
                endDate: null,
                planId: null
            }
        }, 'subscription');

        Logger.info('PAYOS', `Subscription deactivated for thread ${threadID}`);
    }

    // Get subscription plans for display
    getSubscriptionPlans(): SubscriptionPlan[] {
        return Array.from(this.subscriptionPlans.values());
    }

    // Get plan by ID
    getPlan(planId: string): SubscriptionPlan | undefined {
        return this.subscriptionPlans.get(planId);
    }

    // Check if thread can use bot (has active subscription)
    async canUseBot(threadID: string): Promise<{ canUse: boolean; reason?: string; subscription?: ThreadSubscription }> {
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
                return `⏰ **Subscription Expired**\n\n` +
                    `Your subscription expired on ${subscription?.endDate.toLocaleDateString()}.\n` +
                    `Renew now with \`!renew\` to get ${this.getPlan(subscription!.planId)?.renewalDiscount || 10}% discount!`;

            case 'SUBSCRIPTION_INACTIVE':
                return `⚠️ **Subscription Inactive**\n\n` +
                    `Your subscription is currently inactive.\n` +
                    `Contact support for assistance.`;

            default:
                return `❌ **Unable to check subscription status**\n\n` +
                    `Please try again later or contact support.`;
        }
    }

    // Setup periodic subscription checker
    private setupSubscriptionChecker(): void {
        // Check every hour for expired subscriptions
        setInterval(async () => {
            await this.checkExpiredSubscriptions();
        }, 60 * 60 * 1000);

        // Check every day for expiring subscriptions (3 days before expiry)
        setInterval(async () => {
            await this.notifyExpiringSubscriptions();
        }, 24 * 60 * 60 * 1000);

        Logger.info('PAYOS', 'Subscription checker setup completed');
    }

    // Check and deactivate expired subscriptions
    private async checkExpiredSubscriptions(): Promise<void> {
        try {
            // This would need to be implemented based on your database structure
            // For now, it's a placeholder
            Logger.debug('PAYOS', 'Checking for expired subscriptions...');
        } catch (error) {
            Logger.error('PAYOS', 'Error checking expired subscriptions', error);
        }
    }

    // Notify about expiring subscriptions
    private async notifyExpiringSubscriptions(): Promise<void> {
        try {
            // This would send notifications to groups about expiring subscriptions
            Logger.debug('PAYOS', 'Checking for expiring subscriptions...');
        } catch (error) {
            Logger.error('PAYOS', 'Error notifying expiring subscriptions', error);
        }
    }

    // Utility methods
    private generateOrderCode(): number {
        return Math.floor(Math.random() * 9999999) + 1000000;
    }

    // Get renewal discount info
    getRenewalDiscount(threadID: string): Promise<{ hasDiscount: boolean; discount: number; newPrice: number } | null> {
        return new Promise(async (resolve) => {
            try {
                const subscription = await this.getThreadSubscription(threadID);

                if (!subscription) {
                    resolve(null);
                    return;
                }

                const plan = this.getPlan(subscription.planId);

                if (!plan || !plan.renewalDiscount) {
                    resolve({ hasDiscount: false, discount: 0, newPrice: plan?.price || 0 });
                    return;
                }

                const discountAmount = Math.floor(plan.price * (plan.renewalDiscount / 100));
                const newPrice = plan.price - discountAmount;

                resolve({
                    hasDiscount: true,
                    discount: plan.renewalDiscount,
                    newPrice
                });
            } catch (error) {
                Logger.error('PAYOS', 'Error getting renewal discount', error);
                resolve(null);
            }
        });
    }

    // Get subscription statistics
    async getSubscriptionStats(): Promise<{
        totalSubscriptions: number;
        activeSubscriptions: number;
        expiredSubscriptions: number;
        totalRevenue: number;
        planStats: Record<string, number>;
    }> {
        // This would need proper implementation based on your database
        // For now, return placeholder data
        return {
            totalSubscriptions: 0,
            activeSubscriptions: 0,
            expiredSubscriptions: 0,
            totalRevenue: 0,
            planStats: {}
        };
    }
}