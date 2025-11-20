/**
 * Pin Renewal Manager
 * 置顶续期管理器 - 负责自动更新元数据置顶消息以防止过期
 */

import { postToTelegramApi } from './core.js';

/**
 * 计算消息年龄（天数）
 * Calculate message age in days
 * 
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {number} Age in days
 */
export function calculateMessageAge(timestamp) {
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const ageInSeconds = now - timestamp;
  const ageInDays = Math.floor(ageInSeconds / (24 * 60 * 60));
  return ageInDays;
}

/**
 * 检查并在需要时续期置顶消息
 * Check and renew pinned message if needed
 * 
 * @param {string} botToken - Telegram bot token
 * @param {string} ownerUid - Owner user ID
 * @returns {Promise<{success: boolean, renewed: boolean, message?: string}>}
 */
export async function checkAndRenewPin(botToken, ownerUid) {
  try {
    // 获取管理员私聊中的置顶消息
    // Get pinned message from owner's private chat
    const getChatResp = await postToTelegramApi(botToken, 'getChat', {
      chat_id: parseInt(ownerUid)
    });
    
    const getChatResult = await getChatResp.json();
    
    if (!getChatResult.ok) {
      return {
        success: false,
        renewed: false,
        message: `Failed to get chat: ${getChatResult.description}`
      };
    }
    
    const pinnedMessage = getChatResult.result.pinned_message;
    
    if (!pinnedMessage) {
      return {
        success: false,
        renewed: false,
        message: 'No pinned message found'
      };
    }
    
    // 计算消息年龄
    // Calculate message age
    const messageAge = calculateMessageAge(pinnedMessage.date);
    
    // 如果消息年龄超过6天，执行续期
    // If message age exceeds 6 days, perform renewal
    if (messageAge > 6) {
      const metadataContent = pinnedMessage.text;
      
      // 创建新的元数据消息
      // Create new metadata message
      const sendMessageResp = await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: parseInt(ownerUid),
        text: metadataContent
      });
      
      const sendMessageResult = await sendMessageResp.json();
      
      if (!sendMessageResult.ok) {
        return {
          success: false,
          renewed: false,
          message: `Failed to send new message: ${sendMessageResult.description}`
        };
      }
      
      const newMessageId = sendMessageResult.result.message_id;
      
      // 置顶新消息
      // Pin new message
      const pinResp = await postToTelegramApi(botToken, 'pinChatMessage', {
        chat_id: parseInt(ownerUid),
        message_id: newMessageId,
        disable_notification: true
      });
      
      const pinResult = await pinResp.json();
      
      if (!pinResult.ok) {
        return {
          success: false,
          renewed: false,
          message: `Failed to pin new message: ${pinResult.description}`
        };
      }
      
      // 取消置顶旧消息
      // Unpin old message
      const unpinResp = await postToTelegramApi(botToken, 'unpinChatMessage', {
        chat_id: parseInt(ownerUid),
        message_id: pinnedMessage.message_id
      });
      
      const unpinResult = await unpinResp.json();
      
      if (!unpinResult.ok) {
        // 即使取消置顶失败，续期操作也算成功
        // Even if unpinning fails, renewal is considered successful
        return {
          success: true,
          renewed: true,
          message: `Pin renewed but failed to unpin old message: ${unpinResult.description}`
        };
      }
      
      return {
        success: true,
        renewed: true,
        message: `Pin renewed successfully. Old message age: ${messageAge} days`
      };
    }
    
    // 消息年龄未超过6天，无需续期
    // Message age is within 6 days, no renewal needed
    return {
      success: true,
      renewed: false,
      message: `Pin is fresh. Message age: ${messageAge} days`
    };
    
  } catch (error) {
    return {
      success: false,
      renewed: false,
      message: `Error during pin renewal: ${error.message}`
    };
  }
}

/**
 * Cron 处理函数 - 每周执行一次
 * Cron handler function - executes weekly
 * 
 * @param {object} _event - Cloudflare Workers scheduled event (unused)
 * @param {object} env - Environment variables
 * @param {object} _ctx - Execution context (unused)
 */
export async function handleScheduled(_event, env, _ctx) {
  // 从环境变量获取机器人配置
  // Get bot configuration from environment variables
  const botToken = env.BOT_TOKEN;
  const ownerUid = env.OWNER_UID;
  
  if (!botToken || !ownerUid) {
    console.error('Missing BOT_TOKEN or OWNER_UID in environment variables');
    return;
  }
  
  // 执行置顶续期检查
  // Execute pin renewal check
  const result = await checkAndRenewPin(botToken, ownerUid);
  
  if (result.success) {
    console.log(`Pin renewal check completed: ${result.message}`);
  } else {
    console.error(`Pin renewal check failed: ${result.message}`);
  }
}
