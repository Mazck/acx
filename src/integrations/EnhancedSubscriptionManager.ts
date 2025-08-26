// src/integrations/EnhancedSubscriptionManager.ts
import { PayOSManager } from './PayOSManager';
import { PromoCodeManager } from './PromoCodeManager';
import { ExpiryNotificationManager } from './ExpiryNotificationManager';
import { Logger } from '../utils/Logger';
import { Utils } from '../utils/Utils';

export class EnhancedSubscriptionManager {
    private payosManager: PayOSManager;
    private promoManager?: PromoCodeManager;
    private notificationManager: ExpiryNotificationManager;
    private api: any;
    private checkInterval?: NodeJS.Timeout;

    // Notification templates in Vietnamese
    private notificationTemplates = {
        week_warning: {
            title: '📅 Nhắc nhở gia hạn',
            emoji: '📅',
            urgency: 'low'
        },
        urgent_warning: {
            title: '⚠️ Sắp hết hạn',
            emoji: '⚠️',
            urgency: 'medium'
        },
        final_warning: {
            title: '🚨 Cảnh báo cuối',
            emoji: '🚨',
            urgency: 'high'
        },
        last_chance: {
            title: '🆘 Cơ hội cuối',
            emoji: '🆘',
            urgency: 'critical'
        },
        about_to_expire: {
            title: '⏰ Sắp khóa',
            emoji: '💥',
            urgency: 'critical'
        }
    };

    constructor(payosManager: PayOSManager, api: any, promoManager?: PromoCodeManager) {
        this.payosManager = payosManager;
        this.api = api;
        this.promoManager = promoManager;
        this.notificationManager = new ExpiryNotificationManager(payosManager, api, promoManager);

        this.startPeriodicCheck();
    }

    // Start periodic subscription checking
    private startPeriodicCheck(): void {
        // Check every 6 hours
        this.checkInterval = setInterval(async () => {
            await this.checkAllSubscriptions();
        }, 6 * 60 * 60 * 1000);

        // Initial check after 30 seconds
        setTimeout(async () => {
            await this.checkAllSubscriptions();
        }, 30000);

        Logger.info('SUBSCRIPTION_MANAGER', 'Started periodic subscription checking (every 6 hours)');
    }

    // Check all subscriptions and send appropriate notifications
    private async checkAllSubscriptions(): Promise<void> {
        try {
            Logger.info('SUBSCRIPTION_CHECK', 'Starting periodic subscription check...');

            const activeSubscriptions = await this.payosManager.getEnhancedDatabase()?.getActiveSubscriptions();
            if (!activeSubscriptions || activeSubscriptions.length === 0) {
                Logger.debug('SUBSCRIPTION_CHECK', 'No active subscriptions to check');
                return;
            }

            const now = new Date();
            let notificationsSent = 0;
            let expiredDeactivated = 0;

            for (const subscription of activeSubscriptions) {
                const timeUntilExpiry = subscription.endDate.getTime() - now.getTime();
                const daysLeft = Math.ceil(timeUntilExpiry / (24 * 60 * 60 * 1000));
                const hoursLeft = Math.ceil(timeUntilExpiry / (60 * 60 * 1000));

                // Deactivate expired subscriptions
                if (daysLeft <= 0) {
                    await this.payosManager.deactivateSubscription(subscription.threadID);
                    await this.sendExpiredNotification(subscription);
                    expiredDeactivated++;
                    continue;
                }

                // Send appropriate notifications
                const notificationSent = await this.checkAndSendNotification(subscription, daysLeft, hoursLeft);
                if (notificationSent) {
                    notificationsSent++;
                }
            }

            Logger.success('SUBSCRIPTION_CHECK', 'Periodic check completed', {
                totalSubscriptions: activeSubscriptions.length,
                notificationsSent,
                expiredDeactivated
            });

        } catch (error) {
            Logger.error('SUBSCRIPTION_CHECK', 'Error in periodic subscription check', error);
        }
    }

