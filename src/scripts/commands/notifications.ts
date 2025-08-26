// src/scripts/commands/notifications.ts - Admin command for managing subscription notifications
import { Command, MessageContext } from '../../types/interfaces';
import { Logger } from '../../utils/Logger';
import { Utils } from '../../utils/Utils';

const notificationsCommand: Command = {
    config: {
        name: 'notifications',
        aliases: ['notify', 'reminders', 'alerts'],
        description: 'Quản lý hệ thống thông báo subscription (Bot Admin only)',
        usage: 'notifications <action> [parameters]',
        category: 'admin',
        role: 2, // Bot admin only
        cooldown: 5,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ args, message, userData }: MessageContext) => {
        const subscriptionManager = (global as any).bot.getEnhancedSubscriptionManager();

        if (!subscriptionManager) {
            return await message.reply('❌ Hệ thống thông báo không khả dụng.');
        }

        if (args.length === 0) {
            return await showNotificationHelp(message);
        }

        const action = args[0].toLowerCase();

        try {
            switch (action) {
                case 'check':
                case 'force':
                    await handleForceCheck(message, subscriptionManager);
                    break;

                case 'test':
                    await handleTestNotification(message, args, subscriptionManager);
                    break;

                case 'stats':
                case 'statistics':
                    await handleNotificationStats(message, subscriptionManager);
                    break;

                case 'schedule':
                    await handleScheduleNotifications(message, args, subscriptionManager);
                    break;

                case 'clear':
                    await handleClearNotifications(message, args, subscriptionManager);
                    break;

                case 'templates':
                    await handleShowTemplates(message);
                    break;

                default:
                    await showNotificationHelp(message);
            }

        } catch (error: any) {
            Logger.error('NOTIFICATIONS_CMD', 'Error in notifications command', error);
            await message.reply(`❌ **Lỗi thực hiện lệnh**\n\n${error.message}`);
        }
    }
};

async function showNotificationHelp(message: any): Promise<void> {
    const helpMessage = `🔔 **QUẢN LÝ HỆ THỐNG THÔNG BÁO**\n\n` +
        `📋 **Các lệnh có sẵn:**\n\n` +

        `🔸 **\`!notifications check\`** - Kiểm tra tất cả subscription\n` +
        `   └ Gửi thông báo cho các subscription sắp hết hạn\n\n` +

        `🔸 **\`!notifications test <threadID> <type>\`** - Test thông báo\n` +
        `   └ Gửi thông báo thử để kiểm tra template\n\n` +

        `🔸 **\`!notifications stats\`** - Thống kê thông báo\n` +
        `   └ Xem số lượng thông báo đã lên lịch và gửi\n\n` +

        `🔸 **\`!notifications schedule <threadID>\`** - Lên lịch thông báo\n` +
        `   └ Tự động lên lịch thông báo cho thread cụ thể\n\n` +

        `🔸 **\`!notifications clear <threadID>\`** - Xóa lịch thông báo\n` +
        `   └ Hủy tất cả thông báo đã lên lịch cho thread\n\n` +

        `🔸 **\`!notifications templates\`** - Xem mẫu thông báo\n` +
        `   └ Danh sách các template thông báo có sẵn\n\n` +

        `📝 **Loại thông báo:**\n` +
        `• **week_warning** - Nhắc nhở 7 ngày trước\n` +
        `• **urgent_warning** - Cảnh báo 3 ngày\n` +
        `• **final_warning** - Cảnh báo cuối 1 ngày\n` +
        `• **last_chance** - 6 giờ cuối\n` +
        `• **about_to_expire** - 1 giờ cuối\n\n` +

        `💡 **Ví dụ:**\n` +
        `\`!notifications test 123456789 final_warning\`\n` +
        `\`!notifications schedule 123456789\``;

    await message.reply(helpMessage);
}

