// src/scripts/commands/redeem.ts
import { Command, MessageContext } from '../../types/interfaces';
import { PromoCodeManager } from '../../integrations/PromoCodeManager';
import { Utils } from '../../utils/Utils';

const redeemCommand: Command = {
    config: {
        name: 'redeem',
        aliases: ['promo', 'code', 'coupon'],
        description: 'Redeem a promo code for discounts or free activation',
        usage: 'redeem <promo_code> [plan_id]',
        category: 'subscription',
        role: 1, // Group admin only
        cooldown: 10,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ api, args, message, event, userData }: MessageContext) => {
        const payosManager = (global as any).bot.payosManager;
        const promoManager = (global as any).bot.payosManager?.getPromoCodeManager() as PromoCodeManager;

        if (!payosManager || !promoManager) {
            return await message.reply('❌ Promo code system is not available.');
        }

        if (args.length === 0) {
            return await message.reply(
                '❌ **Missing promo code**\n\n' +
                '💡 **Usage:** `!redeem <promo_code> [plan_id]`\n\n' +
                '**Examples:**\n' +
                '• `!redeem WELCOME2024` - Apply to current subscription\n' +
                '• `!redeem DISCOUNT50 premium` - Apply to premium plan\n\n' +
                '🎁 **Get promo codes from:**\n' +
                '• Official announcements\n' +
                '• Special events\n' +
                '• Community contests'
            );
        }

        const promoCode = args[0].toUpperCase();
        const threadID = event.threadID;
        const userID = userData.userID;

        try {
            // Check current subscription
            const existingSubscription = await payosManager.getThreadSubscription(threadID);
            let targetPlanId = 'basic'; // Default plan

            // If plan specified in command
            if (args.length > 1) {
                targetPlanId = args[1].toLowerCase();
            } else if (existingSubscription) {
                // Use current plan for renewal
                targetPlanId = existingSubscription.planId;
            }

            // Get plan details
            const plan = payosManager.getPlan(targetPlanId);
            if (!plan) {
                return await message.reply(
                    `❌ **Invalid plan: ${targetPlanId}**\n\n` +
                    'Use `!subscribe` to see available plans.'
                );
            }

            // Validate promo code
            const validation = await promoManager.validateAndApplyPromoCode(
                promoCode, threadID, userID, targetPlanId, plan.price
            );

            if (!validation.isValid) {
                let errorMessage = `❌ **Promo Code Invalid**\n\n`;
                errorMessage += `🎫 **Code:** ${promoCode}\n`;
                errorMessage += `❗ **Error:** ${validation.error}\n\n`;

                if (validation.error?.includes('expired')) {
                    errorMessage += `⏰ **Tip:** Check for newer promo codes in announcements`;
                } else if (validation.error?.includes('already used')) {
                    errorMessage += `💡 **Tip:** Each code can only be used once per user/group`;
                } else if (validation.error?.includes('usage limit')) {
                    errorMessage += `🚫 **Tip:** This code has reached its usage limit`;
                }

                return await message.reply(errorMessage);
            }

            const promoDetails = validation.promoCode!;

            // Handle different promo types
            switch (promoDetails.type) {
                case 'free_activation': {
                    // Free activation - no payment needed
                    const bonusDays = validation.freeDays || 0;

                    await payosManager.activateSubscription(
                        threadID, targetPlanId, userID, 0, false, bonusDays, promoCode
                    );

                    await promoManager.markPromoCodeUsed(promoCode, threadID, userID, plan.price, 0);

                    const activationMessage = `🎉 **Free Activation Success!**\n\n` +
                        `✅ **${plan.name}** activated for FREE!\n` +
                        `⏰ **Duration:** ${plan.days}${bonusDays ? ` + ${bonusDays} bonus` : ''} days\n` +
                        `🎫 **Promo Code:** ${promoCode}\n` +
                        `💰 **Value:** ${Utils.formatNumber(plan.price)}đ\n\n` +
                        `🤖 **All bot features are now unlocked!**\n` +
                        `📅 **Expires:** ${new Date(Date.now() + ((plan.days + bonusDays) * 24 * 60 * 60 * 1000)).toLocaleDateString()}\n\n` +
                        `💡 Use \`!help\` to explore all commands`;

                    return await message.reply(activationMessage);
                }

                case 'discount':
                case 'extend_days': {
                    // Create payment with promo discount
                    const paymentResult = await payosManager.createSubscriptionPayment(
                        threadID, targetPlanId, userID, promoCode
                    );

                    let redeemMessage = `🎉 **Promo Code Applied Successfully!**\n\n`;
                    redeemMessage += `🎫 **Code:** ${promoCode}\n`;
                    redeemMessage += `📦 **Plan:** ${plan.name}\n`;

                    if (validation.discountedPrice !== undefined) {
                        redeemMessage += `💰 **Original Price:** ${Utils.formatNumber(plan.price)}đ\n`;
                        redeemMessage += `💰 **Your Price:** ${Utils.formatNumber(validation.discountedPrice)}đ\n`;
                        redeemMessage += `💸 **You Save:** ${Utils.formatNumber(plan.price - validation.discountedPrice)}đ (${promoDetails.value}% OFF)\n`;
                    }

                    if (validation.freeDays) {
                        redeemMessage += `🎁 **Bonus Days:** +${validation.freeDays} days FREE\n`;
                        redeemMessage += `⏰ **Total Duration:** ${plan.days + validation.freeDays} days\n`;
                    }

                    redeemMessage += `\n🔗 **Payment Link:** ${paymentResult.checkoutUrl}\n\n`;
                    redeemMessage += `📱 **Order Code:** ${paymentResult.orderCode}\n`;
                    redeemMessage += `⚡ **Auto-activation** after successful payment\n`;
                    redeemMessage += `⏰ Payment link expires in 15 minutes`;

                    return await message.reply(redeemMessage);
                }
            }
        } catch (error: any) {
            if (error.message === 'FREE_ACTIVATED') {
                return; // Message already sent by activation
            }

            Logger.error('REDEEM', 'Error redeeming promo code', error);
            return await message.reply(
                `❌ **Error redeeming promo code**\n\n` +
                `Please try again later or contact support.\n` +
                `Error: ${error.message}`
            );
        }
    }
};

