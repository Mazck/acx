// src/scripts/commands/createpromo.ts - Enhanced admin command for creating promo codes
import { Command, MessageContext } from '../../types/interfaces';
import { PromoCodeManager } from '../../integrations/PromoCodeManager';
import { Utils } from '../../utils/Utils';
import { Logger } from '../../utils/Logger';

const createPromoCommand: Command = {
    config: {
        name: 'createpromo',
        aliases: ['newpromo', 'addpromo', 'makepromo'],
        description: 'Create new promo codes with advanced options (Bot Admin only)',
        usage: 'createpromo <type> <value> <max_uses> <expires_days> [plan_id] [description]',
        category: 'admin',
        role: 2, // Bot admin only
        cooldown: 5,
        version: '2.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ args, message, userData }: MessageContext) => {
        const promoManager = (global as any).bot.promoCodeManager as PromoCodeManager;

        if (!promoManager) {
            return await message.reply('❌ Promo code system is not available.');
        }

        if (args.length < 4) {
            return await showCreatePromoHelp(message);
        }

        const type = args[0].toLowerCase() as 'discount' | 'free_activation' | 'extend_days';
        const value = parseInt(args[1]);
        const maxUses = parseInt(args[2]);
        const expiryDays = parseInt(args[3]);
        const planId = args[4] || undefined;
        const description = args.slice(5).join(' ') || generateDefaultDescription(type, value);

        try {
            // Validation
            const validation = validatePromoCreation(type, value, maxUses, expiryDays);
            if (!validation.isValid) {
                return await message.reply(`❌ **Validation Error**\n\n${validation.error}`);
            }

            // Generate unique promo code
            const promoCode = generateUniquePromoCode(type);

            const createdPromo = await promoManager.createPromoCode(
                promoCode,
                type,
                value,
                maxUses,
                expiryDays,
                userData.name,
                planId,
                description
            );

            let successMessage = `✅ **PROMO CODE CREATED SUCCESSFULLY!**\n\n`;
            successMessage += `🎫 **Code:** \`${createdPromo.code}\`\n`;
            successMessage += `📝 **Type:** ${formatPromoType(type)}\n`;
            successMessage += `💎 **Value:** ${formatPromoValue(type, value)}\n`;
            successMessage += `🔢 **Max Uses:** ${maxUses.toLocaleString()}\n`;
            successMessage += `⏰ **Expires:** ${createdPromo.expiryDate.toLocaleDateString()}\n`;

            if (planId) {
                successMessage += `📦 **Restricted to:** ${planId} plan only\n`;
            } else {
                successMessage += `📦 **Applies to:** All plans\n`;
            }

            successMessage += `📄 **Description:** ${description}\n`;
            successMessage += `👤 **Created by:** ${userData.name}\n\n`;
            successMessage += `📋 **Usage Instructions:**\n`;
            successMessage += `• Users can redeem: \`!redeem ${createdPromo.code}\`\n`;
            successMessage += `• Check usage: \`!promos ${createdPromo.code}\`\n`;
            successMessage += `• Deactivate: \`!deactivatepromo ${createdPromo.code}\``;

            await message.reply(successMessage);

            Logger.success('ADMIN_PROMO', `Promo code created: ${createdPromo.code}`, {
                type,
                value,
                maxUses,
                createdBy: userData.name
            });

        } catch (error: any) {
            Logger.error('ADMIN_PROMO', 'Error creating promo code', error);
            await message.reply(`❌ **Error Creating Promo Code**\n\n${error.message}`);
        }
    }
};

async function showCreatePromoHelp(message: any): Promise<void> {
    const helpMessage = `📋 **CREATE PROMO CODE HELP**\n\n` +
        `**Syntax:**\n` +
        `\`!createpromo <type> <value> <max_uses> <expires_days> [plan_id] [description]\`\n\n` +
        `**Types & Values:**\n` +
        `• \`discount\` - Percentage off (1-100)\n` +
        `• \`free_activation\` - Free plan activation (value ignored)\n` +
        `• \`extend_days\` - Bonus days added (1-365)\n\n` +
        `**Parameters:**\n` +
        `• \`max_uses\` - How many times code can be used (1-10000)\n` +
        `• \`expires_days\` - Days until expiration (1-365)\n` +
        `• \`plan_id\` - Restrict to specific plan (optional)\n` +
        `• \`description\` - Custom description (optional)\n\n` +
        `**Examples:**\n` +
        `\`!createpromo discount 50 100 30\`\n` +
        `↳ 50% off, 100 uses, expires in 30 days\n\n` +
        `\`!createpromo free_activation 0 50 7 basic "New user gift"\`\n` +
        `↳ Free basic plan, 50 uses, expires in 7 days\n\n` +
        `\`!createpromo extend_days 14 25 60 premium "Loyalty bonus"\`\n` +
        `↳ 14 bonus days for premium, 25 uses, expires in 60 days`;

    await message.reply(helpMessage);
}

