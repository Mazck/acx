// src/scripts/commands/subscribe.ts
import { Command, MessageContext } from '../../types/interfaces';
import { PayOSManager } from '../../integrations/PayOSManager';
import { Utils } from '../../utils/Utils';

const subscribeCommand: Command = {
    config: {
        name: 'subscribe',
        aliases: ['sub', 'plans', 'pricing'],
        description: 'View and purchase subscription plans for the group',
        usage: 'subscribe [plan_id] or subscribe list',
        category: 'subscription',
        role: 1, // Group admin only
        cooldown: 10,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ api, args, message, event, userData, threadData }: MessageContext) => {
        const payosManager = (global as any).bot.payosManager as PayOSManager;

        if (!payosManager) {
            return await message.reply('❌ Subscription system is not available.');
        }

        const threadID = event.threadID;

        // Check if no arguments or 'list' - show available plans
        if (args.length === 0 || args[0] === 'list') {
            return await showSubscriptionPlans(message, payosManager, threadID);
        }

        const planId = args[0].toLowerCase();

        // Handle trial activation
        if (planId === 'trial') {
            return await activateTrialPlan(message, payosManager, threadID, userData.userID);
        }

        // Handle paid plan purchase
        return await createSubscriptionPayment(message, payosManager, threadID, planId, userData.userID);
    }
};

async function showSubscriptionPlans(message: any, payosManager: PayOSManager, threadID: string): Promise<void> {
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

            plansList += `\n🛒 Command: \`!subscribe ${plan.id}\`\n\n`;
            plansList += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        }

        plansList += `💡 **Need help?** Contact support for assistance.\n`;
        plansList += `🔄 **Existing subscriber?** Use \`!renew\` for renewal discounts!`;

        await message.reply(plansList);
    } catch (error: any) {
        await message.reply(`❌ Error loading subscription plans: ${error.message}`);
    }
}

async function activateTrialPlan(message: any, payosManager: PayOSManager, threadID: string, userID: string): Promise<void> {
    try {
        const existingSubscription = await payosManager.getThreadSubscription(threadID);

        if (existingSubscription) {
            return await message.reply('❌ This group already has a subscription. Trial is only available for new groups.');
        }

        await payosManager.activateSubscription(threadID, 'trial', userID, 0, true);

        await message.reply(
            '🎉 **Trial Activated Successfully!**\n\n' +
            '✅ Your group now has 7 days of free access\n' +
            '🤖 All basic bot features are now available\n' +
            '⏰ Trial expires in 7 days\n\n' +
            '💡 Use `!status` to check remaining time\n' +
            '🛒 Use `!subscribe` to see paid plans before trial ends!'
        );
    } catch (error: any) {
        await message.reply(`❌ Error activating trial: ${error.message}`);
    }
}

async function createSubscriptionPayment(message: any, payosManager: PayOSManager, threadID: string, planId: string, userID: string): Promise<void> {
    try {
        const plan = payosManager.getPlan(planId);

        if (!plan) {
            return await message.reply(
                `❌ Plan "${planId}" not found.\n\n` +
                `Use \`!subscribe list\` to see available plans.`
            );
        }

        const existingSubscription = await payosManager.getThreadSubscription(threadID);
        const isRenewal = !!existingSubscription;

        // Create payment
        const paymentResult = await payosManager.createSubscriptionPayment(threadID, planId, userID);

        let paymentMessage = `💳 **Payment Created Successfully!**\n\n`;
        paymentMessage += `📦 **Plan:** ${plan.name}\n`;
        paymentMessage += `⏰ **Duration:** ${plan.days} days\n`;

        if (isRenewal && plan.renewalDiscount) {
            paymentMessage += `🎉 **Renewal Discount:** ${plan.renewalDiscount}% OFF!\n`;
            paymentMessage += `💰 **Original Price:** ${Utils.formatNumber(plan.price)}đ\n`;
            paymentMessage += `💰 **Your Price:** ${Utils.formatNumber(paymentResult.amount)}đ\n`;
            paymentMessage += `💸 **You Save:** ${Utils.formatNumber(plan.price - paymentResult.amount)}đ\n\n`;
        } else {
            paymentMessage += `💰 **Amount:** ${Utils.formatNumber(paymentResult.amount)}đ\n\n`;
        }

        paymentMessage += `🔗 **Payment Link:** ${paymentResult.checkoutUrl}\n\n`;
        paymentMessage += `📱 **Order Code:** ${paymentResult.orderCode}\n`;
        paymentMessage += `⚡ **Auto-activation** after successful payment\n\n`;
        paymentMessage += `⏰ Payment link expires in 15 minutes`;

        await message.reply(paymentMessage);
    } catch (error: any) {
        if (error.message === 'TRIAL_ACTIVATED') {
            return; // Trial was activated, message already sent
        }
        await message.reply(`❌ Error creating payment: ${error.message}`);
    }
}

export default subscribeCommand;