async function handleForceCheck(message: any, subscriptionManager: any): Promise<void> {
    await message.reply('⏳ **Đang kiểm tra tất cả subscription...**');

    const results = await subscriptionManager.forceCheckAllSubscriptions();

    const resultMessage = `✅ **KIỂM TRA HOÀN TẤT**\n\n` +
        `📊 **Kết quả:**\n` +
        `• Đã kiểm tra: ${results.checked} subscription\n` +
        `• Thông báo đã gửi: ${results.notificationsSent}\n` +
        `• Đã vô hiệu hóa (hết hạn): ${results.expiredDeactivated}\n\n` +

        `⏰ **Thời gian:** ${new Date().toLocaleString('vi-VN')}\n` +
        `👤 **Thực hiện bởi:** ${userData.name}`;

    await message.reply(resultMessage);

    Logger.success('NOTIFICATIONS_CMD', 'Force check completed', {
        adminUser: userData.name,
        results
    });
}

async function handleTestNotification(message: any, args: string[], subscriptionManager: any): Promise<void> {
    if (args.length < 3) {
        return await message.reply(
            `❌ **Thiếu tham số**\n\n` +
            `📝 **Cách sử dụng:** \`!notifications test <threadID> <type>\`\n\n` +
            `📋 **Loại thông báo:**\n` +
            `• week_warning, urgent_warning, final_warning\n` +
            `• last_chance, about_to_expire`
        );
    }

    const threadID = args[1];
    const notificationType = args[2];

    const validTypes = ['week_warning', 'urgent_warning', 'final_warning', 'last_chance', 'about_to_expire'];
    if (!validTypes.includes(notificationType)) {
        return await message.reply(
            `❌ **Loại thông báo không hợp lệ**\n\n` +
            `📋 **Loại hợp lệ:** ${validTypes.join(', ')}`
        );
    }

    try {
        await subscriptionManager.sendTestNotification(threadID, notificationType);

        await message.reply(
            `✅ **Thông báo test đã gửi**\n\n` +
            `📱 **Thread:** ${threadID}\n` +
            `🔔 **Loại:** ${notificationType}\n` +
            `⏰ **Thời gian:** ${new Date().toLocaleString('vi-VN')}`
        );

        Logger.success('NOTIFICATIONS_CMD', 'Test notification sent', {
            threadID,
            notificationType,
            adminUser: userData.name
        });

    } catch (error: any) {
        await message.reply(
            `❌ **Lỗi gửi thông báo test**\n\n` +
            `Thread: ${threadID}\n` +
            `Lỗi: ${error.message}`
        );
    }
}

async function handleNotificationStats(message: any, subscriptionManager: any): Promise<void> {
    try {
        const stats = await subscriptionManager.getNotificationStats();
        const payosManager = (global as any).bot.getPayOSManager();
        const subscriptionStats = await payosManager.getSubscriptionStats();

        let statsMessage = `📊 **THỐNG KÊ HỆ THỐNG THÔNG BÁO**\n\n`;

        statsMessage += `🔔 **Thông báo đã lên lịch:**\n`;
        statsMessage += `• Tổng số: ${stats.totalScheduled}\n`;

        if (Object.keys(stats.byType).length > 0) {
            statsMessage += `\n📋 **Theo loại:**\n`;
            for (const [type, count] of Object.entries(stats.byType)) {
                statsMessage += `• ${type}: ${count}\n`;
            }
        }

        if (Object.keys(stats.byUrgency).length > 0) {
            statsMessage += `\n⚠️ **Theo mức độ:**\n`;
            for (const [urgency, count] of Object.entries(stats.byUrgency)) {
                const urgencyName = getUrgencyNameVN(urgency);
                statsMessage += `• ${urgencyName}: ${count}\n`;
            }
        }

        statsMessage += `\n📈 **Subscription tổng quan:**\n`;
        statsMessage += `• Tổng số: ${subscriptionStats.totalSubscriptions}\n`;
        statsMessage += `• Đang hoạt động: ${subscriptionStats.activeSubscriptions}\n`;
        statsMessage += `• Đã hết hạn: ${subscriptionStats.expiredSubscriptions}\n\n`;

        statsMessage += `⏰ **Cập nhật lúc:** ${new Date().toLocaleString('vi-VN')}`;

        await message.reply(statsMessage);

    } catch (error) {
        await message.reply('❌ Không thể lấy thống kê thông báo');
    }
}

