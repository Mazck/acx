// src/integrations/ExpiryNotificationManager.ts
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';
import { PayOSManager } from './PayOSManager';
import { PromoCodeManager } from './PromoCodeManager';

export class ExpiryNotificationManager {
    private payosManager: PayOSManager;
    private promoManager?: PromoCodeManager;
    private api: any;
    private notificationSchedule = new Map<string, NodeJS.Timeout>();

    constructor(payosManager: PayOSManager, api: any, promoManager?: PromoCodeManager) {
        this.payosManager = payosManager;
        this.api = api;
        this.promoManager = promoManager;
    }

    // Schedule notifications for a thread
    async scheduleExpiryNotifications(threadID: string): Promise<void> {
        try {
            const subscription = await this.payosManager.getThreadSubscription(threadID);
            if (!subscription || !subscription.isActive) {
                return;
            }

            const now = new Date();
            const endDate = new Date(subscription.endDate);
            const timeUntilExpiry = endDate.getTime() - now.getTime();

            // Clear existing notifications for this thread
            this.clearScheduledNotifications(threadID);

            // Schedule notifications at different intervals
            const notifications = [
                { days: 7, message: 'week_warning' },
                { days: 3, message: 'urgent_warning' },
                { days: 1, message: 'final_warning' },
                { days: 0, hours: 6, message: 'last_chance' },
                { days: 0, hours: 1, message: 'about_to_expire' }
            ];

            for (const notification of notifications) {
                const notificationTime = endDate.getTime() - (notification.days * 24 * 60 * 60 * 1000) - ((notification.hours || 0) * 60 * 60 * 1000);
                const timeUntilNotification = notificationTime - now.getTime();

                if (timeUntilNotification > 0 && timeUntilNotification <= timeUntilExpiry) {
                    const timeout = setTimeout(async () => {
                        await this.sendExpiryNotification(threadID, notification.message, subscription);
                    }, timeUntilNotification);

                    this.notificationSchedule.set(`${threadID}_${notification.message}`, timeout);

                    Logger.debug('EXPIRY_NOTIFY', `Scheduled ${notification.message} for thread ${threadID}`, {
                        timeUntilNotification: Utils.convertDuration(timeUntilNotification),
                        triggerTime: new Date(notificationTime).toISOString()
                    });
                }
            }

            Logger.info('EXPIRY_NOTIFY', `Scheduled expiry notifications for thread ${threadID}`, {
                endDate: endDate.toISOString(),
                totalNotifications: this.getScheduledCount(threadID)
            });

        } catch (error) {
            Logger.error('EXPIRY_NOTIFY', `Error scheduling notifications for thread ${threadID}`, error);
        }
    }

    // Send specific expiry notification
    private async sendExpiryNotification(threadID: string, notificationType: string, subscription: any): Promise<void> {
        try {
            const message = await this.buildExpiryMessage(threadID, notificationType, subscription);
            await this.api.sendMessage(message, threadID);

            Logger.success('EXPIRY_NOTIFY', `Sent ${notificationType} notification to thread ${threadID}`);
        } catch (error) {
            Logger.error('EXPIRY_NOTIFY', `Failed to send ${notificationType} notification to thread ${threadID}`, error);
        }
    }

