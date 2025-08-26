// src/integrations/PromoCodeManager.ts
import { DatabaseManager } from '../types/interfaces';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';

export interface PromoCode {
    code: string;
    type: 'discount' | 'free_activation' | 'extend_days';
    value: number; // Percentage for discount, days for extend_days
    planId?: string; // Specific plan or null for all plans
    maxUses: number;
    currentUses: number;
    expiryDate: Date;
    createdBy: string;
    createdAt: Date;
    isActive: boolean;
    description: string;
    usedBy: Array<{
        threadID: string;
        userID: string;
        usedAt: Date;
        originalPrice?: number;
        discountedPrice?: number;
    }>;
}

export class PromoCodeManager {
    private database: DatabaseManager;
    private promoCodes: Map<string, PromoCode> = new Map();

    constructor(database: DatabaseManager) {
        this.database = database;
        this.loadPromoCodes();
    }

    private async loadPromoCodes(): Promise<void> {
        try {
            const codes = await this.database.global.get('promo_codes', []);

            for (const codeData of codes) {
                const promoCode: PromoCode = {
                    ...codeData,
                    expiryDate: new Date(codeData.expiryDate),
                    createdAt: new Date(codeData.createdAt),
                    usedBy: codeData.usedBy.map((usage: any) => ({
                        ...usage,
                        usedAt: new Date(usage.usedAt)
                    }))
                };

                this.promoCodes.set(promoCode.code.toUpperCase(), promoCode);
            }

            Logger.info('PROMO', `Loaded ${this.promoCodes.size} promo codes`);
        } catch (error) {
            Logger.error('PROMO', 'Error loading promo codes', error);
        }
    }

    private async savePromoCodes(): Promise<void> {
        try {
            const codesArray = Array.from(this.promoCodes.values());
            await this.database.global.set('promo_codes', codesArray);
        } catch (error) {
            Logger.error('PROMO', 'Error saving promo codes', error);
        }
    }

    // Create new promo code
    async createPromoCode(
        code: string,
        type: PromoCode['type'],
        value: number,
        maxUses: number,
        expiryDays: number,
        createdBy: string,
        planId?: string,
        description?: string
    ): Promise<PromoCode> {
        const normalizedCode = code.toUpperCase();

        if (this.promoCodes.has(normalizedCode)) {
            throw new Error(`Promo code ${normalizedCode} already exists`);
        }

        // Validation
        if (type === 'discount' && (value <= 0 || value > 100)) {
            throw new Error('Discount value must be between 1-100%');
        }

        if (type === 'extend_days' && value <= 0) {
            throw new Error('Extend days must be positive');
        }

        if (maxUses <= 0) {
            throw new Error('Max uses must be positive');
        }

        const promoCode: PromoCode = {
            code: normalizedCode,
            type,
            value,
            planId,
            maxUses,
            currentUses: 0,
            expiryDate: new Date(Date.now() + (expiryDays * 24 * 60 * 60 * 1000)),
            createdBy,
            createdAt: new Date(),
            isActive: true,
            description: description || `${type} promo code`,
            usedBy: []
        };

        this.promoCodes.set(normalizedCode, promoCode);
        await this.savePromoCodes();

        Logger.success('PROMO', `Created promo code ${normalizedCode}`, {
            type,
            value,
            maxUses,
            planId
        });

        return promoCode;
    }