async function handleScheduleNotifications(message: any, args: string[], subscriptionManager: any): Promise<void> {
    if (args.length < 2) {
        return await message.reply(
            `❌ **Thiếu threadID**\n\n` +
            `📝 **Cách sử dụng:** \`!notifications schedule <threadID>\`\n` +
            `💡 ThreadID có thể lấy từ URL hoặc developer tools`
        );
    }

    const threadID = args[1];

    try {
        const notificationManager = subscriptionManager.getNotificationManager();
        await notificationManager.scheduleExpiryNotifications(threadID);

        const scheduledCount = notificationManager.getScheduledCount(threadID);

        await message.reply(
            `✅ **Đã lên lịch thông báo**\n\n` +
            `📱 **Thread:** ${threadID}\n` +
            `🔔 **Số thông báo:** ${scheduledCount}\n` +
            `⏰ **Thời gian:** ${new Date().toLocaleString('vi-VN')}`
        );

        Logger.success('NOTIFICATIONS_CMD', 'Scheduled notifications', {
            threadID,
            count: scheduledCount,
            adminUser: userData.name
        });

    } catch (error: any) {
        await message.reply(
            `❌ **Lỗi lên lịch thông báo**\n\n` +
            `Thread: ${threadID}\n` +
            `Lỗi: ${error.message}`
        );
    }
}

async function handleClearNotifications(message: any, args: string[], subscriptionManager: any): Promise<void> {
    if (args.length < 2) {
        return await message.reply(
            `❌ **Thiếu threadID**\n\n` +
            `📝 **Cách sử dụng:** \`!notifications clear <threadID>\`\n` +
            `⚠️ **Chú ý:** Sẽ xóa tất cả thông báo đã lên lịch cho thread này`
        );
    }

    const threadID = args[1];

    try {
        const notificationManager = subscriptionManager.getNotificationManager();
        const beforeCount = notificationManager.getScheduledCount(threadID);

        notificationManager.clearScheduledNotifications(threadID);

        await message.reply(
            `✅ **Đã xóa thông báo**\n\n` +
            `📱 **Thread:** ${threadID}\n` +
            `🗑️ **Đã xóa:** ${beforeCount} thông báo\n` +
            `⏰ **Thời gian:** ${new Date().toLocaleString('vi-VN')}`
        );

        Logger.success('NOTIFICATIONS_CMD', 'Cleared notifications', {
            threadID,
            count: beforeCount,
            adminUser: userData.name
        });

    } catch (error: any) {
        await message.reply(
            `❌ **Lỗi xóa thông báo**\n\n` +
            `Thread: ${threadID}\n` +
            `Lỗi: ${error.message}`
        );
    }
}

