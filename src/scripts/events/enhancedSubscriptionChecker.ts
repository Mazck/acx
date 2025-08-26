// src/scripts/events/enhancedSubscriptionChecker.ts - Enhanced version with smart notifications
import { MessageContext } from '../../types/interfaces';
import { PayOSManager } from '../../integrations/PayOSManager';
import { PromoCodeManager } from '../../integrations/PromoCodeManager';
import { Logger } from '../../utils/Logger';
import { Utils } from '../../utils/Utils';

const enhancedSubscriptionChecker = {
    config: {
        name: 'enhancedSubscriptionChecker',
        description: 'Kiểm tra subscription và gửi thông báo thông minh về hạn sử dụng',
        category: 'events',
        version: '3.0.0',
        author: 'Uranus Bot Team'
    },

    onChat: async ({ event, message, prefix, userData, threadData }: MessageContext) => {
        // Bỏ qua nếu không phải lệnh
        if (!event.body || !event.body.startsWith(prefix)) {
            return;
        }

        const payosManager = (global as any).bot.getPayOSManager() as PayOSManager;
        const promoManager = (global as any).bot.promoCodeManager as PromoCodeManager;

        if (!payosManager) {
            return; // Hệ thống subscription không được bật
        }

        // Trích xuất tên lệnh
        const args = event.body.slice(prefix.length).trim().split(/\s+/);
        const commandName = args[0]?.toLowerCase();

        // Cho phép các lệnh liên quan đến subscription và lệnh cơ bản
        const allowedCommands = [
            'subscribe', 'sub', 'plans', 'pricing',
            'renew', 'renewal', 'extend', 'redeem', 'promo', 'code', 'coupon', 'promocode',
            'status', 'subscription', 'sub-status', 'plan',
            'help', 'h', 'commands', 'cmd', 'menu', 'smarthelp', 'ihelp', 'interactive', 'guide',
            'ping', 'pong', 'latency'
        ];

        if (allowedCommands.includes(commandName)) {
            return;
        }

        // Kiểm tra trạng thái subscription với log chi tiết
        const { canUse, reason, subscription } = await payosManager.canUseBot(event.threadID);

        if (!canUse) {
            Logger.info('SUBSCRIPTION_BLOCK', `Chặn lệnh "${commandName}" cho thread ${event.threadID}`, {
                reason,
                userName: userData.name,
                subscription: subscription ? {
                    planId: subscription.planId,
                    endDate: subscription.endDate,
                    isActive: subscription.isActive
                } : null
            });

            let blockedMessage = '';

            switch (reason) {
                case 'NO_SUBSCRIPTION':
                    blockedMessage = await buildNoSubscriptionMessageVN(prefix, promoManager, event.threadID, userData.name);
                    break;

                case 'SUBSCRIPTION_EXPIRED':
                    blockedMessage = await buildExpiredSubscriptionMessageVN(prefix, payosManager, promoManager, subscription, event.threadID, userData.name);
                    break;

                case 'SUBSCRIPTION_INACTIVE':
                    blockedMessage = await buildInactiveSubscriptionMessageVN(prefix, promoManager, event.threadID, userData.name);
                    break;

                default:
                    blockedMessage = buildErrorMessageVN(prefix, userData.name);
            }

            return async () => {
                await message.reply(blockedMessage);
            };
        }

        // Kiểm tra subscription sắp hết hạn và gửi nhắc nhở thông minh
        if (subscription) {
            const now = new Date();
            const timeUntilExpiry = subscription.endDate.getTime() - now.getTime();
            const daysLeft = Math.ceil(timeUntilExpiry / (24 * 60 * 60 * 1000));
            const hoursLeft = Math.ceil(timeUntilExpiry / (60 * 60 * 1000));

            // Gửi nhắc nhở dựa trên thời gian còn lại
            if (shouldSendExpiryReminder(daysLeft, hoursLeft)) {
                setTimeout(async () => {
                    try {
                        const reminderMessage = await buildSmartExpiryReminder(
                            prefix, payosManager, promoManager, subscription, daysLeft, hoursLeft, userData.name
                        );

                        // Kiểm tra xem đã gửi nhắc nhở gần đây chưa
                        const lastReminderKey = `last_reminder_${event.threadID}`;
                        const lastReminder = await getLastReminder(lastReminderKey);

                        // Chỉ gửi nếu chưa gửi trong 4 tiếng
                        if (!lastReminder || (Date.now() - lastReminder.timestamp) > 4 * 60 * 60 * 1000) {
                            await message.reply(reminderMessage);
                            await recordReminder(lastReminderKey, daysLeft);

                            Logger.success('EXPIRY_REMINDER', `Gửi nhắc nhở hết hạn cho thread ${event.threadID}`, {
                                daysLeft,
                                hoursLeft,
                                userName: userData.name,
                                planId: subscription.planId
                            });
                        }
                    } catch (error) {
                        Logger.error('EXPIRY_REMINDER', 'Lỗi gửi nhắc nhở hết hạn', error);
                    }
                }, 1000);
            }
        }
    }
};