    // Check and send notification for a single subscription
    private async checkAndSendNotification(subscription: any, daysLeft: number, hoursLeft: number): Promise<boolean> {
        try {
            let notificationType: string | null = null;

            // Determine notification type based on time left
            if (hoursLeft <= 1) {
                notificationType = 'about_to_expire';
            } else if (hoursLeft <= 6) {
                notificationType = 'last_chance';
            } else if (daysLeft === 1) {
                notificationType = 'final_warning';
            } else if (daysLeft === 3) {
                notificationType = 'urgent_warning';
            } else if (daysLeft === 7) {
                notificationType = 'week_warning';
            }

            if (!notificationType) {
                return false; // No notification needed
            }

            // Check if we already sent this type of notification
            const lastNotificationKey = `last_notification_${subscription.threadID}`;
            const lastNotification = await this.getLastNotification(lastNotificationKey);

            if (lastNotification && lastNotification.type === notificationType &&
                (Date.now() - lastNotification.timestamp) < 6 * 60 * 60 * 1000) {
                return false; // Already sent within 6 hours
            }

            // Send notification
            const message = await this.buildSmartNotificationMessage(subscription, notificationType, daysLeft, hoursLeft);
            await this.api.sendMessage(message, subscription.threadID);

            // Record notification
            await this.recordNotification(lastNotificationKey, notificationType);

            Logger.success('SMART_NOTIFY', `Sent ${notificationType} to thread ${subscription.threadID}`, {
                daysLeft,
                hoursLeft,
                planId: subscription.planId
            });

            return true;

        } catch (error) {
            Logger.error('SMART_NOTIFY', `Error sending notification for thread ${subscription.threadID}`, error);
            return false;
        }
    }

    // Build smart notification message with personalized content
    private async buildSmartNotificationMessage(subscription: any, type: string, daysLeft: number, hoursLeft: number): Promise<string> {
        const plan = this.payosManager.getPlan(subscription.planId);
        const template = this.notificationTemplates[type as keyof typeof this.notificationTemplates];
        const renewalDiscount = plan?.renewalDiscount || 10;

        let message = `${template.emoji} **${template.title.toUpperCase()}**\n\n`;

        // Time information
        if (daysLeft > 0) {
            message += `⏰ **Thời gian còn lại:** ${daysLeft} ngày\n`;
        } else {
            message += `⏰ **Thời gian còn lại:** ${hoursLeft} giờ\n`;
        }

        message += `📦 **Gói hiện tại:** ${plan?.name || subscription.planId}\n`;
        message += `🔄 **Số lần gia hạn:** ${subscription.renewalCount}\n\n`;

        // Add urgency-specific content
        switch (template.urgency) {
            case 'low':
                message += await this.buildLowUrgencyContent(subscription, renewalDiscount);
                break;
            case 'medium':
                message += await this.buildMediumUrgencyContent(subscription, renewalDiscount);
                break;
            case 'high':
                message += await this.buildHighUrgencyContent(subscription, renewalDiscount);
                break;
            case 'critical':
                message += await this.buildCriticalUrgencyContent(subscription, renewalDiscount, hoursLeft);
                break;
        }

        // Add promo code suggestions
        if (this.promoManager && (type === 'final_warning' || type === 'last_chance')) {
            const promoSuggestions = await this.getUrgentPromoSuggestions(subscription.threadID);
            if (promoSuggestions) {
                message += `\n${promoSuggestions}`;
            }
        }

        return message;
    }

    private async buildLowUrgencyContent(subscription: any, renewalDiscount: number): Promise<string> {
        return `💡 **Lời nhắc thân thiện:**\n` +
            `Đừng quên gia hạn để tiếp tục sử dụng bot!\n\n` +
            `🎉 **Ưu đãi gia hạn:**\n` +
            `🔄 \`!renew\` - Giảm ${renewalDiscount}% cho khách hàng thân thiết\n` +
            `📦 \`!subscribe\` - Xem tất cả gói\n\n` +
            `✨ **Lợi ích gia hạn sớm:**\n` +
            `• Đảm bảo dịch vụ không bị gián đoạn\n` +
            `• Giữ nguyên tất cả cài đặt và dữ liệu\n` +
            `• Tích lũy điểm thân thiết cho lần sau`;
    }