async function handleShowTemplates(message: any): Promise<void> {
    const templatesMessage = `📄 **MẪU THÔNG BÁO SUBSCRIPTION**\n\n` +

        `🔔 **Các loại thông báo tự động:**\n\n` +

        `📅 **week_warning** (7 ngày trước)\n` +
        `├ Mức độ: Thông tin nhẹ nhàng\n` +
        `├ Nội dung: Nhắc nhở gia hạn sớm\n` +
        `└ Ưu đãi: Giảm giá renewal, promo codes\n\n` +

        `⚠️ **urgent_warning** (3 ngày)\n` +
        `├ Mức độ: Cảnh báo trung bình\n` +
        `├ Nội dung: Hậu quả nếu không gia hạn\n` +
        `└ Ưu đãi: Mã khuyến mãi đặc biệt\n\n` +

        `🚨 **final_warning** (1 ngày)\n` +
        `├ Mức độ: Cảnh báo cao\n` +
        `├ Nội dung: Cảnh báo cuối cùng\n` +
        `└ Ưu đãi: Mã khẩn cấp, hỗ trợ admin\n\n` +

        `🆘 **last_chance** (6 giờ)\n` +
        `├ Mức độ: Khẩn cấp\n` +
        `├ Nội dung: Cơ hội cuối cùng\n` +
        `└ Ưu đãi: Mã emergency, liên hệ trực tiếp\n\n` +

        `💥 **about_to_expire** (1 giờ)\n` +
        `├ Mức độ: Cực kỳ khẩn cấp\n` +
        `├ Nội dung: Thông báo cuối, hướng dẫn khẩn cấp\n` +
        `└ Ưu đãi: Hỗ trợ trực tiếp từ admin\n\n` +

        `🎯 **Tính năng đặc biệt:**\n` +
        `• Tự động phát hiện mã khuyến mãi phù hợp\n` +
        `• Tùy chỉnh nội dung dựa trên lịch sử gia hạn\n` +
        `• Ngăn spam bằng cách giới hạn tần suất\n` +
        `• Tích hợp với hệ thống promo code\n\n` +

        `⚙️ **Cấu hình tự động:**\n` +
        `• Kiểm tra mỗi 6 tiếng\n` +
        `• Lên lịch thông báo khi có subscription mới\n` +
        `• Tự động dọn dẹp khi gia hạn thành công`;

    await message.reply(templatesMessage);
}

async function handleForceCheck(message: any, subscriptionManager: any): Promise<void> {
    const startTime = Date.now();

    await message.reply('🔄 **Đang thực hiện kiểm tra toàn bộ hệ thống...**\n\n⏳ Vui lòng đợi...');

    try {
        const results = await subscriptionManager.forceCheckAllSubscriptions();
        const duration = Date.now() - startTime;

        let resultMessage = `✅ **KIỂM TRA HỆ THỐNG HOÀN TẤT**\n\n`;

        resultMessage += `📊 **Kết quả chi tiết:**\n`;
        resultMessage += `🔍 **Đã kiểm tra:** ${results.checked} subscription\n`;
        resultMessage += `📤 **Thông báo đã gửi:** ${results.notificationsSent}\n`;
        resultMessage += `⚠️ **Đã vô hiệu hóa (hết hạn):** ${results.expiredDeactivated}\n\n`;

        resultMessage += `⏱️ **Thời gian xử lý:** ${Utils.convertDuration(duration)}\n`;
        resultMessage += `📅 **Lúc:** ${new Date().toLocaleString('vi-VN')}\n\n`;

        if (results.notificationsSent > 0) {
            resultMessage += `✨ **${results.notificationsSent} nhóm đã nhận thông báo nhắc nhở gia hạn**\n`;
        }

        if (results.expiredDeactivated > 0) {
            resultMessage += `🔒 **${results.expiredDeactivated} subscription hết hạn đã được vô hiệu hóa**\n`;
        }

        if (results.checked === 0) {
            resultMessage += `ℹ️ **Không có subscription nào cần kiểm tra**`;
        }

        await message.reply(resultMessage);

    } catch (error: any) {
        const duration = Date.now() - startTime;

        await message.reply(
            `❌ **LỖI TRONG QUÁ TRÌNH KIỂM TRA**\n\n` +
            `⏱️ **Thời gian:** ${Utils.convertDuration(duration)}\n` +
            `❗ **Lỗi:** ${error.message}\n\n` +
            `💡 **Thử lại sau hoặc kiểm tra logs để biết chi tiết**`
        );
    }
}