// Kiểm tra có nên gửi nhắc nhở không
function shouldSendExpiryReminder(daysLeft: number, hoursLeft: number): boolean {
    // Gửi nhắc nhở khi:
    // - Còn 7, 3, 1 ngày
    // - Còn 6, 3, 1 giờ
    return [7, 3, 1].includes(daysLeft) ||
        (daysLeft === 0 && [6, 3, 1].includes(hoursLeft));
}

// Xây dựng tin nhắn cho nhóm chưa có subscription
async function buildNoSubscriptionMessageVN(
    prefix: string,
    promoManager: PromoCodeManager | undefined,
    threadID: string,
    userName: string
): Promise<string> {
    let message = `🔒 **${userName} ơi, nhóm chưa kích hoạt bot!**\n\n` +
        `😅 Để sử dụng lệnh này, nhóm cần có gói dịch vụ hoạt động.\n\n`;

    // Thêm gợi ý mã khuyến mãi nếu có
    if (promoManager) {
        try {
            const suggestions = await promoManager.getPromoSuggestions(threadID);
            const freeActivationExists = suggestions.some(p => p.type === 'free_activation');
            const bigDiscountExists = suggestions.some(p => p.type === 'discount' && p.value >= 50);

            if (freeActivationExists || bigDiscountExists) {
                message += `🎁 **KHUYẾN MÃI ĐẶC BIỆT CHỈ CHO NHÓM NÀY:**\n`;

                for (const promo of suggestions.slice(0, 2)) {
                    if (promo.type === 'free_activation') {
                        message += `🆓 \`${prefix}redeem ${promo.code}\` - **KÍCH HOẠT MIỄN PHÍ!**\n`;
                    } else if (promo.type === 'discount' && promo.value >= 50) {
                        message += `💰 \`${prefix}redeem ${promo.code}\` - **GIẢM ${promo.value}%!**\n`;
                    }
                }
                message += `\n`;
            }
        } catch (error) {
            Logger.warn('SUBSCRIPTION_BLOCK', 'Không thể tải gợi ý khuyến mãi', error);
        }
    }

    message += `🆓 **DÙNG THỬ MIỄN PHÍ 7 NGÀY:**\n` +
        `🎁 \`${prefix}subscribe trial\` - Kích hoạt ngay lập tức\n\n` +

        `💎 **HOẶC CHỌN GÓI TRẢI NGHIỆM FULL:**\n` +
        `📦 \`${prefix}subscribe\` - Xem tất cả gói với giá ưu đãi\n\n` +

        `💡 **Tại sao cần đăng ký?**\n` +
        `• 🤖 Mở khóa toàn bộ tính năng AI\n` +
        `• 🎮 Truy cập game và giải trí cao cấp\n` +
        `• 💰 Hệ thống kinh tế phong phú\n` +
        `• 🛠️ Công cụ quản lý nhóm mạnh mẽ\n` +
        `• 💬 Hỗ trợ ưu tiên từ team phát triển`;

    return message;
}

