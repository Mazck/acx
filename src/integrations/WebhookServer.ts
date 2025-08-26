// src/integrations/WebhookServer.ts
import express from 'express';
import { PayOSManager } from './PayOSManager';
import { Logger } from '../utils/Logger';
import { DatabaseManager } from '../types/interfaces';

export class WebhookServer {
    private app: express.Application;
    private server: any;
    private payosManager: PayOSManager;
    private port: number;

    constructor(payosManager: PayOSManager, port: number = 3000) {
        this.app = express();
        this.payosManager = payosManager;
        this.port = port;
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // CORS for development
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });

        // Request logging
        this.app.use((req, res, next) => {
            Logger.debug('WEBHOOK', `${req.method} ${req.path}`, {
                body: req.body,
                query: req.query
            });
            next();
        });
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                service: 'uranus-bot-webhook'
            });
        });

        // PayOS webhook endpoint
        this.app.post('/payos/webhook', this.handlePayOSWebhook.bind(this));

        // Payment success page
        this.app.get('/payment/success', this.handlePaymentSuccess.bind(this));

        // Payment cancel page  
        this.app.get('/payment/cancel', this.handlePaymentCancel.bind(this));

        // Subscription status API
        this.app.get('/subscription/:threadId', this.getSubscriptionStatus.bind(this));

        // Admin endpoints (protected)
        this.app.get('/admin/subscriptions', this.getSubscriptionStats.bind(this));
        this.app.post('/admin/subscription/:threadId/activate', this.adminActivateSubscription.bind(this));
        this.app.post('/admin/subscription/:threadId/deactivate', this.adminDeactivateSubscription.bind(this));

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({ error: 'Endpoint not found' });
        });

        // Error handler
        this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
            Logger.error('WEBHOOK', 'Express error', error);
            res.status(500).json({ error: 'Internal server error' });
        });
    }

    private async handlePayOSWebhook(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { code, desc, data } = req.body;

            Logger.info('WEBHOOK', 'PayOS webhook received', {
                code,
                desc,
                orderCode: data?.orderCode
            });

            if (code === '00' && data?.orderCode) {
                // Payment successful
                const success = await this.payosManager.handlePaymentSuccess(data.orderCode);

                if (success) {
                    // Notify the group about successful activation
                    await this.notifySubscriptionActivation(data.orderCode);
                }

                res.json({ error: 0, message: 'success' });
            } else {
                Logger.warn('WEBHOOK', 'PayOS webhook with non-success code', { code, desc });
                res.json({ error: 1, message: 'Payment not successful' });
            }
        } catch (error) {
            Logger.error('WEBHOOK', 'Error handling PayOS webhook', error);
            res.status(500).json({ error: 1, message: 'Internal error' });
        }
    }

    private async handlePaymentSuccess(req: express.Request, res: express.Response): Promise<void> {
        const { orderCode } = req.query;

        try {
            const html = `
        <!DOCTYPE html>
        <html lang="vi">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Thanh toán thành công</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              margin: 0;
              padding: 20px;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
            }
            .container {
              background: white;
              border-radius: 20px;
              padding: 40px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 500px;
              width: 100%;
            }
            .success-icon {
              width: 80px;
              height: 80px;
              background: #4CAF50;
              border-radius: 50%;
              margin: 0 auto 20px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 40px;
              color: white;
            }
            h1 {
              color: #333;
              margin: 0 0 15px 0;
            }
            .order-code {
              background: #f5f5f5;
              padding: 10px;
              border-radius: 8px;
              font-family: monospace;
              font-weight: bold;
              margin: 20px 0;
            }
            .next-steps {
              background: #e3f2fd;
              padding: 20px;
              border-radius: 10px;
              margin: 20px 0;
              text-align: left;
            }
            .btn {
              display: inline-block;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 8px;
              margin: 10px;
              transition: background 0.3s;
            }
            .btn:hover {
              background: #764ba2;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✓</div>
            <h1>Thanh toán thành công!</h1>
            <p>Cảm ơn bạn đã đăng ký sử dụng Uranus Bot</p>
            
            <div class="order-code">
              Mã đơn hàng: ${orderCode}
            </div>
            
            <div class="next-steps">
              <h3>🎉 Tính năng đã được kích hoạt:</h3>
              <ul>
                <li>✅ Bot đã hoạt động trong nhóm của bạn</li>
                <li>✅ Tất cả lệnh đã được mở khóa</li>
                <li>✅ Hệ thống AI đã sẵn sàng</li>
                <li>✅ Tính năng kinh tế đã kích hoạt</li>
              </ul>
              
              <h3>📱 Bước tiếp theo:</h3>
              <ol>
                <li>Quay lại nhóm chat Facebook</li>
                <li>Gõ <code>!help</code> để xem danh sách lệnh</li>
                <li>Gõ <code>!status</code> để kiểm tra trạng thái đăng ký</li>
              </ol>
            </div>
            
            <a href="https://facebook.com" class="btn">Quay lại Facebook</a>
          </div>
        </body>
        </html>
      `;

            res.send(html);
        } catch (error) {
            Logger.error('WEBHOOK', 'Error serving success page', error);
            res.status(500).send('Error loading success page');
        }
    }

    private async handlePaymentCancel(req: express.Request, res: express.Response): Promise<void> {
        const { orderCode } = req.query;

        try {
            const html = `
        <!DOCTYPE html>
        <html lang="vi">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Thanh toán đã hủy</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #ff7b7b 0%, #d63031 100%);
              margin: 0;
              padding: 20px;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
            }
            .container {
              background: white;
              border-radius: 20px;
              padding: 40px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 500px;
              width: 100%;
            }
            .cancel-icon {
              width: 80px;
              height: 80px;
              background: #f44336;
              border-radius: 50%;
              margin: 0 auto 20px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 40px;
              color: white;
            }
            h1 {
              color: #333;
              margin: 0 0 15px 0;
            }
            .info {
              background: #fff3e0;
              padding: 20px;
              border-radius: 10px;
              margin: 20px 0;
              border-left: 4px solid #ff9800;
            }
            .btn {
              display: inline-block;
              padding: 12px 24px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 8px;
              margin: 10px;
              transition: background 0.3s;
            }
            .btn:hover {
              background: #764ba2;
            }
            .btn-secondary {
              background: #6c757d;
            }
            .btn-secondary:hover {
              background: #545b62;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="cancel-icon">✕</div>
            <h1>Thanh toán đã bị hủy</h1>
            <p>Bạn đã hủy quá trình thanh toán</p>
            
            <div class="info">
              <h3>💡 Không sao cả!</h3>
              <p>Bạn có thể thử lại bất cứ lúc nào. Uranus Bot vẫn đang chờ để phục vụ nhóm của bạn.</p>
            </div>
            
            <p><strong>Để thử lại:</strong></p>
            <ol>
              <li>Quay lại nhóm chat Facebook</li>
              <li>Gõ <code>!subscribe</code> để xem gói đăng ký</li>
              <li>Chọn gói phù hợp và thực hiện thanh toán</li>
            </ol>
            
            <a href="https://facebook.com" class="btn">Quay lại Facebook</a>
            <a href="/health" class="btn btn-secondary">Liên hệ hỗ trợ</a>
          </div>
        </body>
        </html>
      `;

            res.send(html);
        } catch (error) {
            Logger.error('WEBHOOK', 'Error serving cancel page', error);
            res.status(500).send('Error loading cancel page');
        }
    }

    private async getSubscriptionStatus(req: express.Request, res: express.Response): Promise<void> {
        try {
            const { threadId } = req.params;
            const { canUse, subscription } = await this.payosManager.canUseBot(threadId);

            res.json({
                threadId,
                canUse,
                subscription: subscription ? {
                    planId: subscription.planId,
                    endDate: subscription.endDate.toISOString(),
                    isActive: subscription.isActive,
                    renewalCount: subscription.renewalCount,
                    totalPaid: subscription.totalPaid
                } : null
            });
        } catch (error) {
            Logger.error('WEBHOOK', 'Error getting subscription status', error);
            res.status(500).json({ error: 'Internal error' });
        }
    }

    private async getSubscriptionStats(req: express.Request, res: express.Response): Promise<void> {
        try {
            // Basic auth check (implement proper authentication)
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== 'Bearer admin-token') {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const stats = await this.payosManager.getSubscriptionStats();
            res.json(stats);
        } catch (error) {
            Logger.error('WEBHOOK', 'Error getting subscription stats', error);
            res.status(500).json({ error: 'Internal error' });
        }
    }

    private async adminActivateSubscription(req: express.Request, res: express.Response): Promise<void> {
        try {
            // Basic auth check
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== 'Bearer admin-token') {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { threadId } = req.params;
            const { planId, userID, days } = req.body;

            // Manual activation for admin purposes
            const plan = this.payosManager.getPlan(planId);
            if (!plan) {
                return res.status(400).json({ error: 'Invalid plan' });
            }

            // Create custom plan for manual activation if days specified
            let activationPlan = plan;
            if (days && days !== plan.days) {
                activationPlan = { ...plan, days };
            }

            await this.payosManager.activateSubscription(threadId, planId, userID || 'admin', 0, false);

            res.json({
                success: true,
                message: `Subscription activated for thread ${threadId}`
            });
        } catch (error) {
            Logger.error('WEBHOOK', 'Error in admin activation', error);
            res.status(500).json({ error: 'Internal error' });
        }
    }

    private async adminDeactivateSubscription(req: express.Request, res: express.Response): Promise<void> {
        try {
            // Basic auth check
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== 'Bearer admin-token') {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { threadId } = req.params;
            await this.payosManager.deactivateSubscription(threadId);

            res.json({
                success: true,
                message: `Subscription deactivated for thread ${threadId}`
            });
        } catch (error) {
            Logger.error('WEBHOOK', 'Error in admin deactivation', error);
            res.status(500).json({ error: 'Internal error' });
        }
    }

    private async notifySubscriptionActivation(orderCode: number): Promise<void> {
        try {
            // Get payment data to find thread
            const paymentData = await (global as any).bot.getDatabase().global.get(`payment_${orderCode}`);

            if (!paymentData) {
                Logger.warn('WEBHOOK', `Payment data not found for order ${orderCode}`);
                return;
            }

            const { threadID, planId, isRenewal } = paymentData;
            const plan = this.payosManager.getPlan(planId);

            if (!plan) {
                Logger.warn('WEBHOOK', `Plan ${planId} not found for notification`);
                return;
            }

            // Send notification to the group
            const api = (global as any).bot.getAPI();
            if (!api) {
                Logger.warn('WEBHOOK', 'Bot API not available for notification');
                return;
            }

            const actionText = isRenewal ? 'renewed' : 'activated';
            const notificationMessage = `🎉 **Subscription ${actionText.charAt(0).toUpperCase() + actionText.slice(1)}!**\n\n` +
                `✅ **${plan.name}** is now active\n` +
                `⏰ **Duration:** ${plan.days} days\n` +
                `🤖 **All bot features unlocked!**\n\n` +
                `💡 Use \`!help\` to explore all commands\n` +
                `📊 Use \`!status\` to check your subscription`;

            await api.sendMessage(notificationMessage, threadID);

            Logger.success('WEBHOOK', `Sent activation notification to thread ${threadID}`);
        } catch (error) {
            Logger.error('WEBHOOK', 'Error sending activation notification', error);
        }
    }

    public start(): Promise<void> {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                Logger.success('WEBHOOK', `Webhook server started on port ${this.port}`);
                resolve();
            });
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    Logger.info('WEBHOOK', 'Webhook server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    public getApp(): express.Application {
        return this.app;
    }
}