    // Validate and apply promo code
    async validateAndApplyPromoCode(
        code: string,
        threadID: string,
        userID: string,
        planId: string,
        originalPrice: number
    ): Promise<{
        isValid: boolean;
        promoCode?: PromoCode;
        discountedPrice?: number;
        discountAmount?: number;
        freeDays?: number;
        error?: string;
    }> {
        const normalizedCode = code.toUpperCase();
        const promoCode = this.promoCodes.get(normalizedCode);

        if (!promoCode) {
            return { isValid: false, error: 'Invalid promo code' };
        }

        // Check if code is active
        if (!promoCode.isActive) {
            return { isValid: false, error: 'Promo code is deactivated' };
        }

        // Check expiry
        if (new Date() > promoCode.expiryDate) {
            return { isValid: false, error: 'Promo code has expired' };
        }

        // Check usage limits
        if (promoCode.currentUses >= promoCode.maxUses) {
            return { isValid: false, error: 'Promo code usage limit reached' };
        }

        // Check if user/thread already used this code
        const alreadyUsed = promoCode.usedBy.some(usage =>
            usage.threadID === threadID || usage.userID === userID
        );
        if (alreadyUsed) {
            return { isValid: false, error: 'Promo code already used by this user/group' };
        }

        // Check plan restriction
        if (promoCode.planId && promoCode.planId !== planId) {
            return { isValid: false, error: `Promo code is only valid for ${promoCode.planId} plan` };
        }

        // Apply promo code based on type
        switch (promoCode.type) {
            case 'discount': {
                const discountAmount = Math.floor(originalPrice * (promoCode.value / 100));
                const discountedPrice = originalPrice - discountAmount;

                return {
                    isValid: true,
                    promoCode,
                    discountedPrice: Math.max(0, discountedPrice),
                    discountAmount
                };
            }

            case 'free_activation': {
                return {
                    isValid: true,
                    promoCode,
                    discountedPrice: 0,
                    discountAmount: originalPrice
                };
            }

            case 'extend_days': {
                return {
                    isValid: true,
                    promoCode,
                    discountedPrice: originalPrice,
                    freeDays: promoCode.value
                };
            }

            default:
                return { isValid: false, error: 'Unknown promo code type' };
        }
    }

    // Mark promo code as used
    async markPromoCodeUsed(
        code: string,
        threadID: string,
        userID: string,
        originalPrice?: number,
        discountedPrice?: number
    ): Promise<void> {
        const normalizedCode = code.toUpperCase();
        const promoCode = this.promoCodes.get(normalizedCode);

        if (!promoCode) {
            throw new Error('Promo code not found');
        }

        promoCode.currentUses++;
        promoCode.usedBy.push({
            threadID,
            userID,
            usedAt: new Date(),
            originalPrice,
            discountedPrice
        });

        await this.savePromoCodes();

        Logger.info('PROMO', `Promo code ${normalizedCode} used`, {
            threadID,
            userID,
            currentUses: promoCode.currentUses,
            maxUses: promoCode.maxUses
        });
    }

    // Get all promo codes (admin)
    async getAllPromoCodes(): Promise<PromoCode[]> {
        return Array.from(this.promoCodes.values());
    }

    // Get promo code details
    getPromoCode(code: string): PromoCode | undefined {
        return this.promoCodes.get(code.toUpperCase());
    }

    // Deactivate promo code
    async deactivatePromoCode(code: string): Promise<boolean> {
        const normalizedCode = code.toUpperCase();
        const promoCode = this.promoCodes.get(normalizedCode);

        if (!promoCode) {
            return false;
        }

        promoCode.isActive = false;
        await this.savePromoCodes();

        Logger.info('PROMO', `Deactivated promo code ${normalizedCode}`);
        return true;
    }

    // Generate random promo code
    static generateRandomCode(length: number = 8): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Get usage statistics
    async getPromoCodeStats(): Promise<{
        totalCodes: number;
        activeCodes: number;
        totalUses: number;
        totalSavings: number;
    }> {
        let totalUses = 0;
        let activeCodes = 0;
        let totalSavings = 0;

        for (const promoCode of this.promoCodes.values()) {
            if (promoCode.isActive && new Date() < promoCode.expiryDate) {
                activeCodes++;
            }

            totalUses += promoCode.currentUses;

            for (const usage of promoCode.usedBy) {
                if (usage.originalPrice && usage.discountedPrice) {
                    totalSavings += usage.originalPrice - usage.discountedPrice;
                }
            }
        }

        return {
            totalCodes: this.promoCodes.size,
            activeCodes,
            totalUses,
            totalSavings
        };
    }