// Tin nhắn cho subscription đã hết hạn
async function buildExpiredSubscriptionMessageVN(
    prefix: string,
    payosManager: PayOSManager,
    promoManager: PromoCodeManager | undefined,
    subscription: any,
    threadID: string,
    userName: string
): Promise<string> {
    const plan = payosManager.getPlan(subscription!.planId);
    const renewalDiscount = plan?.renewalDiscount || 10;
    const expiredDate = new Date(subscription!.endDate).toLocaleDateString('vi-VN');

    let message = `😢 **${userName}, gói dịch vụ đã hết hạn!**\n\n` +
        `📅 **Hết hạn từ:** ${expiredDate}\n` +
        `📦 **Gói cũ:** ${plan?.name || subscription!.planId}\n\n`;

    // Thêm mã khuyến mãi đặc biệt cho khách cũ
    if (promoManager) {
        try {
            const suggestions = await promoManager.getPromoSuggestions(threadID);
            const comebackOffersExist = suggestions.some(p =>
                (p.type === 'discount' && p.value >= 25) ||
                p.type === 'free_activation'
            );

            if (comebackOffersExist) {
                message += `🎊 **CHƯƠNG TRÌNH CHÀO MỪNG TRỞ LẠI:**\n`;
                for (const promo of suggestions.slice(0, 2)) {
                    if (promo.type === 'discount' && promo.value >= 25) {
                        message += `💸 \`${prefix}redeem ${promo.code}\` - **GIẢM ${promo.value}%** (Đặc biệt cho khách cũ!)\n`;
                    } else if (promo.type === 'free_activation') {
                        message += `🎁 \`${prefix}redeem ${promo.code}\` - **KÍCH HOẠT MIỄN PHÍ** trở lại!\n`;
                    }
                }
                message += `\n`;
            }
        } catch (error) {
            Logger.warn('SUBSCRIPTION_BLOCK', 'Không thể tải ưu đãi comeback', error);
        }
    }

    message += `🔄 **GIA HẠN NHANH CHÓNG:**\n` +
        `✨ \`${prefix}renew\` - Gia hạn cùng gói với **GIẢM ${renewalDiscount}%**\n` +
        `📈 \`${prefix}subscribe\` - Nâng cấp lên gói cao hơn\n\n` +

        `💔 **Bạn đang bỏ lỡ:**\n` +
        `• 🤖 Tính năng AI thông minh\n` +
        `• 🎮 Game giải trí hấp dẫn\n` +
        `• 💰 Hệ thống kinh tế phong phú\n` +
        `• 🏆 Bảng xếp hạng và thành tích\n\n` +

        `🎯 **Khách hàng cũ như ${userName} luôn được ưu tiên!**\n` +
        `💝 Gia hạn ngay để nhận lại tất cả quyền lợi!`;

    return message;
}

// Tin nhắn cho subscription không hoạt động
async function buildInactiveSubscriptionMessageVN(
    prefix: string,
    promoManager: PromoCodeManager | undefined,
    threadID: string,
    userName: string
): Promise<string> {
    let message = `⚠️ **${userName}, có vấn đề với gói dịch vụ!**\n\n` +
        `🔧 Gói đăng ký hiện tại không hoạt động.\n` +
        `📞 Đây có thể là lỗi hệ thống hoặc vấn đề thanh toán.\n\n`;

    // Kiểm tra mã kích hoạt lại miễn phí
    if (promoManager) {
        try {
            const suggestions = await promoManager.getPromoSuggestions(threadID);
            const reactivationExists = suggestions.some(p => p.type === 'free_activation');

            if (reactivationExists) {
                message += `🆓 **KÍCH HOẠT LẠI MIỄN PHÍ:**\n`;
                for (const promo of suggestions.slice(0, 1)) {
                    if (promo.type === 'free_activation') {
                        message += `🎁 \`${prefix}redeem ${promo.code}\` - ${promo.description}\n`;
                    }
                }
                message += `\n`;
            }
        } catch (error) {
            Logger.warn('SUBSCRIPTION_BLOCK', 'Không thể tải mã kích hoạt lại', error);
        }
    }

    message += `🔧 **GIẢI PHÁP:**\n` +
        `🔄 \`${prefix}renew\` - Gia hạn gói hiện tại\n` +
        `📦 \`${prefix}subscribe\` - Chọn gói mới\n` +
        `📞 **Liên hệ admin** nếu vấn đề vẫn tiếp tục\n\n` +

        `💌 **Chúng tôi xin lỗi vì sự bất tiện này!**\n` +
        `🎯 Hãy thử các lệnh trên hoặc liên hệ hỗ trợ.`;

    return message;
}

// Tin nhắn lỗi chung
function buildErrorMessageVN(prefix: string, userName: string): string {
    return `❌ **${userName}, có lỗi xảy ra!**\n\n` +
        `🔧 Không thể kiểm tra trạng thái đăng ký hiện tại.\n\n` +

        `🔍 **THỬ CÁC BƯỚC SAU:**\n` +
        `1. \`${prefix}status\` - Kiểm tra trạng thái chi tiết\n` +
        `2. \`${prefix}ping\` - Kiểm tra kết nối bot\n` +
        `3. Thử lại sau vài phút\n\n` +

        `📞 **Nếu vấn đề vẫn tiếp tục:**\n` +
        `Liên hệ admin với mã lỗi: \`SUB_CHECK_ERROR_${Date.now()}\``;
}

