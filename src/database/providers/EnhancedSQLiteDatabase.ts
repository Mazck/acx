// src/database/providers/EnhancedSQLiteDatabase.ts
import path from "node:path";
import fs from "node:fs";
import {
    Sequelize,
    Model,
    DataTypes,
    Transaction,
    Optional,
} from "sequelize";

import { Logger } from "../../utils/Logger";
import { DatabaseManager, UserData, ThreadData, ThreadSettings } from "../../types/interfaces";
import { SQLiteDatabase } from "./SQLiteDatabase";

// Enhanced interfaces for subscription system
export interface SubscriptionData {
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

export interface TransactionData {
    id: string;
    orderCode: number;
    threadID: string;
    userID: string;
    planId: string;
    amount: number;
    originalAmount: number;
    discountAmount: number;
    promoCode?: string;
    status: 'pending' | 'success' | 'failed' | 'cancelled';
    paymentMethod: 'payos' | 'manual' | 'promo';
    timestamp: Date;
    completedAt?: Date;
    metadata: Record<string, any>;
}

export interface PromoCodeUsage {
    id: string;
    promoCode: string;
    threadID: string;
    userID: string;
    planId: string;
    originalAmount: number;
    discountedAmount: number;
    discountAmount: number;
    timestamp: Date;
}

// Enhanced Sequelize Models
class SubscriptionModel extends Model<SubscriptionData> implements SubscriptionData {
    declare id: string;
    declare threadID: string;
    declare planId: string;
    declare startDate: Date;
    declare endDate: Date;
    declare isActive: boolean;
    declare totalPaid: number;
    declare renewalCount: number;
    declare lastPaymentDate: Date;
    declare features: string[];
    declare isTrial: boolean;
    declare createdBy: string;
    declare history: SubscriptionHistory[];
}

class TransactionModel extends Model<TransactionData> implements TransactionData {
    declare id: string;
    declare orderCode: number;
    declare threadID: string;
    declare userID: string;
    declare planId: string;
    declare amount: number;
    declare originalAmount: number;
    declare discountAmount: number;
    declare promoCode?: string;
    declare status: 'pending' | 'success' | 'failed' | 'cancelled';
    declare paymentMethod: 'payos' | 'manual' | 'promo';
    declare timestamp: Date;
    declare completedAt?: Date;
    declare metadata: Record<string, any>;
}

class PromoCodeUsageModel extends Model<PromoCodeUsage> implements PromoCodeUsage {
    declare id: string;
    declare promoCode: string;
    declare threadID: string;
    declare userID: string;
    declare planId: string;
    declare originalAmount: number;
    declare discountedAmount: number;
    declare discountAmount: number;
    declare timestamp: Date;
}

export class EnhancedSQLiteDatabase extends SQLiteDatabase {
    private subscriptionModel!: typeof SubscriptionModel;
    private transactionModel!: typeof TransactionModel;
    private promoUsageModel!: typeof PromoCodeUsageModel;

    async initialize(): Promise<void> {
        // Initialize base SQLite database first
        await super.initialize();

        // Initialize enhanced models
        await this.initializeEnhancedModels();

        Logger.info('ENHANCED_DB', 'Enhanced SQLite database initialized with subscription system');
    }