// src/scripts/commands/renew.ts
const renewCommand: Command = {
    config: {
        name: 'renew',
        aliases: ['renewal', 'extend'],
        description: 'Renew your current subscription with discount',
        usage: 'renew [plan_id]',
        category: 'subscription',
        role: 1, // Group admin only  
        cooldown: 10,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ api, args, message, event, userData }: MessageContext) => {
        const payosManager = (global as any).bot.payosManager as PayOSManager;

        if (!payosManager) {
            return await message.reply('❌ Subscription system is not available.');
        }

        const threadID = event.threadID;
        const existingSubscription = await payosManager.getThreadSubscription(threadID);

        if (!existingSubscription) {
            return await message.reply(
                '❌ **No Existing Subscription**\n\n' +
                'This group doesn\'t have any subscription to renew.\n' +
                'Use `!subscribe` to see available plans.'
            );
        }

        // If no plan specified, renew current plan
        const planId = args.length > 0 ? args[0].toLowerCase() : existingSubscription.planId;
        const plan = payosManager.getPlan(planId);

        if (!plan) {
            return await message.reply(
                `❌ Plan "${planId}" not found.\n\n` +
                `Use \`!subscribe list\` to see available plans.`
            );
        }

        try {
            // Show renewal options
            if (args.length === 0) {
                return await showRenewalOptions(message, payosManager, threadID, existingSubscription);
            }

            // Create renewal payment
            const paymentResult = await payosManager.createSubscriptionPayment(threadID, planId, userData.userID);

            let renewalMessage = `🔄 **Renewal Payment Created!**\n\n`;
            renewalMessage += `📦 **Plan:** ${plan.name}\n`;
            renewalMessage += `⏰ **Extension:** ${plan.days} days\n`;

            if (plan.renewalDiscount) {
                renewalMessage += `🎉 **Renewal Discount:** ${plan.renewalDiscount}% OFF!\n`;
                renewalMessage += `💰 **Original Price:** ${Utils.formatNumber(plan.price)}đ\n`;
                renewalMessage += `💰 **Renewal Price:** ${Utils.formatNumber(paymentResult.amount)}đ\n`;
                renewalMessage += `💸 **You Save:** ${Utils.formatNumber(plan.price - paymentResult.amount)}đ\n\n`;
            } else {
                renewalMessage += `💰 **Amount:** ${Utils.formatNumber(paymentResult.amount)}đ\n\n`;
            }

            renewalMessage += `🔗 **Payment Link:** ${paymentResult.checkoutUrl}\n\n`;
            renewalMessage += `📱 **Order Code:** ${paymentResult.orderCode}\n`;
            renewalMessage += `⚡ **Auto-extension** after successful payment`;

            await message.reply(renewalMessage);
        } catch (error: any) {
            await message.reply(`❌ Error creating renewal: ${error.message}`);
        }
    }
};

async function showRenewalOptions(message: any, payosManager: PayOSManager, threadID: string, subscription: any): Promise<void> {
    const plans = payosManager.getSubscriptionPlans().filter(p => p.price > 0); // Exclude trial
    const currentPlan = payosManager.getPlan(subscription.planId);

    const now = new Date();
    const daysLeft = Math.ceil((subscription.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    let renewalMessage = `🔄 **RENEWAL OPTIONS** 🔄\n\n`;
    renewalMessage += `📦 **Current Plan:** ${currentPlan?.name}\n`;
    renewalMessage += `📅 **Days Remaining:** ${daysLeft} days\n`;
    renewalMessage += `🔄 **Renewals:** ${subscription.renewalCount}\n\n`;
    renewalMessage += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const plan of plans) {
        const discountAmount = plan.renewalDiscount ? Math.floor(plan.price * (plan.renewalDiscount / 100)) : 0;
        const renewalPrice = plan.price - discountAmount;

        renewalMessage += `📦 **${plan.name}**\n`;
        renewalMessage += `⏰ Duration: ${plan.days} days\n`;

        if (plan.renewalDiscount && plan.renewalDiscount > 0) {
            renewalMessage += `💰 Original: ${Utils.formatNumber(plan.price)}đ\n`;
            renewalMessage += `🎉 Renewal: ${Utils.formatNumber(renewalPrice)}đ (${plan.renewalDiscount}% OFF)\n`;
            renewalMessage += `💸 You save: ${Utils.formatNumber(discountAmount)}đ\n`;
        } else {
            renewalMessage += `💰 Price: ${Utils.formatNumber(plan.price)}đ\n`;
        }

        renewalMessage += `\n🛒 Command: \`!renew ${plan.id}\`\n\n`;
        renewalMessage += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    }

    renewalMessage += `💡 **Note:** Renewal extends your current subscription\n`;
    renewalMessage += `🎁 **Loyalty Bonus:** More renewals = better discounts!`;

    await message.reply(renewalMessage);
}

export { renewCommand };

// src/scripts/commands/status.ts
const statusCommand: Command = {
    config: {
        name: 'status',
        aliases: ['subscription', 'sub-status', 'plan'],
        description: 'Check your subscription status and details',
        usage: 'status',
        category: 'subscription',
        role: 0,
        cooldown: 5,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ message, event }: MessageContext) => {
        const payosManager = (global as any).bot.payosManager as PayOSManager;

        if (!payosManager) {
            return await message.reply('❌ Subscription system is not available.');
        }

        const statusMessage = await payosManager.getSubscriptionStatusMessage(event.threadID);
        await message.reply(statusMessage);
    }
};

export { statusCommand };