// Xây dựng nhắc nhở thông minh về hạn sử dụng
async function buildSmartExpiryReminder(
    prefix: string,
    payosManager: PayOSManager,
    promoManager: PromoCodeManager | undefined,
    subscription: any,
    daysLeft: number,
    hoursLeft: number,
    userName: string
): Promise<string> {
    const plan = payosManager.getPlan(subscription.planId);
    const renewalDiscount = plan?.renewalDiscount || 10;
    let urgencyLevel = 'low';

    // Xác định mức độ khẩn cấp
    if (hoursLeft <= 6) urgencyLevel = 'critical';
    else if (daysLeft === 1) urgencyLevel = 'high';
    else if (daysLeft <= 3) urgencyLevel = 'medium';

    let message = '';

    // Tiêu đề dựa trên mức độ khẩn cấp
    switch (urgencyLevel) {
        case 'critical':
            message = `🚨🚨 **${userName.toUpperCase()}, KHẨN CẤP!** 🚨🚨\n\n`;
            if (hoursLeft <= 1) {
                message += `💥 **CÒN ${hoursLeft} GIỜ CUỐI CÙNG!**\n`;
            } else {
                message += `⏰ **CÒN ${hoursLeft} GIỜ!**\n`;
            }
            break;
        case 'high':
            message = `🚨 **${userName}, chú ý quan trọng!**\n\n`;
            message += `⏰ **CÒN 1 NGÀY CUỐI!**\n`;
            break;
        case 'medium':
            message = `⚠️ **${userName}, nhắc nhở gia hạn**\n\n`;
            message += `📅 **Còn ${daysLeft} ngày nữa hết hạn**\n`;
            break;
        default:
            message = `📅 **${userName}, thời gian gia hạn đã đến!**\n\n`;
            message += `⏰ **Còn ${daysLeft} ngày**\n`;
    }

    message += `📦 **Gói:** ${plan?.name || subscription.planId}\n\n`;

    // Nội dung dựa trên mức độ khẩn cấp
    if (urgencyLevel === 'critical') {
        message += await buildCriticalReminderContent(prefix, renewalDiscount, hoursLeft);
    } else if (urgencyLevel === 'high') {
        message += await buildHighReminderContent(prefix, renewalDiscount);
    } else {
        message += await buildNormalReminderContent(prefix, renewalDiscount, daysLeft);
    }

    // Thêm mã khuyến mãi cho trường hợp khẩn cấp
    if (urgencyLevel === 'critical' || urgencyLevel === 'high') {
        if (promoManager) {
            try {
                const urgentPromos = await getUrgentPromoCodesVN(promoManager, subscription.threadID, prefix);
                if (urgentPromos) {
                    message += `\n${urgentPromos}`;
                }
            } catch (error) {
                Logger.warn('EXPIRY_REMINDER', 'Không thể tải mã khuyến mãi khẩn cấp', error);
            }
        }
    }

    return message;
}

async function buildCriticalReminderContent(prefix: string, renewalDiscount: number, hoursLeft: number): Promise<string> {
    if (hoursLeft <= 1) {
        return `💥 **KHÔNG CÒN THỜI GIAN!**\n\n` +
            `🆘 **HÀNH ĐỘNG NGAY:**\n` +
            `⚡ \`${prefix}renew\` - Gia hạn tức thì\n` +
            `📞 **GỌI ADMIN NGAY** nếu cần hỗ trợ\n\n` +
            `💀 **SAU ${hoursLeft} GIỜ NỮA:**\n` +
            `• 🚫 Bot sẽ BỊ VỔ HIỆU HÓA hoàn toàn\n` +
            `• 💸 MẤT HẾT ưu đãi khách hàng cũ\n` +
            `• 🔒 Tất cả dữ liệu bị ĐÓNG BĂNG\n\n` +
            `🚨 **GIA HẠN NGAY HOẶC MẤT TẤT CẢ!**`;
    } else {
        return `⚡ **${hoursLeft} GIỜ CUỐI CÙNG!**\n\n` +
            `🚨 **GIA HẠN KHẨN CẤP:**\n` +
            `🔄 \`${prefix}renew\` - Giảm ${renewalDiscount}% (Nhanh nhất!)\n` +
            `📞 Liên hệ admin nếu gặp khó khăn\n\n` +
            `💔 **Sau khi hết hạn:**\n` +
            `• Bot ngừng hoạt động hoàn toàn\n` +
            `• Mất ưu đãi khách hàng thân thiết\n` +
            `• Phải đăng ký lại như người mới\n\n` +
            `🎯 **GIA HẠN NGAY ĐỂ GIỮ QUYỀN LỢI!**`;
    }
}

