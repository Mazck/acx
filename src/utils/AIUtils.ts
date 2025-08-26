import { UserData, ThreadData, MessageContext } from '../types/interfaces';
import { Logger } from './Logger';
import { Utils } from './Utils';

export class AIUtils {

    /**
     * Phân tích tâm trạng của tin nhắn
     */
    static analyzeSentiment(text: string): {
        sentiment: 'positive' | 'negative' | 'neutral';
        confidence: number;
        emotions: string[];
    } {
        if (!text || typeof text !== 'string') {
            return { sentiment: 'neutral', confidence: 0, emotions: [] };
        }

        const positive = {
            vi: ['tốt', 'hay', 'tuyệt', 'cảm ơn', 'yêu', 'thích', 'vui', 'hạnh phúc', 'tuyệt vời', 'xuất sắc'],
            en: ['good', 'great', 'awesome', 'love', 'like', 'happy', 'excellent', 'wonderful', 'fantastic', 'amazing']
        };

        const negative = {
            vi: ['tệ', 'xấu', 'ghét', 'buồn', 'tức giận', 'khó chịu', 'thất vọng', 'tồi tệ'],
            en: ['bad', 'terrible', 'hate', 'sad', 'angry', 'annoying', 'disappointed', 'awful']
        };

        const emotions = {
            vi: {
                'vui': ['vui', 'hạnh phúc', 'vui vẻ', 'phấn khích'],
                'buồn': ['buồn', 'thất vọng', 'chán nản', 'u sầu'],
                'tức giận': ['tức giận', 'giận dữ', 'khó chịu', 'bực bội'],
                'ngạc nhiên': ['ngạc nhiên', 'kinh ngạc', 'bất ngờ', 'choáng váng'],
                'sợ hãi': ['sợ', 'lo lắng', 'kinh hoàng', 'hoảng sợ']
            },
            en: {
                'happy': ['happy', 'joy', 'excited', 'cheerful'],
                'sad': ['sad', 'disappointed', 'depressed', 'melancholy'],
                'angry': ['angry', 'furious', 'annoyed', 'irritated'],
                'surprised': ['surprised', 'amazed', 'shocked', 'astonished'],
                'fearful': ['scared', 'afraid', 'worried', 'anxious']
            }
        };

        const lowerText = text.toLowerCase();
        let positiveScore = 0;
        let negativeScore = 0;
        const detectedEmotions: string[] = [];

        // Đếm từ tích cực
        [...positive.vi, ...positive.en].forEach(word => {
            if (lowerText.includes(word)) positiveScore++;
        });

        // Đếm từ tiêu cực
        [...negative.vi, ...negative.en].forEach(word => {
            if (lowerText.includes(word)) negativeScore++;
        });

        // Phát hiện cảm xúc
        [...Object.entries(emotions.vi), ...Object.entries(emotions.en)].forEach(([emotion, words]) => {
            if (words.some(word => lowerText.includes(word.toLowerCase()))) {
                if (!detectedEmotions.includes(emotion)) {
                    detectedEmotions.push(emotion);
                }
            }
        });

        // Xác định tâm trạng
        let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
        let confidence = 0;

        if (positiveScore > negativeScore) {
            sentiment = 'positive';
            confidence = Math.min(positiveScore / (positiveScore + negativeScore), 0.9);
        } else if (negativeScore > positiveScore) {
            sentiment = 'negative';
            confidence = Math.min(negativeScore / (positiveScore + negativeScore), 0.9);
        } else if (positiveScore === 0 && negativeScore === 0) {
            confidence = 0.1;
        }

        return { sentiment, confidence, emotions: detectedEmotions };
    }

    /**
     * Tạo phản hồi cá nhân hóa dựa trên profile người dùng
     */
    static personalizeResponse(response: string, userData: UserData, context?: any): string {
        let personalized = response;

        // Thêm tên người dùng
        if (userData.name && Math.random() < 0.3) {
            personalized = personalized.replace(/^/, `${userData.name}, `);
        }

        // Điều chỉnh theo level
        const level = Math.floor(Math.sqrt((userData.exp || 0) / 100));
        if (level >= 10) {
            personalized = personalized.replace(/bạn/g, 'pro');
        }

        // Thêm emoji dựa trên sở thích
        const emojiPrefs = userData.data?.emojiPreferences;
        if (emojiPrefs) {
            const favoriteEmoji = Object.entries(emojiPrefs)
                .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0];

            if (favoriteEmoji && Math.random() < 0.2) {
                personalized += ` ${favoriteEmoji}`;
            }
        }