async function handleTestNotification(message: any, args: string[], subscriptionManager: any): Promise<void> {
    if (args.length < 3) {
        return await message.reply(
            `❌ **Thiếu tham số cho test**\n\n` +
            `📝 **Cách sử dụng:** \`!notifications test <threadID> <type>\`\n\n` +
            `🔔 **Ví dụ:**\n` +
            `\`!notifications test 123456789 final_warning\`\n` +
            `\`!notifications test 987654321 last_chance\``
        );
    }

    const threadID = args[1];
    const notificationType = args[2];

    await message.reply('📤 **Đang gửi thông báo test...**');

    try {
        await subscriptionManager.sendTestNotification(threadID, notificationType);

        await message.reply(
            `✅ **Test thông báo thành công**\n\n` +
            `📱 **Thread:** ${threadID}\n` +
            `🔔 **Loại:** ${notificationType}\n` +
            `📤 **Trạng thái:** Đã gửi\n` +
            `⏰ **Lúc:** ${new Date().toLocaleString('vi-VN')}\n\n` +
            `💡 **Kiểm tra thread đích để xem thông báo**`
        );

    } catch (error: any) {
        await message.reply(
            `❌ **Lỗi test thông báo**\n\n` +
            `📱 **Thread:** ${threadID}\n` +
            `🔔 **Loại:** ${notificationType}\n` +
            `❗ **Lỗi:** ${error.message}\n\n` +
            `🔍 **Kiểm tra:**\n` +
            `• ThreadID có đúng không?\n` +
            `• Thread có subscription không?\n` +
            `• Bot có quyền gửi tin nhắn không?`
        );
    }
}

async function handleScheduleNotifications(message: any, args: string[], subscriptionManager: any): Promise<void> {
    if (args.length < 2) {
        return await message.reply(
            `❌ **Thiếu threadID**\n\n` +
            `📝 **Cách sử dụng:** \`!notifications schedule <threadID>\`\n\n` +
            `💡 **Chức năng:** Tự động lên lịch các thông báo nhắc nhở\n` +
            `⏰ **Lịch trình:** 7 ngày, 3 ngày, 1 ngày, 6 giờ, 1 giờ trước khi hết hạn`
        );
    }

    const threadID = args[1];

    try {
        const notificationManager = subscriptionManager.getNotificationManager();

        await message.reply('📅 **Đang lên lịch thông báo...**');

        await notificationManager.scheduleExpiryNotifications(threadID);
        const scheduledCount = notificationManager.getScheduledCount(threadID);

        await message.reply(
            `✅ **Lên lịch thông báo thành công**\n\n` +
            `📱 **Thread:** ${threadID}\n` +
            `🔔 **Đã lên lịch:** ${scheduledCount} thông báo\n` +
            `📅 **Bao gồm:** Nhắc nhở 7 ngày, 3 ngày, 1 ngày, 6 giờ, 1 giờ\n` +
            `⏰ **Lúc:** ${new Date().toLocaleString('vi-VN')}\n\n` +
            `✨ **Thông báo sẽ được gửi tự động theo lịch trình**`
        );

        Logger.success('NOTIFICATIONS_CMD', 'Scheduled expiry notifications', {
            threadID,
            count: scheduledCount,
            adminUser: userData.name
        });

    } catch (error: any) {
        await message.reply(
            `❌ **Lỗi lên lịch thông báo**\n\n` +
            `📱 **Thread:** ${threadID}\n` +
            `❗ **Lỗi:** ${error.message}\n\n` +
            `🔍 **Nguyên nhân có thể:**\n` +
            `• Thread không có subscription\n` +
            `• Subscription đã hết hạn\n` +
            `• Lỗi kết nối database`
        );
    }
}

async function handleClearNotifications(message: any, args: string[], subscriptionManager: any): Promise<void> {
    if (args.length < 2) {
        return await message.reply(
            `❌ **Thiếu threadID**\n\n` +
            `📝 **Cách sử dụng:** \`!notifications clear <threadID>\`\n\n` +
            `⚠️ **Cảnh báo:** Sẽ xóa TẤT CẢ thông báo đã lên lịch cho thread này`
        );
    }

    const threadID = args[1];

    try {
        const notificationManager = subscriptionManager.getNotificationManager();
        const beforeCount = notificationManager.getScheduledCount(threadID);

        if (beforeCount === 0) {
            return await message.reply(
                `ℹ️ **Thread không có thông báo nào**\n\n` +
                `📱 **Thread:** ${threadID}\n` +
                `🔔 **Thông báo đã lên lịch:** 0`
            );
        }

        notificationManager.clearScheduledNotifications(threadID);

        await message.reply(
            `✅ **Đã xóa thông báo**\n\n` +
            `📱 **Thread:** ${threadID}\n` +
            `🗑️ **Đã xóa:** ${beforeCount} thông báo\n` +
            `⏰ **Lúc:** ${new Date().toLocaleString('vi-VN')}\n\n` +
            `💡 **Lưu ý:** Thread sẽ không nhận thông báo nhắc nhở cho đến khi lên lịch lại`
        );

        Logger.success('NOTIFICATIONS_CMD', 'Cleared scheduled notifications', {
            threadID,
            count: beforeCount,
            adminUser: userData.name
        });

    } catch (error: any) {
        await message.reply(
            `❌ **Lỗi xóa thông báo**\n\n` +
            `Thread: ${threadID}\n` +
            `Lỗi: ${error.message}`
        );
    }
}