async function buildHighReminderContent(prefix: string, renewalDiscount: number): Promise<string> {
    return `🚨 **NGÀY CUỐI CÙNG!**\n\n` +
        `⚠️ **Đây là cơ hội cuối để gia hạn với ưu đãi!**\n\n` +

        `⚡ **GIA HẠN NGAY:**\n` +
        `🔄 \`${prefix}renew\` - Ưu đãi ${renewalDiscount}% cho khách cũ\n` +
        `📈 \`${prefix}subscribe premium\` - Nâng cấp để được nhiều hơn\n\n` +

        `💔 **Từ ngày mai bot sẽ:**\n` +
        `• ❌ Ngừng phản hồi tất cả lệnh\n` +
        `• 🔒 Khóa hệ thống AI và game\n` +
        `• 📊 Đóng băng tiến trình economy\n\n` +

        `💝 **Gia hạn ngay để:**\n` +
        `• ✅ Giữ nguyên tất cả dữ liệu\n` +
        `• 🎁 Nhận ưu đãi khách hàng thân thiết\n` +
        `• 🚀 Tiếp tục trải nghiệm premium`;
}

async function buildNormalReminderContent(prefix: string, renewalDiscount: number, daysLeft: number): Promise<string> {
    return `💡 **Thời gian gia hạn thuận lợi!**\n\n` +
        `🎉 **Ưu đãi gia hạn sớm:**\n` +
        `🔄 \`${prefix}renew\` - Giảm ${renewalDiscount}% cho khách thân thiết\n` +
        `📦 \`${prefix}subscribe\` - Khám phá các gói khác\n\n` +

        `✨ **Lợi ích gia hạn sớm:**\n` +
        `• 🛡️ Đảm bảo dịch vụ không gián đoạn\n` +
        `• 💎 Tích lũy điểm thân thiết cho lần sau\n` +
        `• 🎯 Giữ nguyên cài đặt và tiến độ\n\n` +

        `📅 **Còn ${daysLeft} ngày để quyết định**\n` +
        `💌 Cảm ơn bạn đã tin tưởng và sử dụng Uranus Bot!`;
}

// Lấy mã khuyến mãi khẩn cấp
async function getUrgentPromoCodesVN(
    promoManager: PromoCodeManager,
    threadID: string,
    prefix: string
): Promise<string | null> {
    try {
        const suggestions = await promoManager.getPromoSuggestions(threadID);
        const urgentPromos = suggestions.filter(p =>
            (p.type === 'discount' && p.value >= 20) ||
            p.type === 'free_activation' ||
            (p.type === 'extend_days' && p.value >= 5)
        );

        if (urgentPromos.length === 0) {
            return null;
        }

        let promoMessage = `🎁 **MÃ KHUYẾN MÃI KHẨN CẤP:**\n`;

        for (const promo of urgentPromos.slice(0, 3)) {
            if (promo.type === 'discount') {
                promoMessage += `💰 \`${prefix}redeem ${promo.code}\` - **GIẢM ${promo.value}%** (Có hạn!)\n`;
            } else if (promo.type === 'free_activation') {
                promoMessage += `🆓 \`${prefix}redeem ${promo.code}\` - **MIỄN PHÍ HOÀN TOÀN!**\n`;
            } else if (promo.type === 'extend_days') {
                promoMessage += `🎊 \`${prefix}redeem ${promo.code}\` - **TẶNG ${promo.value} NGÀY!**\n`;
            }
        }

        promoMessage += `\n⚡ **Sử dụng ngay kẻo hết!**`;
        return promoMessage;

    } catch (error) {
        return null;
    }
}

// Helper functions để quản lý nhắc nhở
async function getLastReminder(key: string): Promise<{ timestamp: number; daysLeft: number } | null> {
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

async function recordReminder(key: string, daysLeft: number): Promise<void> {
    try {
        const database = (global as any).bot.getDatabase();
        if (database) {
            await database.global.set(key, {
                timestamp: Date.now(),
                daysLeft
            });
        }
    } catch (error) {
        Logger.warn('REMINDER_RECORD', 'Không thể ghi lại nhắc nhở', error);
    }
}

export default enhancedSubscriptionChecker;