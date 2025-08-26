import { Command, MessageContext } from '../../types/interfaces';
import { PayOSManager } from '../../integrations/PayOSManager';
import { Utils } from '../../utils/Utils';

const subscriptionChecker = {
    config: {
        name: 'subscriptionChecker',
        description: 'Check subscription before allowing bot usage',
        category: 'events',
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onChat: async ({ event, message, prefix }: any) => {
        // Skip if not a command
        if (!event.body || !event.body.startsWith(prefix)) {
            return;
        }

        const payosManager = (global as any).bot.payosManager as PayOSManager;

        if (!payosManager) {
            return; // Subscription system not enabled
        }

        // Extract command name
        const args = event.body.slice(prefix.length).trim().split(/\s+/);
        const commandName = args[0]?.toLowerCase();

        // Allow subscription-related commands and basic help
        const allowedCommands = ['subscribe', 'sub', 'plans', 'pricing', 'renew', 'renewal', 'extend', 'status', 'subscription', 'help', 'h'];

        if (allowedCommands.includes(commandName)) {
            return;
        }

        // Check subscription status
        const { canUse, reason, subscription } = await payosManager.canUseBot(event.threadID);

        if (!canUse) {
            let blockedMessage = '';

            switch (reason) {
                case 'NO_SUBSCRIPTION':
                    blockedMessage = `🔒 **Bot Access Restricted**\n\n` +
                        `This group needs an active subscription to use bot commands.\n\n` +
                        `🎁 **Start with FREE 7-day trial:**\n` +
                        `Use \`${prefix}subscribe trial\` to activate\n\n` +
                        `💎 **Or choose a paid plan:**\n` +
                        `Use \`${prefix}subscribe\` to see all options`;
                    break;

                case 'SUBSCRIPTION_EXPIRED':
                    const plan = payosManager.getPlan(subscription!.planId);
                    const renewalDiscount = plan?.renewalDiscount || 10;

                    blockedMessage = `⏰ **Subscription Expired**\n\n` +
                        `Your subscription expired on ${subscription!.endDate.toLocaleDateString()}\n\n` +
                        `🎉 **Renew now and save ${renewalDiscount}%!**\n` +
                        `Use \`${prefix}renew\` to get started\n\n` +
                        `💡 **Need different plan?**\n` +
                        `Use \`${prefix}subscribe\` to see all options`;
                    break;

                case 'SUBSCRIPTION_INACTIVE':
                    blockedMessage = `⚠️ **Subscription Inactive**\n\n` +
                        `Your subscription is currently inactive.\n` +
                        `Please contact support or renew your subscription.\n\n` +
                        `🔄 Use \`${prefix}renew\` to reactivate`;
                    break;

                default:
                    blockedMessage = `❌ **Unable to verify subscription**\n\n` +
                        `Please try again later or use \`${prefix}status\` to check your subscription.`;
            }

            return async () => {
                await message.reply(blockedMessage);
            };
        }

        // Check if subscription is expiring soon (3 days)
        if (subscription) {
            const daysLeft = Math.ceil((subscription.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

            if (daysLeft <= 3 && daysLeft > 0) {
                const plan = payosManager.getPlan(subscription.planId);
                const renewalDiscount = plan?.renewalDiscount || 10;

                const reminderMessage = `⚠️ **Subscription Expiring Soon!**\n\n` +
                    `📅 **${daysLeft} day${daysLeft > 1 ? 's' : ''} remaining**\n` +
                    `🎉 **Renew now and save ${renewalDiscount}%!**\n` +
                    `Use \`${prefix}renew\` to extend your subscription`;

                // Send reminder (non-blocking)
                setTimeout(async () => {
                    await message.reply(reminderMessage);
                }, 1000);
            }
        }
    }
};

export default subscriptionChecker;