export default redeemCommand;

// src/scripts/commands/createpromo.ts
const createPromoCommand: Command = {
    config: {
        name: 'createpromo',
        aliases: ['newpromo', 'addpromo'],
        description: 'Create new promo codes (Bot Admin only)',
        usage: 'createpromo <type> <value> <max_uses> <expires_days> [plan_id] [description]',
        category: 'admin',
        role: 2, // Bot admin only
        cooldown: 5,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ args, message, userData }: MessageContext) => {
        const promoManager = (global as any).bot.payosManager?.getPromoCodeManager() as PromoCodeManager;

        if (!promoManager) {
            return await message.reply('❌ Promo code system is not available.');
        }

        if (args.length < 4) {
            return await message.reply(
                `📋 **Create Promo Code Usage**\n\n` +
                `**Syntax:** \`!createpromo <type> <value> <max_uses> <expires_days> [plan_id] [description]\`\n\n` +
                `**Types:**\n` +
                `• \`discount\` - Percentage discount (value = 1-100)\n` +
                `• \`free_activation\` - Free plan activation (value = ignored)\n` +
                `• \`extend_days\` - Bonus days (value = number of days)\n\n` +
                `**Examples:**\n` +
                `• \`!createpromo discount 50 100 30\` - 50% off, 100 uses, 30 days\n` +
                `• \`!createpromo free_activation 0 50 7 basic "Welcome gift"\`\n` +
                `• \`!createpromo extend_days 14 25 60 premium "Loyalty bonus"\``
            );
        }

        const type = args[0].toLowerCase() as 'discount' | 'free_activation' | 'extend_days';
        const value = parseInt(args[1]);
        const maxUses = parseInt(args[2]);
        const expiryDays = parseInt(args[3]);
        const planId = args[4] || undefined;
        const description = args.slice(5).join(' ') || `${type} promo code`;

        // Validation
        if (!['discount', 'free_activation', 'extend_days'].includes(type)) {
            return await message.reply('❌ Invalid type. Use: discount, free_activation, or extend_days');
        }

        if (isNaN(value) || isNaN(maxUses) || isNaN(expiryDays)) {
            return await message.reply('❌ Value, max_uses, and expires_days must be numbers');
        }

        if (maxUses <= 0 || expiryDays <= 0) {
            return await message.reply('❌ Max uses and expiry days must be positive');
        }

        try {
            // Generate random code
            const promoCode = PromoCodeManager.generateRandomCode();

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

            let successMessage = `✅ **Promo Code Created Successfully!**\n\n`;
            successMessage += `🎫 **Code:** \`${createdPromo.code}\`\n`;
            successMessage += `📝 **Type:** ${type.charAt(0).toUpperCase() + type.slice(1)}\n`;

            if (type === 'discount') {
                successMessage += `💰 **Discount:** ${value}% OFF\n`;
            } else if (type === 'extend_days') {
                successMessage += `🎁 **Bonus Days:** +${value} days\n`;
            } else {
                successMessage += `🆓 **Free Activation:** Yes\n`;
            }

            successMessage += `🔢 **Max Uses:** ${maxUses}\n`;
            successMessage += `⏰ **Expires:** ${createdPromo.expiryDate.toLocaleDateString()}\n`;

            if (planId) {
                successMessage += `📦 **Restricted to:** ${planId} plan\n`;
            }

            successMessage += `📄 **Description:** ${description}\n\n`;
            successMessage += `📋 **Usage:** Users can redeem with \`!redeem ${createdPromo.code}\``;

            await message.reply(successMessage);
        } catch (error: any) {
            await message.reply(`❌ Error creating promo code: ${error.message}`);
        }
    }
};