    // Clean expired codes
    async cleanExpiredCodes(): Promise<number> {
        const now = new Date();
        let cleaned = 0;

        for (const [code, promoCode] of this.promoCodes.entries()) {
            if (now > promoCode.expiryDate && promoCode.currentUses === 0) {
                this.promoCodes.delete(code);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            await this.savePromoCodes();
            Logger.info('PROMO', `Cleaned ${cleaned} expired unused promo codes`);
        }

        return cleaned;
    }
}

// Enhanced PayOSManager with promo code integration
// src/integrations/PayOSManager.ts - Enhanced version
import PayOS from '@payos/node';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';
import { DatabaseManager } from '../types/interfaces';
import { PromoCodeManager } from './PromoCodeManager';

// Add to existing interfaces
export interface PaymentData {
    orderCode: number;
    amount: number;
    description: string;
    threadID: string;
    planId: string;
    isRenewal: boolean;
    originalAmount?: number;
    discountAmount?: number;
    promoCode?: string;
    promoDiscount?: number;
    totalDays?: number; // Including bonus days from promo
}

export class EnhancedPayOSManager {
    private payos: PayOS;
    private database: DatabaseManager;
    private config: any;
    private promoCodeManager: PromoCodeManager;
    private subscriptionPlans: Map<string, SubscriptionPlan> = new Map();

    // Statistics tracking
    private statistics = {
        totalRevenue: 0,
        totalSubscriptions: 0,
        activeSubscriptions: 0,
        totalPromoUses: 0,
        totalPromoSavings: 0
    };

    constructor(database: DatabaseManager, config: any) {
        this.database = database;
        this.config = config;
        this.promoCodeManager = new PromoCodeManager(database);

        if (config.payos?.enable) {
            this.payos = new PayOS(
                config.payos.clientId,
                config.payos.apiKey,
                config.payos.checksumKey
            );
        }

        this.loadSubscriptionPlans();
        this.loadStatistics();
        this.setupPeriodicTasks();
    }

    private async loadStatistics(): Promise<void> {
        try {
            const stats = await this.database.global.get('subscription_statistics', {});
            this.statistics = { ...this.statistics, ...stats };
        } catch (error) {
            Logger.error('PAYOS', 'Error loading statistics', error);
        }
    }

    private async saveStatistics(): Promise<void> {
        try {
            await this.database.global.set('subscription_statistics', this.statistics);
        } catch (error) {
            Logger.error('PAYOS', 'Error saving statistics', error);
        }
    }

    // Enhanced subscription activation with promo support
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
        const endDate = new Date(now.getTime() + (totalDays * 24 * 60 * 60 * 1000));

        const existingSubscription = await this.getThreadSubscription(threadID);

        // If extending existing subscription, add to current end date
        let actualEndDate = endDate;
        if (existingSubscription && existingSubscription.endDate > now) {
            actualEndDate = new Date(existingSubscription.endDate.getTime() + (totalDays * 24 * 60 * 60 * 1000));
        }

        const subscription: ThreadSubscription = {
            threadID,
            planId,
            startDate: existingSubscription?.startDate || now,
            endDate: actualEndDate,
            isActive: true,
            totalPaid: (existingSubscription?.totalPaid || 0) + amountPaid,
            renewalCount: existingSubscription ? existingSubscription.renewalCount + 1 : 0,
            lastPaymentDate: now,
            features: plan.features,
            history: [
                ...(existingSubscription?.history || []),
                {
                    action: existingSubscription ? 'renewed' : 'activated',
                    planId,
                    amount: amountPaid,
                    days: totalDays,
                    promoCode,
                    timestamp: now
                }
            ]
        };

        // Save subscription data
        await this.database.global.set(`subscription_${threadID}`, subscription);

        // Update thread data
        await this.database.threads.set(threadID, {
            subscription: {
                isActive: true,
                planId,
                endDate: actualEndDate.toISOString(),
                isTrial,
                lastPayment: {
                    amount: amountPaid,
                    date: now.toISOString(),
                    promoCode
                }
            }
        }, 'subscription');

        // Update statistics
        this.statistics.totalRevenue += amountPaid;
        if (!existingSubscription) {
            this.statistics.totalSubscriptions++;
            this.statistics.activeSubscriptions++;
        }
        await this.saveStatistics();

        Logger.success('PAYOS', `Subscription activated for thread ${threadID}`, {
            planId,
            totalDays,
            endDate: actualEndDate.toISOString(),
            isTrial,
            amountPaid,
            promoCode
        });