function validatePromoCreation(
    type: string,
    value: number,
    maxUses: number,
    expiryDays: number
): { isValid: boolean; error?: string } {
    if (!['discount', 'free_activation', 'extend_days'].includes(type)) {
        return {
            isValid: false,
            error: 'Invalid type. Use: discount, free_activation, or extend_days'
        };
    }

    if (type === 'discount' && (value <= 0 || value > 100)) {
        return {
            isValid: false,
            error: 'Discount value must be between 1-100%'
        };
    }

    if (type === 'extend_days' && (value <= 0 || value > 365)) {
        return {
            isValid: false,
            error: 'Extend days must be between 1-365 days'
        };
    }

    if (isNaN(value) || isNaN(maxUses) || isNaN(expiryDays)) {
        return {
            isValid: false,
            error: 'Value, max_uses, and expires_days must be numbers'
        };
    }

    if (maxUses <= 0 || maxUses > 10000) {
        return {
            isValid: false,
            error: 'Max uses must be between 1-10000'
        };
    }

    if (expiryDays <= 0 || expiryDays > 365) {
        return {
            isValid: false,
            error: 'Expiry days must be between 1-365'
        };
    }

    return { isValid: true };
}

function generateUniquePromoCode(type: string): string {
    const prefixes = {
        discount: 'SAVE',
        free_activation: 'FREE',
        extend_days: 'BONUS'
    };

    const prefix = prefixes[type as keyof typeof prefixes] || 'PROMO';
    const timestamp = Date.now().toString().slice(-6);
    const random = PromoCodeManager.generateRandomCode(4);

    return `${prefix}${timestamp}${random}`;
}

function formatPromoType(type: string): string {
    const types = {
        discount: '💰 Discount',
        free_activation: '🆓 Free Activation',
        extend_days: '🎁 Bonus Days'
    };

    return types[type as keyof typeof types] || type;
}

function formatPromoValue(type: string, value: number): string {
    switch (type) {
        case 'discount':
            return `${value}% OFF`;
        case 'free_activation':
            return 'Complete subscription for FREE';
        case 'extend_days':
            return `+${value} bonus days`;
        default:
            return value.toString();
    }
}

function generateDefaultDescription(type: string, value: number): string {
    switch (type) {
        case 'discount':
            return `${value}% discount on subscription plans`;
        case 'free_activation':
            return 'Free subscription plan activation';
        case 'extend_days':
            return `${value} bonus days added to subscription`;
        default:
            return 'Special promo code';
    }
}

export default createPromoCommand;

