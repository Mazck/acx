// src/scripts/commands/redeem.ts - Enhanced version with SQL integration
import { Command, MessageContext } from '../../types/interfaces';
import { PromoCodeManager } from '../../integrations/PromoCodeManager';
import { PayOSManager } from '../../integrations/PayOSManager';
import { Utils } from '../../utils/Utils';
import { Logger } from '../../utils/Logger';

const redeemCommand: Command = {
    config: {
        name: 'redeem',
        aliases: ['promo', 'code', 'coupon', 'promocode'],
        description: 'Redeem a promo code for discounts or free activation',
        usage: 'redeem <promo_code> [plan_id]',
        category: 'subscription',
        role: 1, // Group admin only
        cooldown: 10,
        version: '2.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ api, args, message, event, userData, threadData, prefix }: MessageContext) => {
        const payosManager = (global as any).bot.getPayOSManager() as PayOSManager;
        const promoManager = (global as any).bot.promoCodeManager as PromoCodeManager;

        if (!payosManager || !promoManager) {
            return await message.reply(
                '❌ **Promo code system is not available**\n\n' +
                'Please contact an administrator.'
            );
        }

        // Show help if no arguments provided
        if (args.length === 0) {
            return await showRedeemHelp(message, prefix, threadData.threadID, promoManager);
        }

        const promoCode = args[0].toUpperCase();
        const specifiedPlanId = args[1]?.toLowerCase();
        const threadID = event.threadID;
        const userID = userData.userID;

        Logger.info('REDEEM', `Redeem attempt: ${promoCode} by ${userData.name} (${userID}) in thread ${threadID}`);

        try {
            // Validate promo code format
            const formatValidation = PromoCodeManager.validatePromoCodeFormat(promoCode);
            if (!formatValidation.isValid) {
                return await message.reply(
                    `❌ **Invalid Promo Code Format**\n\n` +
                    `❗ **Error:** ${formatValidation.error}\n\n` +
                    `💡 **Valid format:** 4-20 characters, letters and numbers only`
                );
            }

            // Get current subscription to determine target plan
            const existingSubscription = await payosManager.getThreadSubscription(threadID);
            let targetPlanId = specifiedPlanId || 'basic'; // Default plan

            if (existingSubscription && !specifiedPlanId) {
                // Use current plan for renewal if no plan specified
                targetPlanId = existingSubscription.planId;
            }

            // Get plan details
            const plan = payosManager.getPlan(targetPlanId);
            if (!plan) {
                const availablePlans = payosManager.getSubscriptionPlans()
                    .map(p => p.id)
                    .join(', ');

                return await message.reply(
                    `❌ **Invalid Plan: ${targetPlanId}**\n\n` +
                    `📦 **Available plans:** ${availablePlans}\n\n` +
                    `💡 Use \`${prefix}subscribe\` to see plan details`
                );
            }

            // Validate and apply promo code
            const validation = await promoManager.validateAndApplyPromoCode(
                promoCode, threadID, userID, targetPlanId, plan.price
            );

            if (!validation.isValid) {
                return await handleInvalidPromo(message, promoCode, validation.error, prefix, threadID, promoManager);
            }

            const promoDetails = validation.promoCode!;

            // Log successful validation
            Logger.info('REDEEM', `Valid promo code: ${promoCode}`, {
                type: promoDetails.type,
                value: promoDetails.value,
                threadID,
                userID
            });

            // Handle different promo types
            switch (promoDetails.type) {
                case 'free_activation':
                    return await handleFreeActivation(
                        message, payosManager, promoManager, threadID, targetPlanId,
                        userID, plan, promoCode, validation, promoDetails
                    );

                case 'discount':
                case 'extend_days':
                    return await handleDiscountOrExtendDays(
                        message, payosManager, promoManager, threadID, targetPlanId,
                        userID, plan, promoCode, validation, promoDetails
                    );

                default:
                    return await message.reply(
                        `❌ **Unknown Promo Type**\n\n` +
                        `The promo code type "${promoDetails.type}" is not supported.`
                    );
            }

        } catch (error: any) {
            Logger.error('REDEEM', 'Error processing redeem command', {
                error: error.message,
                promoCode,
                threadID,
                userID
            });

            if (error.message === 'FREE_ACTIVATED') {
                return; // Free activation message already sent
            }

            return await message.reply(
                `❌ **Error Redeeming Promo Code**\n\n` +
                `An unexpected error occurred. Please try again later.\n\n` +
                `If the problem persists, contact support with code: \`${promoCode}\``
            );
        }
    }
};