export { createPromoCommand };

// src/scripts/commands/promos.ts
const promosCommand: Command = {
    config: {
        name: 'promos',
        aliases: ['promocodes', 'listpromos'],
        description: 'List all promo codes and their usage (Bot Admin only)',
        usage: 'promos [active|expired|all]',
        category: 'admin',
        role: 2, // Bot admin only
        cooldown: 5,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ args, message }: MessageContext) => {
        const promoManager = (global as any).bot.payosManager?.getPromoCodeManager() as PromoCodeManager;

        if (!promoManager) {
            return await message.reply('❌ Promo code system is not available.');
        }

        const filter = args[0]?.toLowerCase() || 'active';

        try {
            const allPromos = await promoManager.getAllPromoCodes();
            const now = new Date();

            let filteredPromos = allPromos;

            switch (filter) {
                case 'active':
                    filteredPromos = allPromos.filter(p => p.isActive && p.expiryDate > now);
                    break;
                case 'expired':
                    filteredPromos = allPromos.filter(p => !p.isActive || p.expiryDate <= now);
                    break;
                case 'all':
                    // Show all
                    break;
                default:
                    return await message.reply('❌ Invalid filter. Use: active, expired, or all');
            }

            if (filteredPromos.length === 0) {
                return await message.reply(`📋 **No ${filter} promo codes found**`);
            }

            // Sort by creation date (newest first)
            filteredPromos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

            let promosList = `📋 **${filter.toUpperCase()} PROMO CODES** (${filteredPromos.length})\n\n`;

            for (const promo of filteredPromos.slice(0, 20)) { // Limit to 20 for readability
                const status = promo.isActive && promo.expiryDate > now ? '🟢' : '🔴';
                const usagePercent = Math.round((promo.currentUses / promo.maxUses) * 100);

                promosList += `${status} **${promo.code}**\n`;
                promosList += `┣ 📝 ${promo.type.charAt(0).toUpperCase() + promo.type.slice(1)}`;

                if (promo.type === 'discount') {
                    promosList += ` (${promo.value}% OFF)`;
                } else if (promo.type === 'extend_days') {
                    promosList += ` (+${promo.value} days)`;
                }

                promosList += `\n`;
                promosList += `┣ 🎯 Usage: ${promo.currentUses}/${promo.maxUses} (${usagePercent}%)\n`;
                promosList += `┣ ⏰ Expires: ${promo.expiryDate.toLocaleDateString()}\n`;

                if (promo.planId) {
                    promosList += `┣ 📦 Plan: ${promo.planId}\n`;
                }

                promosList += `┗ 👤 By: ${promo.createdBy}\n\n`;
            }

            if (filteredPromos.length > 20) {
                promosList += `📄 **Showing 20 of ${filteredPromos.length} codes**\n`;
                promosList += `Use \`!promos ${filter}\` to refresh the list`;
            }

            // Add statistics
            const stats = await promoManager.getPromoCodeStats();
            promosList += `\n📊 **STATISTICS**\n`;
            promosList += `• Total Codes: ${stats.totalCodes}\n`;
            promosList += `• Active Codes: ${stats.activeCodes}\n`;
            promosList += `• Total Uses: ${stats.totalUses}\n`;
            promosList += `• Total Savings: ${Utils.formatNumber(stats.totalSavings)}đ`;

            await message.reply(promosList);
        } catch (error: any) {
            await message.reply(`❌ Error fetching promo codes: ${error.message}`);
        }
    }
};