// src/core/UranusBot.ts - Add PayOS integration (append to existing file)

// Add these imports at the top
import { PayOSManager } from '../integrations/PayOSManager';
import { WebhookServer } from '../integrations/WebhookServer';

// Add these properties to UranusBot class
export class UranusBot extends EventEmitter {
    // ... existing properties ...
    private payosManager?: PayOSManager;
    private webhookServer?: WebhookServer;

    // Add to initialize() method after database init:
    async initialize(): Promise<void> {
        // ... existing initialization code ...

        // Initialize PayOS if enabled
        if (this.config.payos?.enable && this.database) {
            this.payosManager = new PayOSManager(this.database, this.config);
            (global as any).bot.payosManager = this.payosManager;

            // Start webhook server
            if (this.config.payos.webhookUrl) {
                this.webhookServer = new WebhookServer(this.payosManager, 3000);
                await this.webhookServer.start();
            }

            Logger.success('PAYOS', 'PayOS subscription system initialized');
        }

        // ... rest of initialization ...
    }

    // Add to cleanup() method:
    async cleanup(): Promise<void> {
        // ... existing cleanup code ...

        // Stop webhook server
        if (this.webhookServer) {
            await this.webhookServer.stop();
        }

        // ... rest of cleanup ...
    }

    // Add getter for PayOS manager
    getPayOSManager(): PayOSManager | undefined {
        return this.payosManager;
    }
}

// Update config interface in src/types/interfaces.ts
export interface PayOSConfig {
    enable: boolean;
    clientId: string;
    apiKey: string;
    checksumKey: string;
    webhookUrl: string;
    packages: Record<string, {
        name: string;
        price: number;
        days: number;
        description: string;
        features?: string[];
        renewalDiscount?: number;
    }>;
}