    private async buildMediumUrgencyContent(subscription: any, renewalDiscount: number): Promise<string> {
        return `⚠️ **Hành động ngay để tránh gián đoạn dịch vụ!**\n\n` +
            `💳 **Tùy chọn gia hạn nhanh:**\n` +
            `🔄 \`!renew\` - Gia hạn cùng gói với giảm giá ${renewalDiscount}%\n` +
            `📈 \`!subscribe premium\` - Nâng cấp lên gói cao hơn\n` +
            `🎫 \`!redeem <mã>\` - Sử dụng mã khuyến mãi để tiết kiệm\n\n` +
            `🚫 **Sau khi hết hạn:**\n` +
            `• Bot sẽ ngừng hoạt động trong nhóm\n` +
            `• Tất cả lệnh sẽ bị khóa\n` +
            `• Dữ liệu kinh tế sẽ bị đóng băng\n\n` +
            `💎 **Gia hạn ngay để giữ quyền lợi!**`;
    }

    private async buildHighUrgencyContent(subscription: any, renewalDiscount: number): Promise<string> {
        return `🚨 **CẢNH BÁO KHẨN CẤP!**\n\n` +
            `⚠️ **Chỉ còn ít thời gian để gia hạn!**\n\n` +
            `⚡ **GIA HẠN NGAY LẬP TỨC:**\n` +
            `🔄 \`!renew\` - Gia hạn với giảm giá ${renewalDiscount}%\n` +
            `📞 **Liên hệ admin** nếu cần hỗ trợ thanh toán\n\n` +
            `💔 **Hậu quả nếu không gia hạn:**\n` +
            `• 🔒 **TẤT CẢ** tính năng bot sẽ bị khóa\n` +
            `• 💸 **MẤT** ưu đãi khách hàng thân thiết\n` +
            `• 📊 **ĐÓNG BĂNG** tiến trình và số dư\n\n` +
            `🎯 **ĐỪNG ĐỂ MẤT QUYỀN LỢI! GIA HẠN NGAY!**`;
    }

    private async buildCriticalUrgencyContent(subscription: any, renewalDiscount: number, hoursLeft: number): Promise<string> {
        let content = `🚨🚨 **KHẨN CẤP - CÒN ${hoursLeft} GIỜ!** 🚨🚨\n\n`;
        content += `💥 **ĐÂY LÀ THÔNG BÁO CUỐI CÙNG!**\n\n`;

        if (hoursLeft <= 1) {
            content += `⏰ **KHÔNG CÒN THỜI GIAN!**\n`;
            content += `🆘 **LIÊN HỆ ADMIN NGAY** để được hỗ trợ khẩn cấp\n`;
            content += `⚡ **Hoặc sử dụng:** \`!renew\` ngay lập tức\n\n`;
            content += `💀 **SAU ${hoursLeft} GIỜ NỮA:**\n`;
            content += `• 🚫 **TẤT CẢ** lệnh bot sẽ BỊ VÔ HIỆU HÓA\n`;
            content += `• 🔐 **MỌI** tính năng sẽ bị KHÓA HOÀN TOÀN\n`;
            content += `• 💸 Bạn sẽ **MẤT HẾT** ưu đãi gia hạn\n\n`;
            content += `🚨 **HÀNH ĐỘNG NGAY HOẶC MẤT TẤT CẢ!**`;
        } else {
            content += `⚠️ **CÒN ${hoursLeft} GIỜ CUỐI CÙNG!**\n\n`;
            content += `⚡ **GIA HẠN KHẨN CẤP:**\n`;
            content += `🔄 \`!renew\` - Giảm giá ${renewalDiscount}% (Nhanh nhất)\n`;
            content += `📞 **Gọi admin** nếu cần hỗ trợ thanh toán\n\n`;
            content += `💥 **SAU KHI HẾT HẠN:**\n`;
            content += `• Bot sẽ ngừng hoạt động hoàn toàn\n`;
            content += `• Mất tất cả ưu đãi khách hàng cũ\n`;
            content += `• Phải đăng ký lại như người dùng mới\n\n`;
            content += `🎯 **ĐỪNG ĐỂ MUỘN! GIA HẠN NGAY!**`;
        }

        return content;
    }