export { promosCommand };

// src/scripts/commands/deactivatepromo.ts
const deactivatePromoCommand: Command = {
    config: {
        name: 'deactivatepromo',
        aliases: ['disablepromo', 'killpromo'],
        description: 'Deactivate a promo code (Bot Admin only)',
        usage: 'deactivatepromo <promo_code>',
        category: 'admin',
        role: 2, // Bot admin only
        cooldown: 5,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ args, message }: MessageContext) => {
        const promoManager = (global as any).bot.payosManager?.getPromoCodeManager() as PromoCodeManager;

        if (!promoManager) {
            return await message.reply('❌ Promo code system is not available.');
        }

        if (args.length === 0) {
            return await message.reply(
                '❌ **Missing promo code**\n\n' +
                '💡 **Usage:** `!deactivatepromo <promo_code>`\n\n' +
                'Use `!promos` to see all active codes.'
            );
        }

        const promoCode = args[0].toUpperCase();

        try {
            const promo = promoManager.getPromoCode(promoCode);

            if (!promo) {
                return await message.reply(`❌ **Promo code "${promoCode}" not found**`);
            }

            if (!promo.isActive) {
                return await message.reply(`⚠️ **Promo code "${promoCode}" is already deactivated**`);
            }

            const success = await promoManager.deactivatePromoCode(promoCode);

            if (success) {
                let deactivateMessage = `✅ **Promo Code Deactivated**\n\n`;
                deactivateMessage += `🎫 **Code:** ${promoCode}\n`;
                deactivateMessage += `📊 **Usage:** ${promo.currentUses}/${promo.maxUses}\n`;
                deactivateMessage += `💰 **Type:** ${promo.type}\n`;
                deactivateMessage += `📅 **Was expiring:** ${promo.expiryDate.toLocaleDateString()}\n\n`;
                deactivateMessage += `🚫 **Code is now disabled and cannot be used**`;

                await message.reply(deactivateMessage);
            } else {
                await message.reply(`❌ **Failed to deactivate promo code "${promoCode}"**`);
            }
        } catch (error: any) {
            await message.reply(`❌ Error deactivating promo code: ${error.message}`);
        }
    }
};

export { deactivatePromoCommand };