// src/scripts/commands/bulkpromo.ts - Bulk create promo codes
const bulkPromoCommand: Command = {
    config: {
        name: 'bulkpromo',
        aliases: ['bulkcreate', 'masspromos'],
        description: 'Create multiple promo codes at once (Bot Admin only)',
        usage: 'bulkpromo <type> <value> <count> <max_uses_each> <expires_days> [plan_id] [prefix]',
        category: 'admin',
        role: 2,
        cooldown: 30, // Higher cooldown for bulk operations
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ args, message, userData }: MessageContext) => {
        const promoManager = (global as any).bot.promoCodeManager as PromoCodeManager;

        if (!promoManager) {
            return await message.reply('❌ Promo code system is not available.');
        }

        if (args.length < 5) {
            return await showBulkPromoHelp(message);
        }

        const type = args[0].toLowerCase() as 'discount' | 'free_activation' | 'extend_days';
        const value = parseInt(args[1]);
        const count = parseInt(args[2]);
        const maxUsesEach = parseInt(args[3]);
        const expiryDays = parseInt(args[4]);
        const planId = args[5] || undefined;
        const prefix = args[6] || undefined;

        // Validation
        if (count <= 0 || count > 100) {
            return await message.reply('❌ Count must be between 1-100 for safety reasons.');
        }

        if (!['discount', 'free_activation', 'extend_days'].includes(type)) {
            return await message.reply('❌ Invalid type. Use: discount, free_activation, or extend_days');
        }

        try {
            await message.reply(`⏳ Creating ${count} promo codes... This may take a moment.`);

            const createdPromoCodes = await promoManager.bulkCreatePromoCodes(
                type,
                value,
                count,
                maxUsesEach,
                expiryDays,
                userData.name,
                planId,
                prefix
            );

            if (createdPromoCodes.length === 0) {
                return await message.reply('❌ Failed to create any promo codes.');
            }

            let resultMessage = `✅ **BULK PROMO CREATION COMPLETED**\n\n`;
            resultMessage += `📊 **Summary:**\n`;
            resultMessage += `• Successfully created: ${createdPromoCodes.length}/${count}\n`;
            resultMessage += `• Type: ${formatPromoType(type)}\n`;
            resultMessage += `• Value: ${formatPromoValue(type, value)}\n`;
            resultMessage += `• Uses each: ${maxUsesEach}\n`;
            resultMessage += `• Expires: ${expiryDays} days\n`;

            if (planId) {
                resultMessage += `• Plan restriction: ${planId}\n`;
            }

            resultMessage += `\n🎫 **Generated Codes:**\n`;

            // Show first 10 codes
            const codesToShow = createdPromoCodes.slice(0, 10);
            for (const promo of codesToShow) {
                resultMessage += `• \`${promo.code}\`\n`;
            }

            if (createdPromoCodes.length > 10) {
                resultMessage += `• ... and ${createdPromoCodes.length - 10} more\n`;
            }

            resultMessage += `\n💾 **Export codes:** Use \`!exportpromos\` to get all codes in a file`;

            await message.reply(resultMessage);

            Logger.success('BULK_PROMO', `Created ${createdPromoCodes.length} promo codes`, {
                type,
                value,
                count: createdPromoCodes.length,
                createdBy: userData.name
            });

        } catch (error: any) {
            Logger.error('BULK_PROMO', 'Error in bulk promo creation', error);
            await message.reply(`❌ **Error Creating Bulk Promo Codes**\n\n${error.message}`);
        }
    }
};

async function showBulkPromoHelp(message: any): Promise<void> {
    const helpMessage = `📦 **BULK PROMO CODE CREATION**\n\n` +
        `**Syntax:**\n` +
        `\`!bulkpromo <type> <value> <count> <max_uses_each> <expires_days> [plan_id] [prefix]\`\n\n` +
        `**Parameters:**\n` +
        `• \`type\` - discount, free_activation, extend_days\n` +
        `• \`value\` - Depends on type (%, days, etc.)\n` +
        `• \`count\` - How many codes to create (1-100)\n` +
        `• \`max_uses_each\` - Uses per individual code\n` +
        `• \`expires_days\` - Days until expiration\n` +
        `• \`plan_id\` - Restrict to plan (optional)\n` +
        `• \`prefix\` - Custom prefix for codes (optional)\n\n` +
        `**Examples:**\n` +
        `\`!bulkpromo discount 25 50 5 30\`\n` +
        `↳ Create 50 codes, each 25% off, 5 uses each, 30 days expiry\n\n` +
        `\`!bulkpromo free_activation 0 20 1 7 basic WELCOME\`\n` +
        `↳ Create 20 free basic activation codes, 1 use each, 7 days expiry\n\n` +
        `⚠️ **Limits:** Max 100 codes per command for performance`;

    await message.reply(helpMessage);
}

export { bulkPromoCommand };