        return personalized;
    }

    /**
     * Tạo gợi ý lệnh dựa trên ngữ cảnh
     */
    static generateCommandSuggestions(context: MessageContext, maxSuggestions: number = 3): string[] {
        const { userData, threadData, event } = context;
        const suggestions: string[] = [];
        const botConfig = (global as any).bot?.getConfig();
        const prefix = botConfig?.prefix || '!';

        // Gợi ý dựa trên nội dung tin nhắn
        const body = (event.body || '').toLowerCase();

        if (body.includes('money') || body.includes('coin') || body.includes('tiền')) {
            suggestions.push(`${prefix}balance - Kiểm tra số dư`);
            suggestions.push(`${prefix}daily - Nhận tiền hàng ngày`);
        }

        if (body.includes('level') || body.includes('xp') || body.includes('kinh nghiệm')) {
            suggestions.push(`${prefix}rank - Xem thứ hạng`);
            suggestions.push(`${prefix}balance - Kiểm tra level`);
        }

        if (body.includes('help') || body.includes('command') || body.includes('lệnh')) {
            suggestions.push(`${prefix}help - Danh sách lệnh`);
        }

        if (body.includes('game') || body.includes('play') || body.includes('chơi')) {
            suggestions.push(`${prefix}game - Mini games`);
            suggestions.push(`${prefix}rps - Oẳn tù tì`);
        }

        // Gợi ý dựa trên stats người dùng
        if ((userData.exp || 0) < 100) {
            suggestions.push(`${prefix}help - Hướng dẫn cho người mới`);
        }

        if ((userData.money || 0) < 1000) {
            suggestions.push(`${prefix}daily - Kiếm tiền hàng ngày`);
        }

        // Gợi ý dựa trên hoạt động nhóm
        if (threadData.isGroup) {
            suggestions.push(`${prefix}rank - Thứ hạng trong nhóm`);
            suggestions.push(`${prefix}aistats group - Thống kê AI nhóm`);
        }

        // Loại bỏ trùng lặp và giới hạn số lượng
        const uniqueSuggestions = [...new Set(suggestions)];
        return uniqueSuggestions.slice(0, maxSuggestions);
    }

    /**
     * Phân tích độ phức tạp của câu hỏi
     */
    static analyzeQuestionComplexity(question: string): {
        complexity: 'simple' | 'moderate' | 'complex';
        type: 'factual' | 'opinion' | 'instruction' | 'conversational';
        topics: string[];
        requiresContext: boolean;
    } {
        const lowerQuestion = question.toLowerCase();

        // Phân loại câu hỏi
        let type: 'factual' | 'opinion' | 'instruction' | 'conversational' = 'conversational';

        const factualIndicators = ['what', 'when', 'where', 'who', 'how many', 'which'];
        const opinionIndicators = ['should', 'better', 'prefer', 'think', 'opinion', 'recommend'];
        const instructionIndicators = ['how to', 'can you', 'please', 'help me', 'show me', 'teach'];

        if (factualIndicators.some(indicator => lowerQuestion.includes(indicator))) {
            type = 'factual';
        } else if (opinionIndicators.some(indicator => lowerQuestion.includes(indicator))) {
            type = 'opinion';
        } else if (instructionIndicators.some(indicator => lowerQuestion.includes(indicator))) {
            type = 'instruction';
        }

        // Độ phức tạp dựa trên độ dài và số từ khóa
        const wordCount = question.split(' ').length;
        const hasMultipleQuestions = (question.match(/\?/g) || []).length > 1;
        const hasComplexWords = /analysis|statistics|comparison|comprehensive|detailed/.test(lowerQuestion);

        let complexity: 'simple' | 'moderate' | 'complex' = 'simple';

        if (wordCount > 20 || hasMultipleQuestions || hasComplexWords) {
            complexity = 'complex';
        } else if (wordCount > 10 || type === 'instruction') {
            complexity = 'moderate';
        }

        // Phát hiện chủ đề
        const topics = this.extractTopicsFromText(question);

        // Kiểm tra xem có cần context không
        const contextIndicators = ['this', 'that', 'previous', 'earlier', 'before', 'above', 'my'];
        const requiresContext = contextIndicators.some(indicator => lowerQuestion.includes(indicator));

        return { complexity, type, topics, requiresContext };
    }

    /**
     * Tạo phản hồi thông minh dựa trên ngữ cảnh
     */
    static generateContextualResponse(
        originalResponse: string,
        context: MessageContext,
        analysisData?: any
    ): string {
        let enhanced = originalResponse;
        const { userData, threadData, event } = context;

        // Thêm thông tin cá nhân hóa
        if (analysisData?.userProfile) {
            const profile = analysisData.userProfile;

            // Điều chỉnh theo style tương tác
            if (profile.interactionStyle === 'formal') {
                enhanced = enhanced.replace(/hey|hi/gi, 'Xin chào');
                enhanced = enhanced.replace(/!/g, '.');
            } else if (profile.interactionStyle === 'casual') {
                enhanced = enhanced.replace(/Hello|Xin chào/g, 'Hey');
            }
        }

        // Thêm context về hoạt động gần đây
        const userStats = userData.data || {};
        if (userStats.lastAIChat) {
            const timeSinceLastChat = Date.now() - userStats.lastAIChat;
            if (timeSinceLastChat > 24 * 60 * 60 * 1000) { // 1 ngày
                enhanced = `Lâu rồi không gặp! ${enhanced}`;
            }
        }

        // Thêm suggestions nếu phản hồi ngắn
        if (enhanced.length < 200) {
            const suggestions = this.generateCommandSuggestions(context, 2);
            if (suggestions.length > 0) {
                enhanced += `\n\n💡 **Gợi ý:**\n${suggestions.slice(0, 2).map(s => `• ${s}`).join('\n')}`;
            }
        }

        return enhanced;
    }

    /**
     * Trích xuất chủ đề từ văn bản
     */
    private static extractTopicsFromText(text: string): string[] {
        const topics: string[] = [];
        const lowerText = text.toLowerCase();

        const topicKeywords = {
            'technology': ['tech', 'computer', 'phone', 'app', 'software', 'ai', 'robot'],
            'gaming': ['game', 'play', 'level', 'score', 'player'],
            'education': ['learn', 'study', 'school', 'book', 'exam'],
            'entertainment': ['movie', 'music', 'song', 'film', 'video'],
            'social': ['friend', 'family', 'people', 'chat', 'talk'],
            'health': ['health', 'sick', 'doctor', 'medicine', 'exercise'],
            'food': ['food', 'eat', 'cook', 'recipe', 'hungry'],
            'travel': ['travel', 'trip', 'country', 'city', 'visit'],
            'work': ['work', 'job', 'office', 'business', 'career'],
            'money': ['money', 'coin', 'price', 'buy', 'sell', 'expensive']
        };

        for (const [topic, keywords] of Object.entries(topicKeywords)) {
            if (keywords.some(keyword => lowerText.includes(keyword))) {
                topics.push(topic);
            }
        }

        return topics;
    }

    /**
     * Tối ưu hóa độ dài phản hồi
     */
    static optimizeResponseLength(response: string, maxLength: number = 2000, minLength: number = 50): string {
        if (response.length <= maxLength && response.length >= minLength) {
            return response;
        }

        if (response.length > maxLength) {
            // Cắt ngắn phản hồi
            const sentences = response.split(/[.!?]+/);
            let optimized = '';

            for (const sentence of sentences) {
                if ((optimized + sentence).length > maxLength - 50) {
                    break;
                }
                optimized += sentence + '. ';
            }

            return optimized.trim() + '...';
        }

        if (response.length < minLength) {
            // Mở rộng phản hồi
            const expansions = [
                ' Bạn có muốn biết thêm gì không?',
                ' Hy vọng thông tin này hữu ích cho bạn!',
                ' Có câu hỏi gì khác tôi có thể giúp không?'
            ];

            return response + Utils.getRandomElement(expansions);
        }

        return response;
    }

    /**
     * Phát hiện ngôn ngữ và đề xuất phản hồi phù hợp
     */
    static detectLanguageAndAdapt(text: string): {
        language: 'vi' | 'en' | 'mixed' | 'unknown';
        confidence: number;
        suggestion: string;
    } {
        if (!text) {
            return { language: 'unknown', confidence: 0, suggestion: 'auto' };
        }

        const vietnameseChars = text.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi) || [];
        const englishWords = text.match(/\b[a-zA-Z]+\b/g) || [];
        const vietnameseWords = text.match(/\b[a-zA-Zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+\b/gi) || [];

        const vietnameseRatio = vietnameseChars.length / text.length;
        const hasVietnameseChars = vietnameseChars.length > 0;
        const englishRatio = englishWords.length / vietnameseWords.length;

        let language: 'vi' | 'en' | 'mixed' | 'unknown';
        let confidence: number;

        if (hasVietnameseChars && vietnameseRatio > 0.1) {
            if (englishRatio > 0.3) {
                language = 'mixed';
                confidence = 0.7;
            } else {
                language = 'vi';
                confidence = Math.min(0.9, 0.5 + vietnameseRatio);
            }
        } else if (englishWords.length > text.length * 0.3) {
            language = 'en';
            confidence = Math.min(0.9, englishRatio / 2);
        } else {
            language = 'unknown';
            confidence = 0.1;
        }

        // Đề xuất cách phản hồi
        let suggestion = 'auto';
        if (language === 'vi' && confidence > 0.7) {
            suggestion = 'respond_in_vietnamese';
        } else if (language === 'en' && confidence > 0.7) {
            suggestion = 'respond_in_english';
        } else if (language === 'mixed') {
            suggestion = 'respond_in_mixed';
        }

        return { language, confidence, suggestion };
    }

    /**
     * Tạo báo cáo chi tiết về tương tác AI
     */
    static generateInteractionReport(userData: UserData, timeframe: 'day' | 'week' | 'month' = 'week'): string {
        const data = userData.data || {};
        const aiInteractions = data.aiInteractions || 0;
        const autoAIResponses = data.autoAIResponses || 0;
        const lastAIChat = data.lastAIChat || 0;
        const interests = data.interests || {};
        const emojiPrefs = data.emojiPreferences || {};

        const level = Math.floor(Math.sqrt((userData.exp || 0) / 100));
        const activityScore = data.activityScore || 0;

        let timeframeText = 'tuần';
        if (timeframe === 'day') timeframeText = 'ngày';
        if (timeframe === 'month') timeframeText = 'tháng';

        const report =
            `📊 **Báo cáo tương tác AI (${timeframeText})**\n\n` +
            `👤 **Người dùng:** ${userData.name}\n` +
            `🎯 **Level:** ${level} (${Utils.formatNumber(userData.exp || 0)} XP)\n` +
            `💰 **Balance:** ${Utils.formatNumber(userData.money || 0)} coins\n` +
            `📊 **Activity Score:** ${activityScore}/100\n\n` +

            `🤖 **AI Interactions:**\n` +
            `• Tổng tương tác: ${Utils.formatNumber(aiInteractions)}\n` +
            `• Auto responses: ${Utils.formatNumber(autoAIResponses)}\n` +
            `• Lần cuối: ${lastAIChat ? Utils.getTimeAgo(lastAIChat) : 'Chưa có'}\n\n` +

            `🎯 **Sở thích:** ${Object.entries(interests)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 3)
                .map(([topic]) => topic)
                .join(', ') || 'Chưa xác định'}\n\n` +

            `😊 **Emoji yêu thích:** ${Object.entries(emojiPrefs)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 5)
                .map(([emoji]) => emoji)
                .join(' ') || 'Chưa có'}`;

        return report;
    }

    /**
     * Làm sạch và chuẩn hóa văn bản đầu vào
     */
    static sanitizeInput(text: string): string {
        if (!text || typeof text !== 'string') return '';

        return text
            .trim()
            .replace(/\s+/g, ' ') // Normalize spaces
            .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF.,!?'"()\-]/g, '') // Keep safe characters
            .substring(0, 4000); // Limit length
    }

    /**
     * Kiểm tra nội dung có phù hợp không
     */
    static isContentSafe(text: string): {
        isSafe: boolean;
        reasons: string[];
        risk: 'low' | 'medium' | 'high';
    } {
        const reasons: string[] = [];
        let risk: 'low' | 'medium' | 'high' = 'low';

        const unsafePatterns = [
            { pattern: /\b(hate|kill|die|suicide)\b/i, reason: 'Violent content', level: 'high' },
            { pattern: /\b(fuck|shit|damn)\b/i, reason: 'Profanity', level: 'medium' },
            { pattern: /\b(sex|porn|adult)\b/i, reason: 'Adult content', level: 'high' },
            { pattern: /(spam|scam|click here)/i, reason: 'Spam/Scam', level: 'medium' }
        ];

        for (const { pattern, reason, level } of unsafePatterns) {
            if (pattern.test(text)) {
                reasons.push(reason);
                if (level === 'high') risk = 'high';
                else if (level === 'medium' && risk === 'low') risk = 'medium';
            }
        }

        return {
            isSafe: reasons.length === 0,
            reasons,
            risk
        };
    }

    /**
     * Tạo ID duy nhất cho phiên AI
     */
    static generateSessionID(): string {
        return `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Tính toán độ tương đồng giữa hai văn bản
     */
    static calculateSimilarity(text1: string, text2: string): number {
        if (!text1 || !text2) return 0;

        const words1 = text1.toLowerCase().split(/\s+/);
        const words2 = text2.toLowerCase().split(/\s+/);

        const set1 = new Set(words1);
        const set2 = new Set(words2);

        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        return intersection.size / union.size;
    }
}