// src/scripts/commands/substats.ts  
const subStatsCommand: Command = {
    config: {
        name: 'substats',
        aliases: ['subscription-stats', 'revenue'],
        description: 'View detailed subscription and revenue statistics (Bot Admin only)',
        usage: 'substats',
        category: 'admin',
        role: 2, // Bot admin only
        cooldown: 10,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ message }: MessageContext) => {
        const payosManager = (global as any).bot.payosManager;

        if (!payosManager) {
            return await message.reply('❌ Subscription system is not available.');
        }

        try {
            const stats = await payosManager.getEnhancedSubscriptionStats();

            let statsMessage = `📊 **SUBSCRIPTION STATISTICS**\n\n`;

            // Revenue section
            statsMessage += `💰 **REVENUE**\n`;
            statsMessage += `• Total Revenue: ${Utils.formatNumber(stats.revenue.total)}đ\n`;
            statsMessage += `• This Month: ${Utils.formatNumber(stats.revenue.thisMonth)}đ\n`;
            statsMessage += `• Last Month: ${Utils.formatNumber(stats.revenue.lastMonth)}đ\n`;

            if (stats.revenue.growth >= 0) {
                statsMessage += `• Growth: +${stats.revenue.growth.toFixed(1)}% 📈\n`;
            } else {
                statsMessage += `• Growth: ${stats.revenue.growth.toFixed(1)}% 📉\n`;
            }

            statsMessage += `\n`;

            // Subscriptions section
            statsMessage += `📦 **SUBSCRIPTIONS**\n`;
            statsMessage += `• Total: ${stats.subscriptions.total}\n`;
            statsMessage += `• Active: ${stats.subscriptions.active} 🟢\n`;
            statsMessage += `• Expired: ${stats.subscriptions.expired} 🔴\n`;
            statsMessage += `• Trials: ${stats.subscriptions.trials} 🆓\n\n`;

            // Plan performance
            statsMessage += `🏆 **PLAN PERFORMANCE**\n`;
            for (const [planId, planData] of Object.entries(stats.plans)) {
                if (planData.subscriptions > 0) {
                    statsMessage += `• ${planId}: ${planData.subscriptions} subs`;
                    statsMessage += `, ${Utils.formatNumber(planData.revenue)}đ`;
                    statsMessage += `, avg ${planData.averageLifetime.toFixed(1)} renewals\n`;
                }
            }

            statsMessage += `\n`;

            // Promo codes section
            statsMessage += `🎫 **PROMO CODES**\n`;
            statsMessage += `• Total Uses: ${stats.promoCodes.totalUses}\n`;
            statsMessage += `• Total Savings: ${Utils.formatNumber(stats.promoCodes.totalSavings)}đ\n`;

            if (stats.promoCodes.topCodes.length > 0) {
                statsMessage += `• Top Codes:\n`;
                for (const code of stats.promoCodes.topCodes.slice(0, 3)) {
                    statsMessage += `  - ${code.code}: ${code.uses} uses, ${Utils.formatNumber(code.savings)}đ saved\n`;
                }
            }

            statsMessage += `\n`;

            // Transaction section
            statsMessage += `💳 **TRANSACTIONS**\n`;
            statsMessage += `• Total: ${stats.transactions.total}\n`;
            statsMessage += `• This Month: ${stats.transactions.thisMonth}\n`;
            statsMessage += `• Average Order: ${Utils.formatNumber(stats.transactions.averageOrderValue)}đ\n\n`;

            // Conversion rates
            const conversionRate = stats.subscriptions.total > 0
                ? (stats.subscriptions.active / stats.subscriptions.total * 100).toFixed(1)
                : '0';

            statsMessage += `📈 **KEY METRICS**\n`;
            statsMessage += `• Active Rate: ${conversionRate}%\n`;

            if (stats.subscriptions.trials > 0) {
                const trialConversion = ((stats.subscriptions.total - stats.subscriptions.trials) / stats.subscriptions.trials * 100).toFixed(1);
                statsMessage += `• Trial Conversion: ${trialConversion}%\n`;
            }

            statsMessage += `• Revenue Per Active Sub: ${stats.subscriptions.active > 0
                ? Utils.formatNumber(Math.round(stats.revenue.total / stats.subscriptions.active))
                : '0'}đ`;

            await message.reply(statsMessage);
        } catch (error: any) {
            await message.reply(`❌ Error fetching statistics: ${error.message}`);
        }
    }
};

export { subStatsCommand };

// Enhanced subscribe command with promo code support
// src/scripts/commands/subscribe.ts - Enhanced version
const enhancedSubscribeCommand: Command = {
    config: {
        name: 'subscribe',
        aliases: ['sub', 'plans', 'pricing'],
        description: 'View and purchase subscription plans with promo code support',
        usage: 'subscribe [plan_id] [promo_code]',
        category: 'subscription',
        role: 1, // Group admin only
        cooldown: 10,
        version: '2.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ api, args, message, event, userData, threadData }: MessageContext) => {
        const payosManager = (global as any).bot.payosManager;

        if (!payosManager) {
            return await message.reply('❌ Subscription system is not available.');
        }

        const threadID = event.threadID;

        // Check if no arguments or 'list' - show available plans
        if (args.length === 0 || args[0] === 'list') {
            return await showSubscriptionPlansWithPromoInfo(message, payosManager, threadID);
        }

        const planId = args[0].toLowerCase();
        const promoCode = args[1]; // Optional promo code

        // Handle trial activation
        if (planId === 'trial') {
            return await activateTrialPlan(message, payosManager, threadID, userData.userID);
        }

        // Handle paid plan purchase with optional promo
        return await createSubscriptionPaymentWithPromo(
            message, payosManager, threadID, planId, userData.userID, promoCode
        );
    }
};