// src/scripts/commands/promos.ts - Enhanced promo listing
const promosCommand: Command = {
    config: {
        name: 'promos',
        aliases: ['promocodes', 'listpromos', 'promocodelist'],
        description: 'List and manage all promo codes with advanced filtering (Bot Admin only)',
        usage: 'promos [filter] [search_term]',
        category: 'admin',
        role: 2,
        cooldown: 5,
        version: '2.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ args, message }: MessageContext) => {
        const promoManager = (global as any).bot.promoCodeManager as PromoCodeManager;

        if (!promoManager) {
            return await message.reply('❌ Promo code system is not available.');
        }

        const filter = args[0]?.toLowerCase() || 'active';
        const searchTerm = args[1]?.toLowerCase();

        try {
            const allPromos = await promoManager.getAllPromoCodes();
            const now = new Date();

            let filteredPromos = allPromos;

            // Apply filters
            switch (filter) {
                case 'active':
                    filteredPromos = allPromos.filter(p => p.isActive && p.expiryDate > now && p.currentUses < p.maxUses);
                    break;
                case 'expired':
                    filteredPromos = allPromos.filter(p => !p.isActive || p.expiryDate <= now);
                    break;
                case 'exhausted':
                    filteredPromos = allPromos.filter(p => p.currentUses >= p.maxUses);
                    break;
                case 'all':
                    // Show all
                    break;
                case 'unused':
                    filteredPromos = allPromos.filter(p => p.currentUses === 0);
                    break;
                case 'popular':
                    filteredPromos = allPromos.filter(p => p.currentUses > p.maxUses * 0.5);
                    break;
                default:
                    return await message.reply(`❌ Invalid filter. Use: active, expired, exhausted, all, unused, popular`);
            }

            // Apply search term
            if (searchTerm) {
                filteredPromos = filteredPromos.filter(p =>
                    p.code.toLowerCase().includes(searchTerm) ||
                    p.description.toLowerCase().includes(searchTerm) ||
                    p.type.toLowerCase().includes(searchTerm) ||
                    (p.planId && p.planId.toLowerCase().includes(searchTerm))
                );
            }

            if (filteredPromos.length === 0) {
                return await message.reply(`📋 **No ${filter} promo codes found**${searchTerm ? ` matching "${searchTerm}"` : ''}`);
            }

            // Sort by creation date (newest first)
            filteredPromos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

            let promosList = `📋 **${filter.toUpperCase()} PROMO CODES** (${filteredPromos.length})\n`;
            if (searchTerm) {
                promosList += `🔍 **Search:** "${searchTerm}"\n`;
            }
            promosList += `\n`;

            // Display codes with pagination
            const itemsPerPage = 15;
            const totalPages = Math.ceil(filteredPromos.length / itemsPerPage);
            const currentPage = 1; // Could be enhanced with page navigation

            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const pagePromos = filteredPromos.slice(startIndex, endIndex);

            for (const promo of pagePromos) {
                const status = getPromoStatus(promo, now);
                const usagePercent = Math.round((promo.currentUses / promo.maxUses) * 100);

                promosList += `${status.emoji} **${promo.code}**\n`;
                promosList += `┣ 📝 ${formatPromoType(promo.type)} (${formatPromoValue(promo.type, promo.value)})\n`;
                promosList += `┣ 🎯 Usage: ${promo.currentUses.toLocaleString()}/${promo.maxUses.toLocaleString()} (${usagePercent}%)\n`;
                promosList += `┣ ⏰ ${status.timeInfo}\n`;

                if (promo.planId) {
                    promosList += `┣ 📦 Plan: ${promo.planId}\n`;
                }

                promosList += `┗ 👤 By: ${promo.createdBy} • ${promo.createdAt.toLocaleDateString()}\n\n`;
            }

            if (totalPages > 1) {
                promosList += `📄 **Page ${currentPage} of ${totalPages}** • Showing ${pagePromos.length} of ${filteredPromos.length} codes\n\n`;
            }

            // Add statistics
            const stats = await promoManager.getPromoCodeStats();
            promosList += `📊 **GLOBAL STATISTICS**\n`;
            promosList += `• Total Codes: ${stats.totalCodes}\n`;
            promosList += `• Active Codes: ${stats.activeCodes}\n`;
            promosList += `• Total Uses: ${stats.totalUses.toLocaleString()}\n`;
            promosList += `• Total Savings: ${Utils.formatNumber(stats.totalSavings)}đ\n\n`;

            promosList += `💡 **Filters:** active, expired, exhausted, all, unused, popular\n`;
            promosList += `🔍 **Search:** \`!promos <filter> <search_term>\``;

            await message.reply(promosList);

        } catch (error: any) {
            Logger.error('PROMO_LIST', 'Error fetching promo codes', error);
            await message.reply(`❌ **Error Loading Promo Codes**\n\n${error.message}`);
        }
    }
};

function getPromoStatus(promo: any, now: Date): { emoji: string; timeInfo: string } {
    if (!promo.isActive) {
        return { emoji: '⚫', timeInfo: 'Deactivated' };
    }

    if (now > promo.expiryDate) {
        return { emoji: '🔴', timeInfo: `Expired ${Utils.getTimeAgo(promo.expiryDate.getTime())}` };
    }

    if (promo.currentUses >= promo.maxUses) {
        return { emoji: '🟠', timeInfo: 'Usage limit reached' };
    }

    const daysLeft = Math.ceil((promo.expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 3) {
        return { emoji: '🟡', timeInfo: `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` };
    }

    return { emoji: '🟢', timeInfo: `Expires: ${promo.expiryDate.toLocaleDateString()}` };
}

export { promosCommand };