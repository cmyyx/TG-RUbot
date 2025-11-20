/**
 * 命令提醒管理器 - 在新话题中发送命令说明
 * Command Reminder Manager - Sends command instructions in new topics
 */

import { postToTelegramApi } from './core.js';

/**
 * 生成命令说明文本（英文）
 * Generate command instruction text in English
 * @returns {string} - 格式化的命令说明文本
 */
export function generateCommandText() {
  const commandText = `**Available Commands:**

➡️\`.!pm_RUbot_ban!.\`⬅️
↗️*Press or Click to copy:*⬆️
**>DESCRIPTION:**
>Block the topic where the command was sent, stop forwarding messages from the corresponding chat, and send a message to inform the other party that they have been banned.||

➡️\`.!pm_RUbot_unban!.\`⬅️
↗️*Press or Click to copy:*⬆️
**>DESCRIPTION:**
>Unblock the topic where the command was sent, and send a message to inform the other party that they have been unbanned.||

➡️\`.!pm_RUbot_silent_ban!.\`⬅️
↗️*Press or Click to copy:*⬆️
**>DESCRIPTION:**
>Block the topic where the command was sent. stop forwarding messages from the corresponding chat.||

➡️\`.!pm_RUbot_silent_unban!.\`⬅️
↗️*Press or Click to copy:*⬆️
**>DESCRIPTION:**
>Unblock the topic where the command was sent.||`;

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