async function showSubscriptionPlansWithPromoInfo(message: any, payosManager: any, threadID: string): Promise<void> {
    try {
        const plans = payosManager.getSubscriptionPlans();
        const { canUse, subscription } = await payosManager.canUseBot(threadID);

        let plansList = '💎 **SUBSCRIPTION PLANS** 💎\n\n';

        if (canUse && subscription) {
            const plan = payosManager.getPlan(subscription.planId);
            const daysLeft = Math.ceil((subscription.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

            plansList += `✅ **Current Plan:** ${plan?.name}\n`;
            plansList += `📅 **Days Left:** ${daysLeft} days\n\n`;
            plansList += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        } else {
            plansList += `❌ **No active subscription**\n`;
            plansList += `Choose a plan below to activate the bot:\n\n`;
        }

        for (const plan of plans) {
            const priceText = plan.price === 0 ? 'FREE' : `${Utils.formatNumber(plan.price)}đ`;
            const renewalText = plan.renewalDiscount ? ` (${plan.renewalDiscount}% off renewals)` : '';

            plansList += `📦 **${plan.name}**\n`;
            plansList += `💰 Price: ${priceText}${renewalText}\n`;
            plansList += `⏰ Duration: ${plan.days} days\n`;
            plansList += `📝 ${plan.description}\n`;
            plansList += `✨ Features:\n`;

            for (const feature of plan.features) {
                plansList += `   • ${feature}\n`;
            }

            plansList += `\n🛒 **Commands:**\n`;
            plansList += `   • \`!subscribe ${plan.id}\` - Purchase plan\n`;
            plansList += `   • \`!subscribe ${plan.id} PROMO_CODE\` - With promo code\n`;
            plansList += `   • \`!redeem PROMO_CODE ${plan.id}\` - Redeem promo first\n\n`;
            plansList += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        }

        plansList += `🎫 **PROMO CODES**\n`;
        plansList += `• Use \`!redeem <code>\` to apply promo codes\n`;
        plansList += `• Get codes from announcements & events\n`;
        plansList += `• Codes can provide discounts or free activation\n\n`;
        plansList += `💡 **Need help?** Contact support for assistance.`;

        await message.reply(plansList);
    } catch (error: any) {
        await message.reply(`❌ Error loading subscription plans: ${error.message}`);
    }
}

async function createSubscriptionPaymentWithPromo(
    message: any,
    payosManager: any,
    threadID: string,
    planId: string,
    userID: string,
    promoCode?: string
): Promise<void> {
    try {
        const plan = payosManager.getPlan(planId);

        if (!plan) {
            return await message.reply(
                `❌ Plan "${planId}" not found.\n\n` +
                `Use \`!subscribe list\` to see available plans.`
            );
        }

        // Create payment with optional promo code
        const paymentResult = await payosManager.createSubscriptionPayment(
            threadID, planId, userID, promoCode
        );

        let paymentMessage = `💳 **Payment Created Successfully!**\n\n`;
        paymentMessage += `📦 **Plan:** ${plan.name}\n`;
        paymentMessage += `⏰ **Duration:** ${plan.days} days\n`;

        if (paymentResult.bonusDays) {
            paymentMessage += `🎁 **Bonus Days:** +${paymentResult.bonusDays} days\n`;
            paymentMessage += `⏰ **Total Duration:** ${plan.days + paymentResult.bonusDays} days\n`;
        }

        if (paymentResult.discountAmount && paymentResult.discountAmount > 0) {
            paymentMessage += `💰 **Original Price:** ${Utils.formatNumber(plan.price)}đ\n`;
            paymentMessage += `💰 **Your Price:** ${Utils.formatNumber(paymentResult.amount)}đ\n`;
            paymentMessage += `💸 **You Save:** ${Utils.formatNumber(paymentResult.discountAmount)}đ\n`;

            if (paymentResult.promoApplied) {
                paymentMessage += `🎫 **Promo Applied:** ${paymentResult.promoApplied}\n`;
            }

            paymentMessage += `\n`;
        } else {
            paymentMessage += `💰 **Amount:** ${Utils.formatNumber(paymentResult.amount)}đ\n\n`;
        }

        paymentMessage += `🔗 **Payment Link:** ${paymentResult.checkoutUrl}\n\n`;
        paymentMessage += `📱 **Order Code:** ${paymentResult.orderCode}\n`;
        paymentMessage += `⚡ **Auto-activation** after successful payment\n\n`;
        paymentMessage += `⏰ Payment link expires in 15 minutes`;

        await message.reply(paymentMessage);
    } catch (error: any) {
        if (error.message === 'FREE_ACTIVATED') {
            return; // Free activation message already sent
        }
        await message.reply(`❌ Error creating payment: ${error.message}`);
    }
}

export { enhancedSubscribeCommand };