    // Get urgent promo code suggestions
    private async getUrgentPromoSuggestions(threadID: string): Promise<string | null> {
        if (!this.promoManager) {
            return null;
        }

        try {
            const suggestions = await this.promoManager.getPromoSuggestions(threadID);
            const urgentPromosExist = suggestions.some(p =>
                (p.type === 'discount' && p.value >= 15) ||
                p.type === 'free_activation' ||
                (p.type === 'extend_days' && p.value >= 7)
            );

            if (!urgentPromosExist) {
                return null;
            }

            let promoMessage = `🎁 **MÃ KHUYẾN MÃI KHẨN CẤP:**\n`;

            for (const promo of suggestions.slice(0, 3)) {
                if (promo.type === 'discount' && promo.value >= 15) {
                    promoMessage += `💰 \`!redeem ${promo.code}\` - GIẢM ${promo.value}% (Có hạn!)\n`;
                } else if (promo.type === 'free_activation') {
                    promoMessage += `🆓 \`!redeem ${promo.code}\` - KÍCH HOẠT MIỄN PHÍ!\n`;
                } else if (promo.type === 'extend_days' && promo.value >= 7) {
                    promoMessage += `🎁 \`!redeem ${promo.code}\` - TẶNG ${promo.value} NGÀY!\n`;
                }
            }

            return promoMessage;

        } catch (error) {
            Logger.warn('SUBSCRIPTION_MANAGER', 'Could not load urgent promo suggestions', error);
            return null;
        }
    }

    // Send expired subscription notification
    private async sendExpiredNotification(subscription: any): Promise<void> {
        try {
            const plan = this.payosManager.getPlan(subscription.planId);
            const renewalDiscount = plan?.renewalDiscount || 10;

            const expiredMessage = `💔 **SUBSCRIPTION ĐÃ HẾT HẠN** 💔\n\n` +
                `😢 Gói ${plan?.name || 'subscription'} của nhóm đã hết hạn.\n\n` +
                `🔒 **Tình trạng hiện tại:**\n` +
                `• ❌ Tất cả lệnh bot đã bị vô hiệu hóa\n` +
                `• 🚫 Không thể sử dụng tính năng AI\n` +
                `• 💔 Hệ thống kinh tế tạm thời bị khóa\n\n` +
                `💡 **KHÔI PHỤC NGAY:**\n` +
                `🔄 \`!renew\` - Gia hạn với ưu đãi ${renewalDiscount}%\n` +
                `📦 \`!subscribe\` - Chọn gói phù hợp\n` +
                `🎫 \`!redeem <mã>\` - Sử dụng mã khuyến mãi\n\n` +
                `⚡ **Gia hạn càng sớm, ưu đãi càng tốt!**\n` +
                `💎 **Khách hàng cũ luôn được ưu tiên đặc biệt**`;

            await this.api.sendMessage(expiredMessage, subscription.threadID);

            Logger.info('EXPIRED_NOTIFY', `Sent expiration notification to thread ${subscription.threadID}`);

        } catch (error) {
            Logger.error('EXPIRED_NOTIFY', `Failed to send expiration notification to thread ${subscription.threadID}`, error);
        }
    }