    // Build expiry notification message based on type
    private async buildExpiryMessage(threadID: string, type: string, subscription: any): Promise<string> {
        const plan = this.payosManager.getPlan(subscription.planId);
        const now = new Date();
        const endDate = new Date(subscription.endDate);
        const timeLeft = endDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(timeLeft / (24 * 60 * 60 * 1000));
        const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));

        let message = '';

        switch (type) {
            case 'week_warning':
                message = this.buildWeekWarningMessage(plan, daysLeft, subscription);
                break;
            case 'urgent_warning':
                message = this.buildUrgentWarningMessage(plan, daysLeft, subscription);
                break;
            case 'final_warning':
                message = await this.buildFinalWarningMessage(threadID, plan, daysLeft, subscription);
                break;
            case 'last_chance':
                message = await this.buildLastChanceMessage(threadID, plan, hoursLeft, subscription);
                break;
            case 'about_to_expire':
                message = await this.buildAboutToExpireMessage(threadID, plan, hoursLeft, subscription);
                break;
            default:
                message = this.buildGenericWarningMessage(plan, daysLeft);
        }

        return message;
    }

    private buildWeekWarningMessage(plan: any, daysLeft: number, subscription: any): string {
        const renewalDiscount = plan?.renewalDiscount || 10;

        return `📅 **Subscription Reminder**\n\n` +
            `Hi everyone! Your ${plan?.name || 'subscription'} will expire in **${daysLeft} days**.\n\n` +
            `🔄 **Renew early and save ${renewalDiscount}%!**\n` +
            `• Current plan: ${plan?.name}\n` +
            `• Renewal discount: ${renewalDiscount}% OFF\n` +
            `• Total renewals: ${subscription.renewalCount}\n\n` +
            `💡 **Quick renewal:** Use \`!renew\`\n` +
            `📦 **Upgrade plans:** Use \`!subscribe\`\n\n` +
            `✨ Why renew early?\n` +
            `• Guarantee uninterrupted service\n` +
            `• Lock in your renewal discount\n` +
            `• Keep all your settings and history`;
    }

    private buildUrgentWarningMessage(plan: any, daysLeft: number, subscription: any): string {
        const renewalDiscount = plan?.renewalDiscount || 10;

        return `⚠️ **URGENT: Subscription Expiring Soon**\n\n` +
            `🚨 Only **${daysLeft} days** left on your ${plan?.name || 'subscription'}!\n\n` +
            `💳 **Quick Renewal Options:**\n` +
            `🔄 \`!renew\` - Same plan with ${renewalDiscount}% discount\n` +
            `📦 \`!subscribe premium\` - Upgrade for better value\n` +
            `🎫 \`!redeem <code>\` - Use promo codes for extra savings\n\n` +
            `⏰ **What happens when it expires:**\n` +
            `• ❌ All bot commands will be disabled\n` +
            `• 🔒 Features will be locked\n` +
            `• 💔 Lost progress in economy system\n\n` +
            `🎯 **Don't wait! Renew now to avoid interruption.**`;
    }

    private async buildFinalWarningMessage(threadID: string, plan: any, daysLeft: number, subscription: any): Promise<string> {
        let message = `🚨 **FINAL WARNING: Expires ${daysLeft === 1 ? 'TOMORROW' : `in ${daysLeft} days`}**\n\n` +
            `⏰ Your ${plan?.name || 'subscription'} is about to expire!\n\n`;

        // Add special promo codes for final warning
        if (this.promoManager) {
            try {
                const suggestions = await this.promoManager.getPromoSuggestions(threadID);
                const urgentPromosExist = suggestions.some(p => p.type === 'discount' && p.value >= 20);

                if (urgentPromosExist) {
                    message += `🎁 **LAST-MINUTE SPECIAL OFFERS:**\n`;
                    for (const promo of suggestions.slice(0, 2)) {
                        if (promo.type === 'discount' && promo.value >= 20) {
                            message += `🎫 \`!redeem ${promo.code}\` - ${promo.value}% OFF (Limited time!)\n`;
                        }
                    }
                    message += `\n`;
                }
            } catch (error) {
                Logger.warn('EXPIRY_NOTIFY', 'Could not load urgent promo codes', error);
            }
        }

        const renewalDiscount = plan?.renewalDiscount || 10;

        message += `⚡ **INSTANT RENEWAL:**\n` +
            `🔄 \`!renew\` - ${renewalDiscount}% loyalty discount\n` +
            `📦 \`!subscribe\` - View all plans\n\n` +
            `🚨 **This is your LAST reminder!**\n` +
            `Don't lose access to all bot features.`;

        return message;
    }

    private async buildLastChanceMessage(threadID: string, plan: any, hoursLeft: number, subscription: any): Promise<string> {
        let message = `🚨🚨 **LAST CHANCE - ${hoursLeft} HOURS LEFT!** 🚨🚨\n\n` +
            `⏰ Your subscription expires in **${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}**\n\n`;

        // Emergency promo codes for last chance
        if (this.promoManager) {
            try {
                const suggestions = await this.promoManager.getPromoSuggestions(threadID);
                if (suggestions.length > 0) {
                    message += `🆘 **EMERGENCY DISCOUNT CODES:**\n`;
                    for (const promo of suggestions.slice(0, 3)) {
                        message += `⚡ \`!redeem ${promo.code}\` - `;
                        if (promo.type === 'discount') {
                            message += `${promo.value}% OFF`;
                        } else if (promo.type === 'free_activation') {
                            message += `FREE activation`;
                        } else {
                            message += `+${promo.value} days`;
                        }
                        message += `\n`;
                    }
                    message += `\n`;
                }
            } catch (error) {
                Logger.warn('EXPIRY_NOTIFY', 'Could not load emergency promo codes', error);
            }
        }

        message += `⚡ **RENEW RIGHT NOW:**\n` +
            `🔄 \`!renew\` - Quick renewal\n` +
            `📞 Contact admin for immediate help\n\n` +
            `⚠️ **After expiry, all bot features will be DISABLED.**\n` +
            `💸 **You'll lose your loyalty discount!**`;

        return message;
    }

    private async buildAboutToExpireMessage(threadID: string, plan: any, hoursLeft: number, subscription: any): Promise<string> {
        return `🚨 **CRITICAL: EXPIRES IN ${hoursLeft} HOUR${hoursLeft === 1 ? '' : 'S'}!** 🚨\n\n` +
            `⏰ This is your FINAL notification!\n\n` +
            `🚨 **URGENT ACTION NEEDED:**\n` +
            `🔄 \`!renew\` - Instant renewal\n` +
            `📞 Message admins immediately\n\n` +
            `⚠️ **In ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}, bot will be DISABLED**\n` +
            `💔 **All progress will be locked**\n\n` +
            `🆘 **Need help? React with 🆘 for emergency support**`;
    }

    private buildGenericWarningMessage(plan: any, daysLeft: number): string {
        return `⏰ **Subscription Notice**\n\n` +
            `Your ${plan?.name || 'subscription'} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.\n\n` +
            `Use \`!renew\` to extend your subscription.\n` +
            `Use \`!subscribe\` to view available plans.`;
    }

    // Clear scheduled notifications for a thread
    clearScheduledNotifications(threadID: string): void {
        const keys = Array.from(this.notificationSchedule.keys());
        const threadKeys = keys.filter(key => key.startsWith(`${threadID}_`));

        for (const key of threadKeys) {
            const timeout = this.notificationSchedule.get(key);
            if (timeout) {
                clearTimeout(timeout);
                this.notificationSchedule.delete(key);
            }
        }

        if (threadKeys.length > 0) {
            Logger.debug('EXPIRY_NOTIFY', `Cleared ${threadKeys.length} scheduled notifications for thread ${threadID}`);
        }
    }

    // Get count of scheduled notifications for a thread
    getScheduledCount(threadID: string): number {
        const keys = Array.from(this.notificationSchedule.keys());
        return keys.filter(key => key.startsWith(`${threadID}_`)).length;
    }

    // Manual trigger for testing
    async triggerTestNotification(threadID: string, type: string): Promise<void> {
        const subscription = await this.payosManager.getThreadSubscription(threadID);
        if (!subscription) {
            throw new Error('No subscription found for thread');
        }

        await this.sendExpiryNotification(threadID, type, subscription);
    }

    // Get all scheduled notifications (for debugging)
    getAllScheduledNotifications(): Array<{
        key: string;
        threadID: string;
        notificationType: string;
        timeRemaining: number;
    }> {
        const notifications = [];

        for (const [key] of this.notificationSchedule) {
            const parts = key.split('_');
            if (parts.length >= 2) {
                const threadID = parts[0];
                const notificationType = parts.slice(1).join('_');

                notifications.push({
                    key,
                    threadID,
                    notificationType,
                    timeRemaining: 0 // Would need to track creation time for accurate calculation
                });
            }
        }

        return notifications;
    }

    // Cleanup expired timers
    cleanup(): void {
        Logger.info('EXPIRY_NOTIFY', 'Cleaning up expiry notification manager...');

        for (const timeout of this.notificationSchedule.values()) {
            clearTimeout(timeout);
        }

        this.notificationSchedule.clear();
        Logger.info('EXPIRY_NOTIFY', 'Expiry notification manager cleanup completed');
    }
}