// Show comprehensive redeem help
async function showRedeemHelp(
    message: any,
    prefix: string,
    threadID: string,
    promoManager: PromoCodeManager
): Promise<void> {
    let helpMessage = `🎫 **PROMO CODE REDEMPTION**\n\n`;

    helpMessage += `💡 **Usage:**\n`;
    helpMessage += `• \`${prefix}redeem <promo_code>\` - Apply to current/default plan\n`;
    helpMessage += `• \`${prefix}redeem <promo_code> <plan_id>\` - Apply to specific plan\n\n`;

    helpMessage += `📋 **Examples:**\n`;
    helpMessage += `• \`${prefix}redeem WELCOME2024\` - Apply to current subscription\n`;
    helpMessage += `• \`${prefix}redeem DISCOUNT50 premium\` - Apply to premium plan\n`;
    helpMessage += `• \`${prefix}redeem FREEVIP vip\` - Free VIP activation\n\n`;

    helpMessage += `🎁 **Promo Code Types:**\n`;
    helpMessage += `• **Discount** - Percentage off subscription price\n`;
    helpMessage += `• **Free Activation** - Completely free plan activation\n`;
    helpMessage += `• **Bonus Days** - Extra days added to subscription\n\n`;

    // Show available promo suggestions
    try {
        const suggestions = await promoManager.getPromoSuggestions(threadID);
        if (suggestions.length > 0) {
            helpMessage += `✨ **Available For You:**\n`;
            for (const promo of suggestions.slice(0, 3)) {
                helpMessage += `• \`${promo.code}\` - ${promo.description}`;
                if (promo.type === 'discount') {
                    helpMessage += ` (${promo.value}% OFF)`;
                } else if (promo.type === 'extend_days') {
                    helpMessage += ` (+${promo.value} days)`;
                }
                helpMessage += `\n`;
            }
            helpMessage += `\n`;
        }
    } catch (error) {
        Logger.warn('REDEEM', 'Could not load promo suggestions', error);
    }

    helpMessage += `🔍 **Get Promo Codes From:**\n`;
    helpMessage += `• Official announcements\n`;
    helpMessage += `• Special events and contests\n`;
    helpMessage += `• Community rewards\n`;
    helpMessage += `• Referral programs\n\n`;

    helpMessage += `❓ **Need Help?** Use \`${prefix}subscribe\` to see available plans`;

    await message.reply(helpMessage);
}

// Handle invalid promo code with suggestions
async function handleInvalidPromo(
    message: any,
    promoCode: string,
    error: string | undefined,
    prefix: string,
    threadID: string,
    promoManager: PromoCodeManager
): Promise<void> {
    let errorMessage = `❌ **Promo Code Invalid**\n\n`;
    errorMessage += `🎫 **Code:** ${promoCode}\n`;
    errorMessage += `❗ **Error:** ${error}\n\n`;

    // Provide specific help based on error type
    if (error?.includes('expired')) {
        errorMessage += `⏰ **Tip:** This code has expired. Check for newer codes in announcements.`;
    } else if (error?.includes('already used')) {
        errorMessage += `💡 **Tip:** Each code can only be used once per group.`;
    } else if (error?.includes('usage limit')) {
        errorMessage += `🚫 **Tip:** This code has reached its maximum usage limit.`;
    } else if (error?.includes('deactivated')) {
        errorMessage += `⚠️ **Tip:** This code has been deactivated by administrators.`;
    } else if (error?.includes('Invalid promo code')) {
        errorMessage += `🔍 **Tip:** Double-check the spelling. Codes are case-insensitive.`;

        // Try to suggest similar codes
        try {
            const suggestions = await promoManager.getPromoSuggestions(threadID);
            if (suggestions.length > 0) {
                errorMessage += `\n\n✨ **Try these codes instead:**\n`;
                for (const suggestion of suggestions.slice(0, 2)) {
                    errorMessage += `• \`${prefix}redeem ${suggestion.code}\` - ${suggestion.description}\n`;
                }
            }
        } catch (suggestionError) {
            Logger.warn('REDEEM', 'Could not load suggestions for invalid promo', suggestionError);
        }
    }

    errorMessage += `\n\n💡 Use \`${prefix}redeem\` to see help and available codes.`;

    await message.reply(errorMessage);
}