// Helper function để chuyển đổi tên mức độ khẩn cấp
function getUrgencyNameVN(urgency: string): string {
    const urgencyNames: Record<string, string> = {
        'low': '🟢 Thấp',
        'medium': '🟡 Trung bình',
        'high': '🟠 Cao',
        'critical': '🔴 Khẩn cấp'
    };

    return urgencyNames[urgency] || urgency;
}

export default notificationsCommand;

// src/scripts/commands/testnotify.ts - Quick test command for notifications
const testNotifyCommand: Command = {
    config: {
        name: 'testnotify',
        aliases: ['testalert'],
        description: 'Test thông báo hết hạn nhanh (Bot Admin only)',
        usage: 'testnotify [type]',
        category: 'admin',
        role: 2,
        cooldown: 10,
        version: '1.0.0',
        author: 'Uranus Bot Team'
    },

    onStart: async ({ args, message, event, userData }: MessageContext) => {
        const subscriptionManager = (global as any).bot.getEnhancedSubscriptionManager();

        if (!subscriptionManager) {
            return await message.reply('❌ Hệ thống thông báo không khả dụng.');
        }

        const notificationType = args[0] || 'final_warning';
        const threadID = event.threadID;

        const validTypes = ['week_warning', 'urgent_warning', 'final_warning', 'last_chance', 'about_to_expire'];

        if (!validTypes.includes(notificationType)) {
            return await message.reply(
                `❌ **Loại thông báo không hợp lệ: "${notificationType}"**\n\n` +
                `📋 **Loại hợp lệ:**\n` +
                validTypes.map(type => `• ${type}`).join('\n') + '\n\n' +
                `💡 **Ví dụ:** \`!testnotify final_warning\``
            );
        }

        try {
            await message.reply(`📤 **Đang gửi test thông báo "${notificationType}"...**`);

            await subscriptionManager.sendTestNotification(threadID, notificationType);

            await message.reply(
                `✅ **Test thông báo thành công!**\n\n` +
                `🔔 **Loại:** ${notificationType}\n` +
                `📱 **Thread:** ${threadID}\n` +
                `👤 **Test bởi:** ${userData.name}\n` +
                `⏰ **Lúc:** ${new Date().toLocaleString('vi-VN')}\n\n` +
                `💡 **Thông báo đã được gửi đến thread này**`
            );

            Logger.success('TEST_NOTIFY', `Admin test notification sent`, {
                type: notificationType,
                threadID,
                adminUser: userData.name
            });

        } catch (error: any) {
            await message.reply(
                `❌ **Lỗi test thông báo**\n\n` +
                `🔔 **Loại:** ${notificationType}\n` +
                `❗ **Lỗi:** ${error.message}\n\n` +
                `🔍 **Kiểm tra:**\n` +
                `• Thread có subscription không?\n` +
                `• Bot có quyền gửi tin nhắn không?\n` +
                `• Database có hoạt động bình thường không?`
            );

            Logger.error('TEST_NOTIFY', 'Test notification failed', {
                type: notificationType,
                threadID,
                error: error.message,
                adminUser: userData.name
            });
        }
    }
};

export { testNotifyCommand };