    private async initializeEnhancedModels(): Promise<void> {
        // Subscription model
        this.subscriptionModel = SubscriptionModel.init(
            {
                id: {
                    type: DataTypes.UUID,
                    defaultValue: DataTypes.UUIDV4,
                    primaryKey: true
                },
                threadID: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    index: true
                },
                planId: {
                    type: DataTypes.STRING,
                    allowNull: false
                },
                startDate: {
                    type: DataTypes.DATE,
                    allowNull: false
                },
                endDate: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    index: true
                },
                isActive: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: true,
                    index: true
                },
                totalPaid: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                renewalCount: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                lastPaymentDate: {
                    type: DataTypes.DATE,
                    allowNull: false
                },
                features: {
                    type: DataTypes.JSON,
                    allowNull: false,
                    defaultValue: []
                },
                isTrial: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false
                },
                createdBy: {
                    type: DataTypes.STRING,
                    allowNull: false
                },
                history: {
                    type: DataTypes.JSON,
                    allowNull: false,
                    defaultValue: []
                }
            },
            {
                sequelize: this.sequelize,
                tableName: 'Subscriptions',
                indexes: [
                    { fields: ['threadID'] },
                    { fields: ['endDate'] },
                    { fields: ['isActive'] },
                    { fields: ['planId'] }
                ]
            }
        );

        // Transaction model
        this.transactionModel = TransactionModel.init(
            {
                id: {
                    type: DataTypes.UUID,
                    defaultValue: DataTypes.UUIDV4,
                    primaryKey: true
                },
                orderCode: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    unique: true,
                    index: true
                },
                threadID: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    index: true
                },
                userID: {
                    type: DataTypes.STRING,
                    allowNull: false
                },
                planId: {
                    type: DataTypes.STRING,
                    allowNull: false
                },
                amount: {
                    type: DataTypes.INTEGER,
                    allowNull: false
                },
                originalAmount: {
                    type: DataTypes.INTEGER,
                    allowNull: false
                },
                discountAmount: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                promoCode: {
                    type: DataTypes.STRING,
                    allowNull: true
                },
                status: {
                    type: DataTypes.ENUM('pending', 'success', 'failed', 'cancelled'),
                    allowNull: false,
                    defaultValue: 'pending',
                    index: true
                },
                paymentMethod: {
                    type: DataTypes.ENUM('payos', 'manual', 'promo'),
                    allowNull: false,
                    defaultValue: 'payos'
                },
                timestamp: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    defaultValue: DataTypes.NOW
                },
                completedAt: {
                    type: DataTypes.DATE,
                    allowNull: true
                },
                metadata: {
                    type: DataTypes.JSON,
                    allowNull: false,
                    defaultValue: {}
                }
            },
            {
                sequelize: this.sequelize,
                tableName: 'Transactions',
                indexes: [
                    { fields: ['orderCode'] },
                    { fields: ['threadID'] },
                    { fields: ['status'] },
                    { fields: ['timestamp'] },
                    { fields: ['promoCode'] }
                ]
            }
        );

        // Promo code usage model
        this.promoUsageModel = PromoCodeUsageModel.init(
            {
                id: {
                    type: DataTypes.UUID,
                    defaultValue: DataTypes.UUIDV4,
                    primaryKey: true
                },
                promoCode: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    index: true
                },
                threadID: {
                    type: DataTypes.STRING,
                    allowNull: false,
                    index: true
                },
                userID: {
                    type: DataTypes.STRING,
                    allowNull: false
                },
                planId: {
                    type: DataTypes.STRING,
                    allowNull: false
                },
                originalAmount: {
                    type: DataTypes.INTEGER,
                    allowNull: false
                },
                discountedAmount: {
                    type: DataTypes.INTEGER,
                    allowNull: false
                },
                discountAmount: {
                    type: DataTypes.INTEGER,
                    allowNull: false
                },
                timestamp: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    defaultValue: DataTypes.NOW
                }
            },
            {
                sequelize: this.sequelize,
                tableName: 'PromoCodeUsage',
                indexes: [
                    { fields: ['promoCode'] },
                    { fields: ['threadID'] },
                    { fields: ['timestamp'] },
                    { unique: true, fields: ['promoCode', 'threadID'] }
                ]
            }
        );

        // Sync all models
        await this.sequelize.sync();
    }

    // Enhanced subscription methods
    async createSubscription(data: Omit<SubscriptionData, 'id'>): Promise<SubscriptionData> {
        const subscription = await this.subscriptionModel.create(data as any);
        return subscription.get({ plain: true }) as SubscriptionData;
    }

    async getSubscriptionByThread(threadID: string): Promise<SubscriptionData | null> {
        const subscription = await this.subscriptionModel.findOne({
            where: { threadID },
            order: [['createdAt', 'DESC']]
        });

        return subscription ? subscription.get({ plain: true }) as SubscriptionData : null;
    }

    async getActiveSubscriptions(): Promise<SubscriptionData[]> {
        const subscriptions = await this.subscriptionModel.findAll({
            where: {
                isActive: true,
                endDate: { [this.sequelize.Sequelize.Op.gt]: new Date() }
            },
            raw: true
        });

        return subscriptions as SubscriptionData[];
    }

    async getExpiredSubscriptions(): Promise<SubscriptionData[]> {
        const subscriptions = await this.subscriptionModel.findAll({
            where: {
                [this.sequelize.Sequelize.Op.or]: [
                    { isActive: false },
                    { endDate: { [this.sequelize.Sequelize.Op.lt]: new Date() } }
                ]
            },
            raw: true
        });

        return subscriptions as SubscriptionData[];
    }

    async updateSubscription(threadID: string, updates: Partial<SubscriptionData>): Promise<boolean> {
        const [affectedRows] = await this.subscriptionModel.update(updates, {
            where: { threadID }
        });

        return affectedRows > 0;
    }

    async getSubscriptionStats(): Promise<{
        total: number;
        active: number;
        expired: number;
        trials: number;
        totalRevenue: number;
        planDistribution: Record<string, number>;
    }> {
        const [total, active, expired, trials] = await Promise.all([
            this.subscriptionModel.count(),
            this.subscriptionModel.count({
                where: {
                    isActive: true,
                    endDate: { [this.sequelize.Sequelize.Op.gt]: new Date() }
                }
            }),
            this.subscriptionModel.count({
                where: {
                    [this.sequelize.Sequelize.Op.or]: [
                        { isActive: false },
                        { endDate: { [this.sequelize.Sequelize.Op.lt]: new Date() } }
                    ]
                }
            }),
            this.subscriptionModel.count({
                where: { isTrial: true }
            })
        ]);

        const totalRevenue = await this.subscriptionModel.sum('totalPaid') || 0;

        const planDistribution = await this.subscriptionModel.findAll({
            attributes: [
                'planId',
                [this.sequelize.fn('COUNT', this.sequelize.col('planId')), 'count']
            ],
            group: 'planId',
            raw: true
        }).then((results: any[]) => {
            const distribution: Record<string, number> = {};
            results.forEach(result => {
                distribution[result.planId] = parseInt(result.count);
            });
            return distribution;
        });

        return {
            total,
            active,
            expired,
            trials,
            totalRevenue,
            planDistribution
        };
    }

    // Enhanced transaction methods
    async createTransaction(data: Omit<TransactionData, 'id'>): Promise<TransactionData> {
        const transaction = await this.transactionModel.create(data as any);
        return transaction.get({ plain: true }) as TransactionData;
    }

    async getTransactionByOrderCode(orderCode: number): Promise<TransactionData | null> {
        const transaction = await this.transactionModel.findOne({
            where: { orderCode }
        });

        return transaction ? transaction.get({ plain: true }) as TransactionData : null;
    }

    async updateTransactionStatus(
        orderCode: number,
        status: TransactionData['status'],
        completedAt?: Date
    ): Promise<boolean> {
        const updates: any = { status };
        if (completedAt) {
            updates.completedAt = completedAt;
        }

        const [affectedRows] = await this.transactionModel.update(updates, {
            where: { orderCode }
        });

        return affectedRows > 0;
    }

    async getTransactionsByThread(threadID: string, limit: number = 50): Promise<TransactionData[]> {
        const transactions = await this.transactionModel.findAll({
            where: { threadID },
            order: [['timestamp', 'DESC']],
            limit,
            raw: true
        });

        return transactions as TransactionData[];
    }

    async getTransactionStats(days: number = 30): Promise<{
        total: number;
        successful: number;
        failed: number;
        totalRevenue: number;
        averageOrderValue: number;
        dailyStats: Array<{
            date: string;
            transactions: number;
            revenue: number;
        }>;
    }> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [total, successful, failed] = await Promise.all([
            this.transactionModel.count({
                where: {
                    timestamp: { [this.sequelize.Sequelize.Op.gte]: startDate }
                }
            }),
            this.transactionModel.count({
                where: {
                    status: 'success',
                    timestamp: { [this.sequelize.Sequelize.Op.gte]: startDate }
                }
            }),
            this.transactionModel.count({
                where: {
                    status: 'failed',
                    timestamp: { [this.sequelize.Sequelize.Op.gte]: startDate }
                }
            })
        ]);

        const totalRevenue = await this.transactionModel.sum('amount', {
            where: {
                status: 'success',
                timestamp: { [this.sequelize.Sequelize.Op.gte]: startDate }
            }
        }) || 0;

        const averageOrderValue = successful > 0 ? totalRevenue / successful : 0;

        // Daily statistics
        const dailyStats = await this.transactionModel.findAll({
            attributes: [
                [this.sequelize.fn('DATE', this.sequelize.col('timestamp')), 'date'],
                [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'transactions'],
                [this.sequelize.fn('SUM', this.sequelize.col('amount')), 'revenue']
            ],
            where: {
                status: 'success',
                timestamp: { [this.sequelize.Sequelize.Op.gte]: startDate }
            },
            group: [this.sequelize.fn('DATE', this.sequelize.col('timestamp'))],
            order: [[this.sequelize.fn('DATE', this.sequelize.col('timestamp')), 'ASC']],
            raw: true
        }).then((results: any[]) =>
            results.map(result => ({
                date: result.date,
                transactions: parseInt(result.transactions),
                revenue: parseInt(result.revenue) || 0
            }))
        );

        return {
            total,
            successful,
            failed,
            totalRevenue,
            averageOrderValue,
            dailyStats
        };
    }

    // Enhanced promo code usage methods
    async recordPromoUsage(data: Omit<PromoCodeUsage, 'id'>): Promise<PromoCodeUsage> {
        const usage = await this.promoUsageModel.create(data as any);
        return usage.get({ plain: true }) as PromoCodeUsage;
    }

    async getPromoUsage(promoCode: string): Promise<PromoCodeUsage[]> {
        const usages = await this.promoUsageModel.findAll({
            where: { promoCode },
            order: [['timestamp', 'DESC']],
            raw: true
        });

        return usages as PromoCodeUsage[];
    }

    async checkPromoUsedByThread(promoCode: string, threadID: string): Promise<boolean> {
        const usage = await this.promoUsageModel.findOne({
            where: { promoCode, threadID }
        });

        return !!usage;
    }

    async getPromoUsageStats(promoCode?: string): Promise<{
        totalUses: number;
        totalSavings: number;
        uniqueThreads: number;
        averageDiscount: number;
        topDiscounts: Array<{
            threadID: string;
            discountAmount: number;
            timestamp: Date;
        }>;
    }> {
        const where: any = {};
        if (promoCode) {
            where.promoCode = promoCode;
        }

        const [totalUses, totalSavings, uniqueThreads] = await Promise.all([
            this.promoUsageModel.count({ where }),
            this.promoUsageModel.sum('discountAmount', { where }) || 0,
            this.promoUsageModel.count({
                where,
                distinct: true,
                col: 'threadID'
            })
        ]);

        const averageDiscount = totalUses > 0 ? totalSavings / totalUses : 0;

        const topDiscounts = await this.promoUsageModel.findAll({
            where,
            order: [['discountAmount', 'DESC']],
            limit: 10,
            raw: true
        }).then((results: any[]) =>
            results.map(result => ({
                threadID: result.threadID,
                discountAmount: result.discountAmount,
                timestamp: new Date(result.timestamp)
            }))
        );

        return {
            totalUses,
            totalSavings,
            uniqueThreads,
            averageDiscount,
            topDiscounts
        };
    }

    // Advanced analytics methods
    async getRevenueAnalytics(days: number = 30): Promise<{
        totalRevenue: number;
        recurringRevenue: number;
        newCustomerRevenue: number;
        renewalRate: number;
        churnRate: number;
        lifetimeValue: number;
        monthlyGrowth: number;
    }> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Total revenue from successful transactions
        const totalRevenue = await this.transactionModel.sum('amount', {
            where: {
                status: 'success',
                timestamp: { [this.sequelize.Sequelize.Op.gte]: startDate }
            }
        }) || 0;

        // Recurring revenue (renewals)
        const recurringRevenue = await this.transactionModel.sum('amount', {
            where: {
                status: 'success',
                timestamp: { [this.sequelize.Sequelize.Op.gte]: startDate },
                metadata: {
                    [this.sequelize.Sequelize.Op.like]: '%"isRenewal":true%'
                }
            }
        }) || 0;

        const newCustomerRevenue = totalRevenue - recurringRevenue;

        // Calculate renewal rate
        const totalSubscriptions = await this.subscriptionModel.count();
        const renewedSubscriptions = await this.subscriptionModel.count({
            where: { renewalCount: { [this.sequelize.Sequelize.Op.gt]: 0 } }
        });
        const renewalRate = totalSubscriptions > 0 ? (renewedSubscriptions / totalSubscriptions) * 100 : 0;

        // Calculate churn rate (expired subscriptions in the period)
        const expiredInPeriod = await this.subscriptionModel.count({
            where: {
                endDate: {
                    [this.sequelize.Sequelize.Op.between]: [startDate, new Date()]
                },
                isActive: false
            }
        });
        const churnRate = totalSubscriptions > 0 ? (expiredInPeriod / totalSubscriptions) * 100 : 0;

        // Average lifetime value
        const lifetimeValue = totalSubscriptions > 0 ?
            (await this.subscriptionModel.sum('totalPaid') || 0) / totalSubscriptions : 0;

        // Monthly growth (compare with previous period)
        const prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - days);

        const prevRevenue = await this.transactionModel.sum('amount', {
            where: {
                status: 'success',
                timestamp: {
                    [this.sequelize.Sequelize.Op.between]: [prevStartDate, startDate]
                }
            }
        }) || 0;

        const monthlyGrowth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;

        return {
            totalRevenue,
            recurringRevenue,
            newCustomerRevenue,
            renewalRate,
            churnRate,
            lifetimeValue,
            monthlyGrowth
        };
    }

    // Cleanup methods
    async cleanupExpiredTransactions(days: number = 90): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const deleted = await this.transactionModel.destroy({
            where: {
                status: { [this.sequelize.Sequelize.Op.in]: ['failed', 'cancelled'] },
                timestamp: { [this.sequelize.Sequelize.Op.lt]: cutoffDate }
            }
        });

        Logger.info('ENHANCED_DB', `Cleaned up ${deleted} expired transactions`);
        return deleted;
    }

    async cleanupOldPromoUsage(days: number = 365): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const deleted = await this.promoUsageModel.destroy({
            where: {
                timestamp: { [this.sequelize.Sequelize.Op.lt]: cutoffDate }
            }
        });

        Logger.info('ENHANCED_DB', `Cleaned up ${deleted} old promo usage records`);
        return deleted;
    }

    // Backup and export methods
    async exportSubscriptionData(): Promise<{
        subscriptions: SubscriptionData[];
        transactions: TransactionData[];
        promoUsage: PromoCodeUsage[];
    }> {
        const [subscriptions, transactions, promoUsage] = await Promise.all([
            this.subscriptionModel.findAll({ raw: true }),
            this.transactionModel.findAll({ raw: true }),
            this.promoUsageModel.findAll({ raw: true })
        ]);

        return {
            subscriptions: subscriptions as SubscriptionData[],
            transactions: transactions as TransactionData[],
            promoUsage: promoUsage as PromoCodeUsage[]
        };
    }

    // Health check methods
    async healthCheck(): Promise<{
        database: boolean;
        subscriptions: number;
        activeSubscriptions: number;
        transactions: number;
        promoUsage: number;
    }> {
        try {
            await this.sequelize.authenticate();

            const [subscriptions, activeSubscriptions, transactions, promoUsage] = await Promise.all([
                this.subscriptionModel.count(),
                this.subscriptionModel.count({
                    where: {
                        isActive: true,
                        endDate: { [this.sequelize.Sequelize.Op.gt]: new Date() }
                    }
                }),
                this.transactionModel.count(),
                this.promoUsageModel.count()
            ]);

            return {
                database: true,
                subscriptions,
                activeSubscriptions,
                transactions,
                promoUsage
            };
        } catch (error) {
            Logger.error('ENHANCED_DB', 'Health check failed', error);
            return {
                database: false,
                subscriptions: 0,
                activeSubscriptions: 0,
                transactions: 0,
                promoUsage: 0
            };
        }
    }
}