// Handle free activation promo codes
async function handleFreeActivation(
    message: any,
    payosManager: PayOSManager,
    promoManager: PromoCodeManager,
    threadID: string,
    planId: string,
    userID: string,
    plan: any,
    promoCode: string,
    validation: any,
    promoDetails: any
): Promise<void> {
    try {
        const bonusDays = validation.freeDays || 0;

        // Activate subscription with free activation
        await payosManager.activateSubscription(
            threadID, planId, userID, 0, false, bonusDays, promoCode
        );

        // Mark promo code as used
        await promoManager.markPromoCodeUsed(promoCode, threadID, userID, plan.price, 0);

        // Calculate total days
        const totalDays = plan.days + bonusDays;
        const expiryDate = new Date(Date.now() + (totalDays * 24 * 60 * 60 * 1000));

        const successMessage = `🎉 **FREE ACTIVATION SUCCESS!**\n\n` +
            `✅ **${plan.name}** activated for FREE!\n` +
            `⏰ **Duration:** ${plan.days}${bonusDays ? ` + ${bonusDays} bonus` : ''} days\n` +
            `📅 **Expires:** ${expiryDate.toLocaleDateString()}\n` +
            `🎫 **Promo Code:** ${promoCode}\n` +
            `💰 **Value:** ${Utils.formatNumber(plan.price)}đ (100% OFF!)\n\n` +
            `🤖 **All bot features are now unlocked!**\n\n` +
            `🎯 **What you can do now:**\n` +
            `• Use all bot commands without restrictions\n` +
            `• Access premium AI features\n` +
            `• Enjoy full economy system\n` +
            `• Get priority support\n\n` +
            `💡 **Quick start:** Use \`!help\` to explore all commands`;

        await message.reply(successMessage);

        Logger.success('REDEEM', `Free activation completed`, {
            promoCode,
            threadID,
            planId,
            totalDays,
            value: plan.price
        });

    } catch (error) {
        Logger.error('REDEEM', 'Error in free activation', error);
        throw error;
    }
}

// Handle discount or extend days promo codes
async function handleDiscountOrExtendDays(
    message: any,
    payosManager: PayOSManager,
    promoManager: PromoCodeManager,
    threadID: string,
    planId: string,
    userID: string,
    plan: any,
    promoCode: string,
    validation: any,
    promoDetails: any
): Promise<void> {
    try {
        // Create payment with promo discount
        const paymentResult = await payosManager.createSubscriptionPayment(
            threadID, planId, userID, promoCode
        );

        let redeemMessage = `🎉 **PROMO CODE APPLIED SUCCESSFULLY!**\n\n`;
        redeemMessage += `🎫 **Code:** ${promoCode}\n`;
        redeemMessage += `📦 **Plan:** ${plan.name}\n`;
        redeemMessage += `⏰ **Duration:** ${plan.days} days\n`;

        // Show discount information
        if (validation.discountedPrice !== undefined && validation.discountAmount) {
            const discountPercent = Math.round((validation.discountAmount / plan.price) * 100);
            redeemMessage += `\n💰 **Original Price:** ${Utils.formatNumber(plan.price)}đ\n`;
            redeemMessage += `🎉 **Your Price:** ${Utils.formatNumber(validation.discountedPrice)}đ\n`;
            redeemMessage += `💸 **You Save:** ${Utils.formatNumber(validation.discountAmount)}đ (${discountPercent}% OFF)\n`;
        }

        // Show bonus days information
        if (validation.freeDays) {
            redeemMessage += `🎁 **Bonus Days:** +${validation.freeDays} days FREE\n`;
            redeemMessage += `⏰ **Total Duration:** ${plan.days + validation.freeDays} days\n`;
        }

        redeemMessage += `\n🔗 **Payment Link:** ${paymentResult.checkoutUrl}\n\n`;
        redeemMessage += `📱 **Order Code:** ${paymentResult.orderCode}\n`;
        redeemMessage += `⚡ **Auto-activation** after successful payment\n`;
        redeemMessage += `⏰ **Payment expires in 15 minutes**\n\n`;
        redeemMessage += `💳 **Safe & Secure:** Your payment is protected by PayOS`;

        await message.reply(redeemMessage);

        Logger.success('REDEEM', `Payment created with promo`, {
            promoCode,
            threadID,
            orderCode: paymentResult.orderCode,
            originalPrice: plan.price,
            finalPrice: paymentResult.amount,
            discount: validation.discountAmount || 0,
            bonusDays: validation.freeDays || 0
        });

    } catch (error) {
        Logger.error('REDEEM', 'Error in discount/extend days redemption', error);
        throw error;
    }
}

export default redeemCommand;