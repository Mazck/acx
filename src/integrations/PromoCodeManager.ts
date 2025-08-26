// src/integrations/PromoCodeManager.ts - Enhanced version with SQL integration
import { EnhancedSQLiteDatabase } from '../database/providers/EnhancedSQLiteDatabase';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';

export interface PromoCode {
    id: string;
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

export class PromoCodeManager {
    private database: EnhancedSQLiteDatabase;
    private promoCodes: Map<string, PromoCode> = new Map();

    constructor(database: EnhancedSQLiteDatabase) {
        this.database = database;
        this.loadPromoCodes();
    }

    private async loadPromoCodes(): Promise<void> {
        try {
            // Load from enhanced database instead of global storage
            Logger.info('PROMO', 'Loading promo codes from database...');
        } catch (error) {
            Logger.error('PROMO', 'Error loading promo codes', error);
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

        // Check if code already exists
        const existingPromos = await this.database.getPromoUsage(normalizedCode);
        if (existingPromos.length > 0) {
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
            id: Utils.generateID(),
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
            description: description || `${type} promo code`
        };

        // Store in database using global storage as fallback
        try {
            const mainDatabase = (global as any).bot.getDatabase();
            if (mainDatabase) {
                const allPromoCodes = await mainDatabase.global.get('promo_codes', []);
                allPromoCodes.push(promoCode);
                await mainDatabase.global.set('promo_codes', allPromoCodes);
            }
        } catch (error) {
            Logger.error('PROMO', 'Error saving promo code to main database', error);
        }

        this.promoCodes.set(normalizedCode, promoCode);

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

        // Get promo code from database
        const promoCode = await this.getPromoCodeFromDB(normalizedCode);

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
        const alreadyUsed = await this.database.checkPromoUsedByThread(normalizedCode, threadID);
        if (alreadyUsed) {
            return { isValid: false, error: 'Promo code already used by this group' };
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
        const promoCode = await this.getPromoCodeFromDB(normalizedCode);

        if (!promoCode) {
            throw new Error('Promo code not found');
        }

        try {
            // Record usage in enhanced database
            await this.database.recordPromoUsage({
                promoCode: normalizedCode,
                threadID,
                userID,
                planId: '', // Will be filled by the calling function
                originalAmount: originalPrice || 0,
                discountedAmount: discountedPrice || 0,
                discountAmount: (originalPrice || 0) - (discountedPrice || 0),
                timestamp: new Date()
            });

            // Update usage count in main database
            const mainDatabase = (global as any).bot.getDatabase();
            if (mainDatabase) {
                const allPromoCodes = await mainDatabase.global.get('promo_codes', []);
                const promoIndex = allPromoCodes.findIndex((p: PromoCode) => p.code === normalizedCode);

                if (promoIndex !== -1) {
                    allPromoCodes[promoIndex].currentUses++;
                    await mainDatabase.global.set('promo_codes', allPromoCodes);
                }
            }

            // Update local cache
            if (this.promoCodes.has(normalizedCode)) {
                const localPromo = this.promoCodes.get(normalizedCode)!;
                localPromo.currentUses++;
            }

            Logger.info('PROMO', `Promo code ${normalizedCode} used`, {
                threadID,
                userID,
                currentUses: promoCode.currentUses + 1,
                maxUses: promoCode.maxUses
            });
        } catch (error) {
            Logger.error('PROMO', `Error marking promo code ${normalizedCode} as used`, error);
            throw error;
        }
    }

    // Get all promo codes (admin)
    async getAllPromoCodes(): Promise<PromoCode[]> {
        try {
            const mainDatabase = (global as any).bot.getDatabase();
            if (mainDatabase) {
                const allPromoCodes = await mainDatabase.global.get('promo_codes', []);
                return allPromoCodes.map((code: any) => ({
                    ...code,
                    expiryDate: new Date(code.expiryDate),
                    createdAt: new Date(code.createdAt)
                }));
            }
            return [];
        } catch (error) {
            Logger.error('PROMO', 'Error getting all promo codes', error);
            return [];
        }
    }

    // Get promo code details
    async getPromoCode(code: string): Promise<PromoCode | undefined> {
        return await this.getPromoCodeFromDB(code.toUpperCase());
    }

    // Get promo code from database
    private async getPromoCodeFromDB(code: string): Promise<PromoCode | undefined> {
        try {
            const mainDatabase = (global as any).bot.getDatabase();
            if (mainDatabase) {
                const allPromoCodes = await mainDatabase.global.get('promo_codes', []);
                const promoCode = allPromoCodes.find((p: PromoCode) => p.code === code);

                if (promoCode) {
                    return {
                        ...promoCode,
                        expiryDate: new Date(promoCode.expiryDate),
                        createdAt: new Date(promoCode.createdAt)
                    };
                }
            }

            return undefined;
        } catch (error) {
            Logger.error('PROMO', `Error getting promo code ${code} from database`, error);
            return undefined;
        }
    }

    // Deactivate promo code
    async deactivatePromoCode(code: string): Promise<boolean> {
        const normalizedCode = code.toUpperCase();

        try {
            const mainDatabase = (global as any).bot.getDatabase();
            if (mainDatabase) {
                const allPromoCodes = await mainDatabase.global.get('promo_codes', []);
                const promoIndex = allPromoCodes.findIndex((p: PromoCode) => p.code === normalizedCode);

                if (promoIndex !== -1) {
                    allPromoCodes[promoIndex].isActive = false;
                    await mainDatabase.global.set('promo_codes', allPromoCodes);

                    // Update local cache
                    if (this.promoCodes.has(normalizedCode)) {
                        const localPromo = this.promoCodes.get(normalizedCode)!;
                        localPromo.isActive = false;
                    }

                    Logger.info('PROMO', `Deactivated promo code ${normalizedCode}`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            Logger.error('PROMO', `Error deactivating promo code ${normalizedCode}`, error);
            return false;
        }
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
        try {
            // Get stats from enhanced database
            const enhancedStats = await this.database.getPromoUsageStats();

            // Get additional stats from main database
            const allPromoCodes = await this.getAllPromoCodes();
            const activeCodes = allPromoCodes.filter(code =>
                code.isActive && new Date() < code.expiryDate
            ).length;

            return {
                totalCodes: allPromoCodes.length,
                activeCodes,
                totalUses: enhancedStats.totalUses,
                totalSavings: enhancedStats.totalSavings
            };
        } catch (error) {
            Logger.error('PROMO', 'Error getting promo code statistics', error);
            return {
                totalCodes: 0,
                activeCodes: 0,
                totalUses: 0,
                totalSavings: 0
            };
        }
    }

    // Clean expired codes
    async cleanExpiredCodes(): Promise<number> {
        try {
            const now = new Date();
            let cleaned = 0;

            const mainDatabase = (global as any).bot.getDatabase();
            if (mainDatabase) {
                const allPromoCodes = await mainDatabase.global.get('promo_codes', []);
                const validPromoCodes = [];

                for (const code of allPromoCodes) {
                    const expiryDate = new Date(code.expiryDate);

                    if (now > expiryDate && code.currentUses === 0) {
                        cleaned++;
                        Logger.debug('PROMO', `Cleaned expired unused promo code: ${code.code}`);
                    } else {
                        validPromoCodes.push(code);
                    }
                }

                if (cleaned > 0) {
                    await mainDatabase.global.set('promo_codes', validPromoCodes);
                    Logger.info('PROMO', `Cleaned ${cleaned} expired unused promo codes`);
                }
            }

            return cleaned;
        } catch (error) {
            Logger.error('PROMO', 'Error cleaning expired promo codes', error);
            return 0;
        }
    }

    // Get promo code usage history
    async getPromoCodeUsageHistory(code?: string): Promise<PromoCodeUsage[]> {
        try {
            if (code) {
                return await this.database.getPromoUsage(code.toUpperCase());
            } else {
                // Get all usage records
                const stats = await this.database.getPromoUsageStats();
                return stats.topDiscounts.map(discount => ({
                    id: Utils.generateID(),
                    promoCode: 'VARIOUS',
                    threadID: discount.threadID,
                    userID: 'SYSTEM',
                    planId: 'VARIOUS',
                    originalAmount: discount.discountAmount * 2, // Approximate
                    discountedAmount: discount.discountAmount,
                    discountAmount: discount.discountAmount,
                    timestamp: discount.timestamp
                }));
            }
        } catch (error) {
            Logger.error('PROMO', `Error getting promo usage history`, error);
            return [];
        }
    }

    // Validate promo code format
    static validatePromoCodeFormat(code: string): { isValid: boolean; error?: string } {
        if (!code || typeof code !== 'string') {
            return { isValid: false, error: 'Promo code cannot be empty' };
        }

        if (code.length < 4 || code.length > 20) {
            return { isValid: false, error: 'Promo code must be 4-20 characters long' };
        }

        if (!/^[A-Z0-9]+$/.test(code.toUpperCase())) {
            return { isValid: false, error: 'Promo code can only contain letters and numbers' };
        }

        return { isValid: true };
    }

    // Get promo code suggestions based on user behavior
    async getPromoSuggestions(threadID: string): Promise<PromoCode[]> {
        try {
            // Get active promo codes that haven't been used by this thread
            const allPromoCodes = await this.getAllPromoCodes();
            const suggestions = [];

            for (const promoCode of allPromoCodes) {
                if (!promoCode.isActive || new Date() > promoCode.expiryDate) {
                    continue;
                }

                if (promoCode.currentUses >= promoCode.maxUses) {
                    continue;
                }

                const alreadyUsed = await this.database.checkPromoUsedByThread(promoCode.code, threadID);
                if (!alreadyUsed) {
                    suggestions.push(promoCode);
                }
            }

            // Sort by value (highest discount first)
            return suggestions
                .sort((a, b) => b.value - a.value)
                .slice(0, 5); // Return top 5 suggestions

        } catch (error) {
            Logger.error('PROMO', 'Error getting promo suggestions', error);
            return [];
        }
    }

    // Bulk create promo codes
    async bulkCreatePromoCodes(
        type: PromoCode['type'],
        value: number,
        count: number,
        maxUses: number,
        expiryDays: number,
        createdBy: string,
        planId?: string,
        prefix?: string
    ): Promise<PromoCode[]> {
        const promoCodes: PromoCode[] = [];

        for (let i = 0; i < count; i++) {
            const code = (prefix || type.toUpperCase()) + '_' + PromoCodeManager.generateRandomCode(6);

            try {
                const promoCode = await this.createPromoCode(
                    code,
                    type,
                    value,
                    maxUses,
                    expiryDays,
                    createdBy,
                    planId,
                    `Bulk generated ${type} code`
                );

                promoCodes.push(promoCode);
            } catch (error) {
                Logger.warn('PROMO', `Failed to create bulk promo code ${code}`, error);
            }
        }

        Logger.info('PROMO', `Bulk created ${promoCodes.length}/${count} promo codes`);
        return promoCodes;
    }
}