        return subscription;
    }

    // Enhanced payment creation with promo code support
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
            const promoResult = await this.promoCodeManager.validateAndApplyPromoCode(
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

        // Handle free activation
        if (finalAmount === 0) {
            await this.activateSubscription(threadID, planId, userID, 0, plan.id === 'trial', bonusDays, appliedPromoCode);

            if (appliedPromoCode) {
                await this.promoCodeManager.markPromoCodeUsed(appliedPromoCode, threadID, userID, plan.price, 0);
            }

            throw new Error('FREE_ACTIVATED');
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
            discountAmount,
            promoCode: appliedPromoCode,
            totalDays: plan.days + bonusDays
        };

        // Store payment data for verification
        await this.database.global.set(`payment_${orderCode}`, paymentData);

        const body = {
            orderCode,
            amount: finalAmount,
            description: paymentData.description,
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

    // Enhanced payment success handler
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

            // Calculate bonus days
            const bonusDays = paymentData.totalDays
                ? paymentData.totalDays - this.subscriptionPlans.get(paymentData.planId)!.days
                : 0;

            // Activate subscription
            await this.activateSubscription(
                paymentData.threadID,
                paymentData.planId,
                'system',
                paymentData.amount,
                false,
                bonusDays,
                paymentData.promoCode
            );

            // Mark promo code as used
            if (paymentData.promoCode) {
                await this.promoCodeManager.markPromoCodeUsed(
                    paymentData.promoCode,
                    paymentData.threadID,
                    'system',
                    paymentData.originalAmount,
                    paymentData.amount
                );
            }

            // Log transaction
            await this.logTransaction({
                orderCode,
                threadID: paymentData.threadID,
                planId: paymentData.planId,
                amount: paymentData.amount,
                originalAmount: paymentData.originalAmount,
                discountAmount: paymentData.discountAmount,
                promoCode: paymentData.promoCode,
                timestamp: new Date(),
                status: 'success'
            });

            // Clean up payment data
            await this.database.global.remove(`payment_${orderCode}`);

            Logger.success('PAYOS', `Subscription activated for thread ${paymentData.threadID}`, {
                orderCode,
                amount: paymentData.amount,
                planId: paymentData.planId,
                promoCode: paymentData.promoCode
            });

            return true;
        } catch (error) {
            Logger.error('PAYOS', 'Error handling payment success', error);
            return false;
        }
    }

    // Transaction logging
    private async logTransaction(transaction: any): Promise<void> {
        try {
            const transactions = await this.database.global.get('transactions', []);
            transactions.push(transaction);

            // Keep only last 1000 transactions
            if (transactions.length > 1000) {
                transactions.splice(0, transactions.length - 1000);
            }

            await this.database.global.set('transactions', transactions);
        } catch (error) {
            Logger.error('PAYOS', 'Error logging transaction', error);
        }
    }

    // Get promo code manager
    getPromoCodeManager(): PromoCodeManager {
        return this.promoCodeManager;
    }

