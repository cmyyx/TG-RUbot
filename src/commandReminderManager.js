/**
 * 命令提醒管理器 - 在新话题中发送命令说明
 * Command Reminder Manager - Sends command instructions in new topics
 */

import { postToTelegramApi } from './core.js';

/**
 * 生成命令说明文本（英文）
 * Generate command instruction text in English
 * @returns {string} - 格式化的命令说明文本（MarkdownV2格式）
 */
export function generateCommandText() {
  // MarkdownV2 格式：使用 * 加粗，特殊字符需要转义
  const commandText = `*Available Commands:*

➡️\`\\.\\!pm\\_RUbot\\_ban\\!\\.\`⬅️
↗️_Press or Click to copy:_⬆️
||Block the topic, stop forwarding messages, and notify the visitor that they have been banned\\.||

➡️\`\\.\\!pm\\_RUbot\\_unban\\!\\.\`⬅️
↗️_Press or Click to copy:_⬆️
||Unblock the topic and notify the visitor that they have been unbanned\\.||

➡️\`\\.\\!pm\\_RUbot\\_silent\\_ban\\!\\.\`⬅️
↗️_Press or Click to copy:_⬆️
||Block the topic silently without notifying the visitor\\.||

➡️\`\\.\\!pm\\_RUbot\\_silent\\_unban\\!\\.\`⬅️
↗️_Press or Click to copy:_⬆️
||Unblock the topic silently without notifying the visitor\\.||`;

  return commandText;
}

/**
 * 发送命令提醒到话题
 * Send command reminder to topic
 * @param {string} botToken - 机器人令牌
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {number} topicId - 话题ID
 * @returns {Promise<boolean>} - 是否发送成功
 */
export async function sendCommandReminder(botToken, superGroupChatId, topicId) {
  try {
    const commandText = generateCommandText();
    
    const sendMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: superGroupChatId,
      message_thread_id: topicId,
      text: commandText,
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    })).json();
    
    if (sendMessageResp.ok) {
      return true;
    } else {
      console.error('Failed to send command reminder:', sendMessageResp);
      return false;
    }
  } catch (error) {
    console.error('Error sending command reminder:', error);
    return false;
  }
}
