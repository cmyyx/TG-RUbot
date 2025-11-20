/**
 * Open Wegram Bot - Cloudflare Worker Entry Point
 * A two-way private messaging Telegram bot
 *
 * GitHub Repository: https://github.com/wozulong/open-wegram-bot
 */

import { handleRequest } from './core.js';
import { handleScheduled } from './pinRenewalManager.js';

export default {
    async fetch(request, env, ctx) {
        const config = {
            prefix: env.PREFIX || 'public',
            secretToken: env.SECRET_TOKEN || '',
            childBotUrl: env.CHILD_BOT_URL || '',
            childBotSecretToken: env.CHILD_BOT_SECRET_TOKEN || ''
        };

        return handleRequest(request, config);
    },

    /**
     * Scheduled handler for Cron triggers
     * 定时任务处理函数 - 用于 Cron 触发器
     * 
     * @param {object} event - Cloudflare Workers scheduled event
     * @param {object} env - Environment variables
     * @param {object} ctx - Execution context
     */
    async scheduled(event, env, ctx) {
        await handleScheduled(event, env, ctx);
    }
};