    // Enhanced notification for renewal success
    async sendRenewalSuccessNotification(threadID: string, subscription: any, transaction: any): Promise<void> {
        try {
            const plan = this.payosManager.getPlan(subscription.planId);
            const totalDays = plan?.days || 0;
            const bonusDays = transaction.metadata?.bonusDays || 0;
            const finalDays = totalDays + bonusDays;

            let successMessage = `🎉 **GIA HẠN THÀNH CÔNG!** 🎉\n\n`;
            successMessage += `✅ **${plan?.name}** đã được gia hạn!\n`;
            successMessage += `⏰ **Thời hạn mới:** ${finalDays} ngày\n`;
            successMessage += `📅 **Hết hạn:** ${new Date(subscription.endDate).toLocaleDateString('vi-VN')}\n`;

            if (transaction.discountAmount > 0) {
                successMessage += `💰 **Tiết kiệm:** ${Utils.formatNumber(transaction.discountAmount)}đ\n`;
            }

            if (bonusDays > 0) {
                successMessage += `🎁 **Ngày thưởng:** +${bonusDays} ngày\n`;
            }

            successMessage += `\n🤖 **Tất cả tính năng đã được kích hoạt lại!**\n\n`;
            successMessage += `🏆 **Cảm ơn bạn đã tin tưởng Uranus Bot!**\n`;
            successMessage += `💎 **Khách hàng thân thiết như bạn luôn được ưu tiên**`;

            await this.api.sendMessage(successMessage, threadID);

            // Clear any pending expiry notifications
            this.notificationManager.clearScheduledNotifications(threadID);

            // Schedule new notifications for the extended period
            await this.notificationManager.scheduleExpiryNotifications(threadID);

            Logger.success('RENEWAL_SUCCESS', `Sent renewal success notification to thread ${threadID}`, {
                planId: subscription.planId,
                finalDays,
                discountAmount: transaction.discountAmount
            });

        } catch (error) {
            Logger.error('RENEWAL_SUCCESS', `Failed to send renewal success notification to thread ${threadID}`, error);
        }
    }

    // Send new subscription activation notification
    async sendActivationNotification(threadID: string, subscription: any, isFirstTime: boolean = true): Promise<void> {
        try {
            const plan = this.payosManager.getPlan(subscription.planId);

            let activationMessage = '';

            if (isFirstTime) {
                activationMessage = `🎉 **CHÀO MỪNG ĐẾN VỚI URANUS BOT!** 🎉\n\n`;
                activationMessage += `✨ **${plan?.name}** đã được kích hoạt thành công!\n`;
                activationMessage += `⏰ **Thời hạn:** ${plan?.days} ngày\n`;
                activationMessage += `📅 **Hết hạn:** ${new Date(subscription.endDate).toLocaleDateString('vi-VN')}\n\n`;

                activationMessage += `🚀 **NHỮNG GÌ BẠN CÓ THỂ LÀM:**\n`;
                activationMessage += `🎮 \`!help fun\` - Các game và giải trí\n`;
                activationMessage += `💰 \`!help economy\` - Hệ thống kinh tế\n`;
                activationMessage += `🤖 \`!help ai\` - Tính năng AI thông minh\n`;
                activationMessage += `🛠️ \`!help utility\` - Công cụ tiện ích\n\n`;

                activationMessage += `🌟 **BẮT ĐẦU NGAY:**\n`;
                activationMessage += `• \`!ping\` - Kiểm tra bot\n`;
                activationMessage += `• \`!balance\` - Xem số dư và level\n`;
                activationMessage += `• \`!help\` - Menu hướng dẫn\n\n`;

                activationMessage += `💎 **Cảm ơn bạn đã chọn Uranus Bot!**`;
            } else {
                activationMessage = `🔄 **KÍCH HOẠT LẠI THÀNH CÔNG!** 🔄\n\n`;
                activationMessage += `✅ Bot đã hoạt động trở lại trong nhóm!\n`;
                activationMessage += `📦 **Gói:** ${plan?.name}\n`;
                activationMessage += `⏰ **Thời hạn:** ${plan?.days} ngày\n\n`;
                activationMessage += `🎯 **Chào mừng bạn trở lại!**`;
            }

            await this.api.sendMessage(activationMessage, threadID);

            // Schedule expiry notifications for new subscription
            await this.notificationManager.scheduleExpiryNotifications(threadID);

            Logger.success('ACTIVATION_NOTIFY', `Sent activation notification to thread ${threadID}`, {
                planId: subscription.planId,
                isFirstTime
            });

        } catch (error) {
            Logger.error('ACTIVATION_NOTIFY', `Failed to send activation notification to thread ${threadID}`, error);
        }
    }