    // Enhanced subscription statistics
    async getEnhancedSubscriptionStats(): Promise<{
        revenue: {
            total: number;
            thisMonth: number;
            lastMonth: number;
            growth: number;
        };
        subscriptions: {
            total: number;
            active: number;
            expired: number;
            trials: number;
        };
        plans: Record<string, {
            subscriptions: number;
            revenue: number;
            averageLifetime: number;
        }>;
        promoCodes: {
            totalUses: number;
            totalSavings: number;
            topCodes: Array<{
                code: string;
                uses: number;
                savings: number;
            }>;
        };
        transactions: {
            total: number;
            thisMonth: number;
            averageOrderValue: number;
        };
    }> {
        try {
            const now = new Date();
            const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

            // Get all transactions
            const transactions = await this.database.global.get('transactions', []);

            // Calculate revenue
            const thisMonthRevenue = transactions
                .filter((t: any) => new Date(t.timestamp) >= thisMonthStart)
                .reduce((sum: number, t: any) => sum + t.amount, 0);

            const lastMonthRevenue = transactions
                .filter((t: any) => new Date(t.timestamp) >= lastMonthStart && new Date(t.timestamp) < thisMonthStart)
                .reduce((sum: number, t: any) => sum + t.amount, 0);

            const revenueGrowth = lastMonthRevenue > 0
                ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
                : 0;

            // Get subscription counts
            const allSubscriptions = await this.getAllSubscriptions();
            const activeCount = allSubscriptions.filter(s => s.isActive && s.endDate > now).length;
            const expiredCount = allSubscriptions.filter(s => !s.isActive || s.endDate <= now).length;
            const trialsCount = allSubscriptions.filter(s => s.planId === 'trial').length;

            // Plan statistics
            const planStats: Record<string, any> = {};
            for (const plan of this.subscriptionPlans.values()) {
                const planSubscriptions = allSubscriptions.filter(s => s.planId === plan.id);
                const planRevenue = transactions
                    .filter((t: any) => t.planId === plan.id)
                    .reduce((sum: number, t: any) => sum + t.amount, 0);

                planStats[plan.id] = {
                    subscriptions: planSubscriptions.length,
                    revenue: planRevenue,
                    averageLifetime: planSubscriptions.length > 0
                        ? planSubscriptions.reduce((sum, s) => sum + s.renewalCount + 1, 0) / planSubscriptions.length
                        : 0
                };
            }

            // Promo code statistics
            const promoStats = await this.promoCodeManager.getPromoCodeStats();
            const allPromoCodes = await this.promoCodeManager.getAllPromoCodes();
            const topCodes = allPromoCodes
                .sort((a, b) => b.currentUses - a.currentUses)
                .slice(0, 5)
                .map(code => ({
                    code: code.code,
                    uses: code.currentUses,
                    savings: code.usedBy.reduce((sum, usage) =>
                        sum + ((usage.originalPrice || 0) - (usage.discountedPrice || 0)), 0)
                }));

            return {
                revenue: {
                    total: this.statistics.totalRevenue,
                    thisMonth: thisMonthRevenue,
                    lastMonth: lastMonthRevenue,
                    growth: revenueGrowth
                },
                subscriptions: {
                    total: allSubscriptions.length,
                    active: activeCount,
                    expired: expiredCount,
                    trials: trialsCount
                },
                plans: planStats,
                promoCodes: {
                    totalUses: promoStats.totalUses,
                    totalSavings: promoStats.totalSavings,
                    topCodes
                },
                transactions: {
                    total: transactions.length,
                    thisMonth: transactions.filter((t: any) => new Date(t.timestamp) >= thisMonthStart).length,
                    averageOrderValue: transactions.length > 0
                        ? transactions.reduce((sum: number, t: any) => sum + t.amount, 0) / transactions.length
                        : 0
                }
            };
        } catch (error) {
            Logger.error('PAYOS', 'Error getting enhanced statistics', error);
            throw error;
        }
    }

    // Get all subscriptions for statistics
    private async getAllSubscriptions(): Promise<ThreadSubscription[]> {
        try {
            // This would need to be implemented based on your database structure
            // For now, return empty array as placeholder
            return [];
        } catch (error) {
            Logger.error('PAYOS', 'Error getting all subscriptions', error);
            return [];
        }
    }

    // Periodic cleanup and maintenance tasks
    private setupPeriodicTasks(): void {
        // Clean expired promo codes daily
        setInterval(async () => {
            try {
                const cleaned = await this.promoCodeManager.cleanExpiredCodes();
                if (cleaned > 0) {
                    Logger.info('PAYOS', `Cleaned ${cleaned} expired promo codes`);
                }
            } catch (error) {
                Logger.error('PAYOS', 'Error in periodic promo cleanup', error);
            }
        }, 24 * 60 * 60 * 1000); // Daily

        // Update statistics hourly
        setInterval(async () => {
            try {
                await this.saveStatistics();
            } catch (error) {
                Logger.error('PAYOS', 'Error in periodic stats update', error);
            }
        }, 60 * 60 * 1000); // Hourly
    }

    private generateOrderCode(): number {
        return Math.floor(Math.random() * 9999999) + 1000000;
    }

    // ... Rest of existing methods (getThreadSubscription, canUseBot, etc.)
}