// src/scripts/events/subscriptionChecker.ts - Enhanced version with SQL integration
import { MessageContext } from '../../types/interfaces';
import { PayOSManager } from '../../integrations/PayOSManager';
import { PromoCodeManager } from '../../integrations/PromoCodeManager';
import { Logger } from '../../utils/Logger';

const subscriptionChecker = {
    config: {
        name: 'subscriptionChecker',
        description: 'Check subscription before allowing bot usage with enhanced promo suggestions',
        category: 'events',
        version: '2.0.0',
        author: 'Uranus Bot Team'
    },

    onChat: async ({ event, message, prefix }: MessageContext) => {
        // Skip if not a command
        if (!event.body || !event.body.startsWith(prefix)) {
            return;
        }

        const payosManager = (global as any).bot.getPayOSManager() as PayOSManager;
        const promoManager = (global as any).bot.promoCodeManager as PromoCodeManager;

        if (!payosManager) {
            return; // Subscription system not enabled
        }

        // Extract command name
        const args = event.body.slice(prefix.length).trim().split(/\s+/);
        const commandName = args[0]?.toLowerCase();

        // Allow subscription-related commands and basic help
        const allowedCommands = [
            'subscribe', 'sub', 'plans', 'pricing',
            'renew', 'renewal', 'extend', 'redeem', 'promo', 'code', 'coupon', 'promocode',
            'status', 'subscription', 'sub-status', 'plan',
            'help', 'h', 'commands', 'cmd',
            'ping', 'pong', 'latency' // Basic system commands
        ];

        if (allowedCommands.includes(commandName)) {
            return;
        }

        // Check subscription status with enhanced logging
        const { canUse, reason, subscription } = await payosManager.canUseBot(event.threadID);

        if (!canUse) {
            Logger.info('SUBSCRIPTION_BLOCK', `Blocked command "${commandName}" for thread ${event.threadID}`, {
                reason,
                subscription: subscription ? {
                    planId: subscription.planId,
                    endDate: subscription.endDate,
                    isActive: subscription.isActive
                } : null
            });

            let blockedMessage = '';

            switch (reason) {
                case 'NO_SUBSCRIPTION':
                    blockedMessage = await buildNoSubscriptionMessage(prefix, promoManager, event.threadID);
                    break;

                case 'SUBSCRIPTION_EXPIRED':
                    blockedMessage = await buildExpiredSubscriptionMessage(prefix, payosManager, promoManager, subscription, event.threadID);
                    break;

                case 'SUBSCRIPTION_INACTIVE':
                    blockedMessage = await buildInactiveSubscriptionMessage(prefix, promoManager, event.threadID);
                    break;

                default:
                    blockedMessage = buildErrorMessage(prefix);
            }

            return async () => {
                await message.reply(blockedMessage);
            };
        }

        // Check if subscription is expiring soon (3 days) and send reminder
        if (subscription) {
            const daysLeft = Math.ceil((subscription.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

            if (daysLeft <= 3 && daysLeft > 0) {
                // Send expiration reminder (non-blocking)
                setTimeout(async () => {
                    try {
                        const reminderMessage = await buildExpiringReminderMessage(
                            prefix, payosManager, promoManager, subscription, daysLeft
                        );
                        await message.reply(reminderMessage);

                        Logger.info('SUBSCRIPTION_REMINDER', `Sent expiry reminder for thread ${event.threadID}`, {
                            daysLeft,
                            planId: subscription.planId
                        });
                    } catch (error) {
                        Logger.error('SUBSCRIPTION_REMINDER', 'Failed to send expiry reminder', error);
                    }
                }, 1000);
            }
        }
    }
};

// Build message for threads with no subscription
async function buildNoSubscriptionMessage(
    prefix: string,
    promoManager: PromoCodeManager | undefined,
    threadID: string
): Promise<string> {
    let message = `🔒 **Bot Access Restricted**\n\n` +
        `This group needs an active subscription to use bot commands.\n\n`;

    // Add promo code suggestions if available
    if (promoManager) {
        try {
            const suggestions = await promoManager.getPromoSuggestions(threadID);
            if (suggestions.length > 0) {
                message += `🎁 **FREE CODES AVAILABLE:**\n`;

                for (const promo of suggestions.slice(0, 2)) {
                    if (promo.type === 'free_activation') {
                        message += `• \`${prefix}redeem ${promo.code}\` - ${promo.description}\n`;
                    } else if (promo.type === 'discount' && promo.value >= 50) {
                        message += `• \`${prefix}redeem ${promo.code}\` - ${promo.value}% OFF any plan\n`;
                    }
                }

                message += `\n`;
            }
        } catch (error) {
            Logger.warn('SUBSCRIPTION_BLOCK', 'Could not load promo suggestions', error);
        }
    }

    message += `🎁 **Start with FREE 7-day trial:**\n` +
        `Use \`${prefix}subscribe trial\` to activate instantly\n\n` +
        `💎 **Or choose a paid plan:**\n` +
        `Use \`${prefix}subscribe\` to see all options with pricing`;

    return message;
}

// Build message for expired subscriptions
async function buildExpiredSubscriptionMessage(
    prefix: string,
    payosManager: PayOSManager,
    promoManager: PromoCodeManager | undefined,
    subscription: any,
    threadID: string
): Promise<string> {
    const plan = payosManager.getPlan(subscription!.planId);
    const renewalDiscount = plan?.renewalDiscount || 10;

    let message = `⏰ **Subscription Expired**\n\n` +
        `Your subscription expired on ${subscription!.endDate.toLocaleDateString()}\n\n`;

    // Add promo code suggestions for expired users
    if (promoManager) {
        try {
            const suggestions = await promoManager.getPromoSuggestions(threadID);
            const renewalPromosExist = suggestions.some(p => p.type === 'discount' && p.value >= 20);

            if (renewalPromosExist) {
                message += `🎫 **SPECIAL COMEBACK OFFERS:**\n`;
                for (const promo of suggestions.slice(0, 2)) {
                    if (promo.type === 'discount' && promo.value >= 20) {
                        message += `• \`${prefix}redeem ${promo.code}\` - ${promo.value}% OFF renewal\n`;
                    }
                }
                message += `\n`;
            }
        } catch (error) {
            Logger.warn('SUBSCRIPTION_BLOCK', 'Could not load renewal promos', error);
        }
    }

    message += `🎉 **Quick Renewal (${renewalDiscount}% OFF):**\n` +
        `Use \`${prefix}renew\` for instant reactivation\n\n` +
        `💡 **Need different plan?**\n` +
        `Use \`${prefix}subscribe\` to see all options`;

    return message;
}

// Build message for inactive subscriptions
async function buildInactiveSubscriptionMessage(
    prefix: string,
    promoManager: PromoCodeManager | undefined,
    threadID: string
): Promise<string> {
    let message = `⚠️ **Subscription Inactive**\n\n` +
        `Your subscription is currently inactive.\n`;

    // Check for reactivation promo codes
    if (promoManager) {
        try {
            const suggestions = await promoManager.getPromoSuggestions(threadID);
            const freeActivationExists = suggestions.some(p => p.type === 'free_activation');

            if (freeActivationExists) {
                message += `\n🆓 **FREE REACTIVATION AVAILABLE:**\n`;
                for (const promo of suggestions.slice(0, 1)) {
                    if (promo.type === 'free_activation') {
                        message += `• \`${prefix}redeem ${promo.code}\` - ${promo.description}\n`;
                    }
                }
                message += `\n`;
            }
        } catch (error) {
            Logger.warn('SUBSCRIPTION_BLOCK', 'Could not load reactivation promos', error);
        }
    }

    message += `🔄 **Reactivation Options:**\n` +
        `• Use \`${prefix}renew\` to reactivate current plan\n` +
        `• Use \`${prefix}subscribe\` to choose a new plan\n` +
        `• Contact support for assistance`;

    return message;
}

// Build generic error message
function buildErrorMessage(prefix: string): string {
    return `❌ **Unable to verify subscription**\n\n` +
        `Please try again later or use \`${prefix}status\` to check your subscription.\n\n` +
        `If the problem persists, contact support.`;
}

// Build expiring subscription reminder
async function buildExpiringReminderMessage(
    prefix: string,
    payosManager: PayOSManager,
    promoManager: PromoCodeManager | undefined,
    subscription: any,
    daysLeft: number
): Promise<string> {
    const plan = payosManager.getPlan(subscription.planId);
    const renewalDiscount = plan?.renewalDiscount || 10;

    let message = `⚠️ **Subscription Expiring Soon!**\n\n` +
        `📅 **${daysLeft} day${daysLeft > 1 ? 's' : ''} remaining**\n` +
        `📦 **Current Plan:** ${plan?.name || subscription.planId}\n\n`;

    // Add special renewal promo codes if available
    if (promoManager) {
        try {
            const suggestions = await promoManager.getPromoSuggestions(subscription.threadID);
            const renewalPromos = suggestions.filter(p => p.type === 'discount' && p.value >= 15);

            if (renewalPromos.length > 0) {
                message += `🎁 **EXCLUSIVE RENEWAL OFFERS:**\n`;
                for (const promo of renewalPromos.slice(0, 2)) {
                    message += `• \`${prefix}redeem ${promo.code}\` - Extra ${promo.value}% OFF\n`;
                }
                message += `\n`;
            }
        } catch (error) {
            Logger.warn('SUBSCRIPTION_REMINDER', 'Could not load renewal promo offers', error);
        }
    }

    message += `🎉 **Renewal Options:**\n` +
        `• \`${prefix}renew\` - Quick renewal with ${renewalDiscount}% discount\n` +
        `• \`${prefix}subscribe\` - Upgrade to a different plan\n\n` +
        `💡 **Why renew early?**\n` +
        `• Keep all your current settings\n` +
        `• Maintain your usage history\n` +
        `• Get loyalty discounts`;

    return message;
}

export default subscriptionChecker;