    // Get statistics about notifications sent
    async getNotificationStats(): Promise<{
        totalScheduled: number;
        byType: Record<string, number>;
        byUrgency: Record<string, number>;
        recentlySent: number;
    }> {
        const allNotifications = this.notificationManager.getAllScheduledNotifications();

        const byType: Record<string, number> = {};
        const byUrgency: Record<string, number> = {};

        for (const notification of allNotifications) {
            // Count by type
            byType[notification.notificationType] = (byType[notification.notificationType] || 0) + 1;

            // Count by urgency
            const template = this.notificationTemplates[notification.notificationType as keyof typeof this.notificationTemplates];
            if (template) {
                byUrgency[template.urgency] = (byUrgency[template.urgency] || 0) + 1;
            }
        }

        return {
            totalScheduled: allNotifications.length,
            byType,
            byUrgency,
            recentlySent: 0 // Would need to track sent notifications history
        };
    }

    // Manual notification sending for testing
    async sendTestNotification(threadID: string, type: string): Promise<void> {
        try {
            const subscription = await this.payosManager.getThreadSubscription(threadID);
            if (!subscription) {
                throw new Error('No subscription found for thread');
            }

            await this.notificationManager.triggerTestNotification(threadID, type);

            Logger.success('TEST_NOTIFY', `Sent test notification ${type} to thread ${threadID}`);
        } catch (error) {
            Logger.error('TEST_NOTIFY', `Failed to send test notification to thread ${threadID}`, error);
            throw error;
        }
    }

    // Get and record last notification
    private async getLastNotification(key: string): Promise<{ type: string; timestamp: number } | null> {
        try {
            const database = (global as any).bot.getDatabase();
            if (database) {
                return await database.global.get(key, null);
            }
            return null;
        } catch {
            return null;
        }
    }

    private async recordNotification(key: string, type: string): Promise<void> {
        try {
            const database = (global as any).bot.getDatabase();
            if (database) {
                await database.global.set(key, {
                    type,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            Logger.warn('SUBSCRIPTION_MANAGER', 'Could not record notification', error);
        }
    }

    // Cleanup method
    cleanup(): void {
        Logger.info('SUBSCRIPTION_MANAGER', 'Cleaning up enhanced subscription manager...');

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }

        this.notificationManager.cleanup();

        Logger.info('SUBSCRIPTION_MANAGER', 'Enhanced subscription manager cleanup completed');
    }

    // Get notification manager for external access
    getNotificationManager(): ExpiryNotificationManager {
        return this.notificationManager;
    }

    // Force check all subscriptions (manual trigger)
    async forceCheckAllSubscriptions(): Promise<{
        checked: number;
        notificationsSent: number;
        expiredDeactivated: number;
    }> {
        Logger.info('FORCE_CHECK', 'Manual subscription check triggered');

        const activeSubscriptions = await this.payosManager.getEnhancedDatabase()?.getActiveSubscriptions();
        if (!activeSubscriptions) {
            return { checked: 0, notificationsSent: 0, expiredDeactivated: 0 };
        }

        const now = new Date();
        let notificationsSent = 0;
        let expiredDeactivated = 0;

        for (const subscription of activeSubscriptions) {
            const timeUntilExpiry = subscription.endDate.getTime() - now.getTime();
            const daysLeft = Math.ceil(timeUntilExpiry / (24 * 60 * 60 * 1000));
            const hoursLeft = Math.ceil(timeUntilExpiry / (60 * 60 * 1000));

            if (daysLeft <= 0) {
                await this.payosManager.deactivateSubscription(subscription.threadID);
                await this.sendExpiredNotification(subscription);
                expiredDeactivated++;
            } else {
                const notificationSent = await this.checkAndSendNotification(subscription, daysLeft, hoursLeft);
                if (notificationSent) {
                    notificationsSent++;
                }
            }
        }

        return {
            checked: activeSubscriptions.length,
            notificationsSent,
            expiredDeactivated
        };
    }
}