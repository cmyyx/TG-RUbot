import { allowed_updates, postToTelegramApi, VISITOR_WELCOME_TEXT } from './core';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  parseVerificationStatus,
  initializeVerificationStatus,
  verifyAnswer,
  updateVerificationStatusInMetadata,
  serializeVerificationStatus,
  needsVerification,
  isNewDay
} from './verificationManager.js';
import { sendCommandReminder } from './commandReminderManager.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// ---------------------------------------- MOTHER BOT ----------------------------------------

/**
 * 处理母机器人命令（用于子母模式）
 * Handle mother bot commands (for parent-child bot mode)
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @param {string} childBotUrl - 子机器人 URL
 * @param {string} childBotSecretToken - 子机器人密钥令牌
 * @returns {Promise<Response>}
 */
export async function motherBotCommands(botToken, ownerUid, message, childBotUrl, childBotSecretToken) {
  const sendRespMessage = async function (chat_id, text) {
    return await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: chat_id,
      text: text,
    });
  }

  try {
    if (message.text.startsWith("/install ")) {
      const childBotOwnerId = message.from.id.toString();
      const childBotToken = message.text.split("/install ")[1];
      const setWebhookResp = await (await postToTelegramApi(childBotToken, 'setWebhook', {
        url: `${childBotUrl.endsWith('/') ? childBotUrl.slice(0, -1) : childBotUrl}/webhook/${childBotOwnerId}/${childBotToken}`,
        allowed_updates: allowed_updates,
        secret_token: childBotSecretToken
      })).json();
      if (setWebhookResp.ok) {
        await sendRespMessage(message.chat.id, `bot ${childBotToken} install success!`);
      } else {
        await sendRespMessage(message.chat.id, `bot ${childBotToken} install failed! ${JSON.stringify(setWebhookResp)}`);
      }
    } else if (message.text.startsWith("/uninstall ")) {
      const childBotToken = message.text.split("/uninstall ")[1];
      const deleteWebhookResp = await (await postToTelegramApi(childBotToken, 'deleteWebhook', {})).json();
      if (deleteWebhookResp.ok) {
        await sendRespMessage(message.chat.id, `bot ${childBotToken} uninstall success!`);
      } else {
        await sendRespMessage(message.chat.id, `bot ${childBotToken} uninstall failed! ${JSON.stringify(deleteWebhookResp)}`);
      }
    } else {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: message.chat.id,
        text: `Has no this command! Try '/install {{botToken}}' OR '/uninstall {{botToken}}'`,
      });
    }
    return new Response('OK');
  } catch (error) {
    console.error('Error handling webhook:', error.message);
    // --- for debugging ---
    // await postToTelegramApi(botToken, 'sendMessage', {
    //     chat_id: ownerUid,
    //     text: `Error handling webhook: ${error.message}`,
    // });
    // --- for debugging ---
    return new Response('OK');
  }
}

// ---------------------------------------- SETTINGS ----------------------------------------

/**
 * 初始化机器人设置
 * Initialize bot settings
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @returns {Promise<Response>}
 */
export async function init(botToken, ownerUid, message) {
  try {
    const supergroupId = message.chat.id;
    const metaDataMessage = supergroupId.toString();

    let failed = false;
    let failedMessage = "init failed, please try again";
    let sendMetaDataMessageResp;
    let pinMetaDataMessageResp;

    const check = await doCheckInit(botToken, ownerUid)
    if (!check.failed) {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: "already init!",
      });
      return new Response('OK');
    }

    sendMetaDataMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: ownerUid,
      text: metaDataMessage,
    })).json();
    if (!sendMetaDataMessageResp.ok) {
      failedMessage += " sendMetaDataMessageResp: " + JSON.stringify(sendMetaDataMessageResp);
      failed = true;
    }
    if (!failed) {
      pinMetaDataMessageResp = await (await postToTelegramApi(botToken, 'pinChatMessage', {
        chat_id: ownerUid,
        message_id: sendMetaDataMessageResp.result.message_id,
      })).json();
      if (!pinMetaDataMessageResp.ok) {
        failedMessage += " pinMetaDataMessageResp: " + JSON.stringify(pinMetaDataMessageResp);
        failed = true;
      }
    }
    return checkInit(botToken, ownerUid, message, failed, failedMessage);
  } catch (error) {
    console.error('Error handling webhook:', error.message);
    // // --- for debugging ---
    // await postToTelegramApi(botToken, 'sendMessage', {
    //     chat_id: ownerUid,
    //     text: `Error handling webhook: ${error.message}`,
    // });
    // // --- for debugging ---
    return new Response('OK');
  }
}

/**
 * 检查初始化状态
 * Check initialization status
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @param {boolean} failed - 是否失败
 * @param {string} failedMessage - 失败消息
 * @returns {Promise<Response>}
 */
export async function checkInit(botToken, ownerUid, message, failed, failedMessage) {
  try {
    const supergroupId = message.chat.id;

    failed = failed || false;
    failedMessage = failedMessage || "init check failed, please do init or try again";
    let checkMetaDataMessageResp;
    if (!failed) {
      const doCheckInitRet = await doCheckInit(botToken, ownerUid, failedMessage, failed);
      checkMetaDataMessageResp = doCheckInitRet.checkMetaDataMessageResp;
      failedMessage = doCheckInitRet.failedMessage;
      failed = doCheckInitRet.failed;
    }
    if (failed) {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: `GROUP ${supergroupId}: ${failedMessage}`,
      });
    } else {
      const { superGroupChatId: superGroupIdFromMetaDataMessage }
          = parseMetaDataMessage(checkMetaDataMessageResp.result.pinned_message);
      if (superGroupIdFromMetaDataMessage !== supergroupId) {
        await postToTelegramApi(botToken, 'sendMessage', {
          chat_id: ownerUid,
          text: `GROUP ${supergroupId}: init failed! Cause already init GROUP ${superGroupIdFromMetaDataMessage}`,
        });
      } else {
        await postToTelegramApi(botToken, 'sendMessage', {
          chat_id: ownerUid,
          text: `GROUP ${supergroupId}: init success!`,
        });
      }
    }
    return new Response('OK');
  } catch (error) {
    console.error('Error handling webhook:', error.message);
    // // --- for debugging ---
    // await postToTelegramApi(botToken, 'sendMessage', {
    //     chat_id: ownerUid,
    //     text: `Error handling webhook: ${error.message}`,
    // });
    // // --- for debugging ---
    return new Response('OK');
  }
}

/**
 * 执行初始化检查
 * Perform initialization check
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {string} failedMessage - 失败消息
 * @param {boolean} failed - 是否失败
 * @returns {Promise<{checkMetaDataMessageResp: object, failedMessage: string, failed: boolean}>}
 */
export async function doCheckInit(botToken, ownerUid, failedMessage, failed) {
  const checkMetaDataMessageResp = await (await postToTelegramApi(botToken, 'getChat', {
    chat_id: ownerUid,
  })).json();

  if (!checkMetaDataMessageResp.ok || !checkMetaDataMessageResp.result.pinned_message?.text) {
    failedMessage += " checkMetaDataMessageResp: " + JSON.stringify(checkMetaDataMessageResp);
    failed = true;
  } else {
    const dateSecondTimestamp = checkMetaDataMessageResp.result.pinned_message?.date;
    if (dateSecondTimestamp) {
      const pinnedMessage = checkMetaDataMessageResp.result.pinned_message;
      const currentSeconds = Math.floor(Date.now() / 1000);
      const dateDiff = currentSeconds - dateSecondTimestamp;
      const days = Math.floor(dateDiff / 60 / 60 / 24);
      if (days > 7) {
        await fixPinMessage(botToken, pinnedMessage.chat.id, pinnedMessage.text, pinnedMessage.message_id)

        const pmGroupId = pinnedMessage.text.split(";")[0];
        const pmGroupChatResp = await (await postToTelegramApi(botToken, 'getChat', {
          chat_id: pmGroupId,
        })).json();
        if (pmGroupChatResp.ok && pmGroupChatResp.result.pinned_message?.text) {
          const pmGroupPinnedMessage = pmGroupChatResp.result.pinned_message;
          await fixPinMessage(botToken, pmGroupPinnedMessage.chat.id, pmGroupPinnedMessage.text, pmGroupPinnedMessage.message_id)
        }
      }
    }
  }
  return { checkMetaDataMessageResp, failedMessage, failed };
}

/**
 * 解析元数据消息
 * Parse metadata message
 * @param {object} metaDataMessage - 元数据消息对象
 * @returns {{superGroupChatId: number, topicToFromChat: Map, fromChatToTopic: Map, bannedTopics: Array, topicToCommentName: Map, fromChatToCommentName: Map}}
 */
export function parseMetaDataMessage(metaDataMessage) {
  const metaDataSplit = metaDataMessage.text.split(";");
  const superGroupChatId = parseInt(metaDataSplit[0]);
  const topicToFromChat = new Map;
  const fromChatToTopic = new Map;
  const topicToCommentName = new Map;
  const fromChatToCommentName = new Map;
  const bannedTopics = [];
  if (metaDataSplit.length > 1) {
    for (let i = 1; i < metaDataSplit.length; i++) {
      const topicToFromChatSplit = metaDataSplit[i].split(":");
      const topic = parseInt(topicToFromChatSplit[0]);
      if (!topic) continue
      let fromChat;
      if (topicToFromChatSplit[1].startsWith('b')) {
        bannedTopics.push(topic);
        fromChat = parseInt(topicToFromChatSplit[1].substring(1));
      } else if (topicToFromChatSplit[1].startsWith('v')) {
        // 处理未验证访客 (Handle unverified visitors)
        // 格式: v{answer}_{attempts}_{lastDate}_{failedDays}_{fromChatId}
        const verificationMatch = topicToFromChatSplit[1].match(/^v\d+_\d+_\d+_\d+_(\d+)$/);
        if (verificationMatch) {
          fromChat = parseInt(verificationMatch[1]);
        } else {
          fromChat = parseInt(topicToFromChatSplit[1]);
        }
      } else {
        fromChat = parseInt(topicToFromChatSplit[1]);
      }
      topicToFromChat.set(topic, fromChat);
      fromChatToTopic.set(fromChat, topic);
      if (topicToFromChatSplit[2]) {
        topicToCommentName.set(topic, topicToFromChatSplit[2]);
        fromChatToCommentName.set(fromChat, topicToFromChatSplit[2]);
      }
    }
  }
  return { superGroupChatId, topicToFromChat, fromChatToTopic, bannedTopics, topicToCommentName, fromChatToCommentName };
}

/**
 * 在元数据中添加话题到访客的映射
 * Add topic to visitor mapping in metadata
 * @param {string} botToken - 机器人令牌
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {string} ownerUid - 所有者用户ID
 * @param {number} topicId - 话题ID
 * @param {number} fromChatId - 访客聊天ID
 * @returns {Promise<{messageText: string}>}
 */
async function addTopicToFromChatOnMetaData(botToken, metaDataMessage, ownerUid, topicId, fromChatId, verificationStatus = null) {
  // 如果提供了验证状态，使用它；否则默认为未验证状态（currentAnswer=0 表示需要初始化）
  let statusPrefix = '';
  if (verificationStatus) {
    statusPrefix = serializeVerificationStatus(fromChatId, verificationStatus);
  } else {
    // 新用户默认添加为未验证状态，currentAnswer=0 表示需要初始化
    statusPrefix = `v0_0_0_0_${fromChatId}`;
  }
  const newText = `${metaDataMessage.text};${topicId}:${statusPrefix}`
  return await editMetaDataMessage(botToken, ownerUid, metaDataMessage, newText);
}

/**
 * 从元数据中清除指定话题的项
 * Clean item from metadata for specified topic
 * @param {string} botToken - 机器人令牌
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {string} ownerUid - 所有者用户ID
 * @param {number} topicId - 话题ID
 * @returns {Promise<{messageText: string}>}
 */
async function cleanItemOnMetaData(botToken, metaDataMessage, ownerUid, topicId) {
  const oldText = metaDataMessage.text;
  let itemStartIndex = oldText.indexOf(`;${topicId}:`) + 1;
  if (itemStartIndex === 0) return { messageText: oldText };
  let itemEndIndex = oldText.indexOf(';', itemStartIndex);
  let newText = itemEndIndex === -1 ? oldText.substring(0, itemStartIndex - 1)
      : oldText.replace(oldText.substring(itemStartIndex, itemEndIndex + 1), '');
  return await editMetaDataMessage(botToken, ownerUid, metaDataMessage, newText);
}

/**
 * 编辑元数据消息
 * Edit metadata message
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {string} newText - 新的文本内容
 * @returns {Promise<{messageText: string}>}
 */
async function editMetaDataMessage(botToken, ownerUid, metaDataMessage, newText) {
  // TODO: 2025/5/10 MAX LENGTH 4096
  const editMessageTextResp = await (await postToTelegramApi(botToken, 'editMessageText', {
    chat_id: ownerUid,
    message_id: metaDataMessage.message_id,
    text: newText,
  })).json();
  if (!editMessageTextResp.ok) {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: ownerUid,
      text: `editMetaDataMessage: editMessageTextResp: ${JSON.stringify(editMessageTextResp)}`,
    });
  }
  metaDataMessage.text = editMessageTextResp.result.text;
  return { messageText: editMessageTextResp.result.text };
}

/**
 * 在元数据中封禁话题
 * Ban topic in metadata
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {number} topicId - 话题ID
 * @returns {Promise<{isBannedBefore: boolean, messageText: string}>}
 */
async function banTopicOnMetaData(botToken, ownerUid, metaDataMessage, topicId) {
  const oldText = metaDataMessage.text;
  if (oldText.includes(`;${topicId}:b`)) {
    return { isBannedBefore: true, messageText: oldText };
  }
  
  // 处理未验证访客的封禁 (Handle banning unverified visitors)
  // 格式: ;topicId:v{answer}_{attempts}_{lastDate}_{failedDays}_{fromChatId}
  // 需要替换为: ;topicId:b{fromChatId}
  const verificationPattern = new RegExp(`;${topicId}:v\\d+_\\d+_\\d+_\\d+_(\\d+)`, 'g');
  let newText = oldText.replace(verificationPattern, `;${topicId}:b$1`);
  
  // 处理已验证或无前缀访客的封禁 (Handle banning verified visitors)
  // 格式: ;topicId:fromChatId
  // 需要替换为: ;topicId:bfromChatId
  if (newText === oldText) {
    newText = oldText.replace(`;${topicId}:`, `;${topicId}:b`);
  }
  
  await postToTelegramApi(botToken, 'editMessageText', {
    chat_id: ownerUid,
    message_id: metaDataMessage.message_id,
    text: newText,
  });
  return { isBannedBefore: false, messageText: newText };
}

/**
 * 在元数据中解封话题
 * Unban topic in metadata
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {number} topicId - 话题ID
 * @returns {Promise<{isNotBannedBefore: boolean, messageText: string}>}
 */
async function unbanTopicOnMetaData(botToken, ownerUid, metaDataMessage, topicId) {
  const oldText = metaDataMessage.text;
  if (!oldText.includes(`;${topicId}:b`)) {
    return { isNotBannedBefore: true, messageText: oldText };
  }
  
  // 解封时，将封禁状态改为已验证状态 (When unbanning, change banned status to verified status)
  // 格式: ;topicId:b{fromChatId}
  // 需要替换为: ;topicId:{fromChatId}
  const newText = oldText.replace(`;${topicId}:b`, `;${topicId}:`);
  
  await postToTelegramApi(botToken, 'editMessageText', {
    chat_id: ownerUid,
    message_id: metaDataMessage.message_id,
    text: newText,
  });
  return { isNotBannedBefore: false, messageText: newText };
}

/**
 * 重置机器人设置
 * Reset bot settings
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @param {boolean} inOwnerChat - 是否在所有者聊天中
 * @returns {Promise<Response>}
 */
export async function reset(botToken, ownerUid, message, inOwnerChat) {
  try {
    const supergroupId = message.chat.id;

    let unpinMetaDataMessageResp;

    const check = await doCheckInit(botToken, ownerUid)
    if (!check.failed) {
      const { superGroupChatId: superGroupChatIdFromMetaData }
          = parseMetaDataMessage(check.checkMetaDataMessageResp.result.pinned_message)
      if (inOwnerChat || superGroupChatIdFromMetaData === supergroupId) {
        unpinMetaDataMessageResp = await (await postToTelegramApi(botToken, 'unpinAllChatMessages', {
          chat_id: ownerUid,
        })).json();
        if (!unpinMetaDataMessageResp.ok) {
          await postToTelegramApi(botToken, 'sendMessage', {
            chat_id: ownerUid,
            text: `Reset failed!`,
          });
        } else {
          await postToTelegramApi(botToken, 'sendMessage', {
            chat_id: ownerUid,
            text: `Reset success!`,
          });
        }
      } else {
        await postToTelegramApi(botToken, 'sendMessage', {
          chat_id: ownerUid,
          text: `Can't reset from group isn't current using!`,
        });
      }
      return new Response('OK');
    } else {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: "not init yet!",
      });
      return new Response('OK');
    }
  } catch (error) {
    console.error('Error handling webhook:', error.message);
    // // --- for debugging ---
    // await postToTelegramApi(botToken, 'sendMessage', {
    //     chat_id: ownerUid,
    //     text: `Error handling webhook: ${error.message}`,
    // });
    // // --- for debugging ---
    return new Response('OK');
  }
}

// ---------------------------------------- PRIVATE MESSAGE ----------------------------------------

/**
 * 转义 Markdown 保留字符
 * Escape Markdown reserved characters
 * @param {string} str - 输入字符串
 * @returns {string} - 转义后的字符串
 */
function parseMdReserveWord(str) {
  return str
      .replaceAll("_", "\\_")
      .replaceAll("*", "\\*")
      .replaceAll("[", "\\[")
      .replaceAll("]", "\\]")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)")
      .replaceAll("~", "\\~")
      .replaceAll("`", "\\`")
      .replaceAll(">", "\\>")
      .replaceAll("#", "\\#")
      .replaceAll("+", "\\+")
      .replaceAll("-", "\\-")
      .replaceAll("=", "\\=")
      .replaceAll("|", "\\|")
      .replaceAll("{", "\\{")
      .replaceAll("}", "\\}")
      .replaceAll(".", "\\.")
      .replaceAll("!", "\\!");
}

/**
 * 处理接收到的私信消息
 * Process received private message
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {Map} fromChatToTopic - 访客到话题的映射
 * @param {Array} bannedTopics - 已封禁的话题列表
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {Map} fromChatToCommentName - 访客到备注名的映射
 * @returns {Promise<{success: boolean, targetChatId?: number, targetTopicId?: number, originChatId?: number, originMessageId?: number, newMessageId?: number}>}
 */
export async function processPMReceived(botToken, ownerUid, message, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName) {
  const fromChat = message.chat;
  const fromUserId = message.from.id;
  const fromChatId = fromChat.id;
  const pmMessageId = message.message_id;
  let topicId = fromChatToTopic.get(fromChatId);
  let isNewTopic = false;
  let commentName = fromChatToCommentName.get(fromChatId) ?
      `${fromChatToCommentName.get(fromChatId)} | ` : '';
  const maxTopicNameLen = 127;
  const maxFromChatNameLen = maxTopicNameLen - (commentName.length + `${fromChatId}`.length + 6);
  const maxCommentNameLen = maxTopicNameLen - (`${fromChatId}`.length + 6);
  commentName = commentName.substring(0, maxCommentNameLen);
  let fromChatName = fromChat.username ?
      `@${fromChat.username}` : [fromChat.first_name, fromChat.last_name].filter(Boolean).join(' ');
  fromChatName = fromChatName.substring(0, maxFromChatNameLen);
  fromChatName = fromChatName.replace(/\|/g, '｜');

  const lengthCheckDo = function (topicName, newTopicName) {
    if (topicName.length > 128) {
      return newTopicName;
    } else {
      return topicName;
    }
  }
  let topicName = `${commentName}${fromChatName} ${fromChatId === fromUserId ? `(${fromChatId})` : `(${fromChatId})(${fromUserId})`}`;
  topicName = lengthCheckDo(topicName, `${commentName}${fromChatName} (${fromChatId})`);
  topicName = lengthCheckDo(topicName, `${commentName} (${fromChatId})`);
  topicName = lengthCheckDo(topicName, `(${fromChatId})`.substring(0, maxTopicNameLen));

  if (!topicId) {
    const createTopicResp = await (await postToTelegramApi(botToken, 'createForumTopic', {
      chat_id: superGroupChatId,
      name: topicName,
    })).json();
    topicId = createTopicResp.result?.message_thread_id
    if (!createTopicResp.ok || !topicId) {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: `DEBUG MESSAGE! chatId: ${superGroupChatId} topicName: ${topicName} createTopicResp: ${JSON.stringify(createTopicResp)}`,
      });
      return;
    }
    await addTopicToFromChatOnMetaData(botToken, metaDataMessage, ownerUid, topicId, fromChatId);
    isNewTopic = true;
    
    // 发送命令提醒到新话题 (Send command reminder to new topic)
    await sendCommandReminder(botToken, superGroupChatId, topicId);
  }

  const isTopicExists = await (async function () {
    const reopenForumTopicResp = await (await postToTelegramApi(botToken, 'editForumTopic', {
      chat_id: superGroupChatId,
      message_thread_id: topicId,
      name: topicName,
    })).json();
    return reopenForumTopicResp.ok || !reopenForumTopicResp.description.includes("TOPIC_ID_INVALID");
  })()

  // topic has been banned
  if (bannedTopics.includes(topicId) && isTopicExists) {
    return { success: false }
  }

  if (!isTopicExists) {
    // clean metadata message
    await cleanItemOnMetaData(botToken, metaDataMessage, ownerUid, topicId);
    fromChatToTopic.delete(fromChatId)
    // resend the message
    return await processPMReceived(botToken, ownerUid, message, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName)
  }

  // 检查验证状态 (Check verification status)
  const verificationStatus = parseVerificationStatus(fromChatId, metaDataMessage.text);
  let shouldAddReaction = true; // 默认添加表情反应
  let shouldNotifyAdmin = false; // 默认不通知管理员（只在验证成功时通知一次）
  let currentChallenge = null; // 当前挑战（用于转发时显示）
  let verificationResultInfo = null; // 验证结果信息（用于在话题中显示）

  // 已验证用户发送 /start 时，发送欢迎消息
  if (verificationStatus.isVerified && (message.text === '/start' || message.text?.startsWith('/start@'))) {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: fromChatId,
      text: VISITOR_WELCOME_TEXT,
      parse_mode: 'MarkdownV2',
    });
  }

  // 处理验证逻辑 (Handle verification logic)
  if (!verificationStatus.isVerified && !verificationStatus.isBanned) {
    shouldAddReaction = false; // 未验证访客不添加表情标记
    
    // 检查是否需要重置（新的一天）
    const needsNewChallenge = verificationStatus.currentAnswer === 0 || 
                              isNewTopic || 
                              isNewDay(verificationStatus.lastAttemptDate);
    
    // 检查是否是首次消息或需要新挑战
    if (needsNewChallenge) {
      // 首次消息或新的一天，初始化验证状态并发送挑战
      const initStatus = initializeVerificationStatus();
      
      // 如果是新的一天且之前失败过，增加失败天数
      if (isNewDay(verificationStatus.lastAttemptDate) && verificationStatus.attempts >= 3) {
        initStatus.failedDays = verificationStatus.failedDays + 1;
        // 检查是否应该封禁
        if (initStatus.failedDays >= 2) {
          initStatus.isBanned = true;
          const updatedMetaText = updateVerificationStatusInMetadata(
            metaDataMessage.text,
            topicId,
            fromChatId,
            initStatus
          );
          await editMetaDataMessage(botToken, ownerUid, metaDataMessage, updatedMetaText);
          
          const banText = `You have been automatically banned due to repeated verification failures.`;
          await postToTelegramApi(botToken, 'sendMessage', {
            chat_id: fromChatId,
            text: banText,
          });
          return { success: false };
        }
      }
      
      currentChallenge = initStatus.challenge;
      
      // 更新元数据
      const updatedMetaText = updateVerificationStatusInMetadata(
        metaDataMessage.text,
        topicId,
        fromChatId,
        initStatus
      );
      await editMetaDataMessage(botToken, ownerUid, metaDataMessage, updatedMetaText);
      
      // 如果是 /start 命令，先发送欢迎消息
      if (message.text === '/start' || message.text?.startsWith('/start@')) {
        await postToTelegramApi(botToken, 'sendMessage', {
          chat_id: fromChatId,
          text: VISITOR_WELCOME_TEXT,
          parse_mode: 'MarkdownV2',
        });
      }
      
      // 发送验证挑战和说明给访客
      const challengeText = `To prevent spam, please solve this simple math problem:\n\n${initStatus.challenge.question}\n\nPlease reply with just the number.`;
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: fromChatId,
        text: challengeText,
      });
    } else {
      // 检查是否是答案（纯数字）
      const messageText = message.text?.trim();
      if (messageText && /^\d+$/.test(messageText)) {
        // 这是验证答案
        const verifyResult = verifyAnswer(fromChatId, messageText, metaDataMessage.text);
        
        if (verifyResult.isCorrect) {
          // 答案正确，标记为已验证
          const updatedMetaText = updateVerificationStatusInMetadata(
            metaDataMessage.text,
            topicId,
            fromChatId,
            verifyResult.newStatus
          );
          await editMetaDataMessage(botToken, ownerUid, metaDataMessage, updatedMetaText);
          
          // 发送验证成功消息
          const successText = `Verification successful! Your messages will now be forwarded to the admin.`;
          await postToTelegramApi(botToken, 'sendMessage', {
            chat_id: fromChatId,
            text: successText,
          });
          
          // 验证成功，添加表情和通知管理员
          shouldAddReaction = true;
          shouldNotifyAdmin = true;
          verificationResultInfo = { type: 'success' };
        } else {
          // 答案错误
          const updatedMetaText = updateVerificationStatusInMetadata(
            metaDataMessage.text,
            topicId,
            fromChatId,
            verifyResult.newStatus
          );
          await editMetaDataMessage(botToken, ownerUid, metaDataMessage, updatedMetaText);
          
          if (verifyResult.shouldBan) {
            // 连续两天失败，自动封禁
            const banText = `You have been automatically banned due to repeated verification failures.`;
            await postToTelegramApi(botToken, 'sendMessage', {
              chat_id: fromChatId,
              text: banText,
            });
            verificationResultInfo = { type: 'banned' };
          } else if (verifyResult.attemptsExhausted) {
            // 当日尝试次数用尽
            const exhaustedText = `You have used all verification attempts for today. Please try again tomorrow.`;
            await postToTelegramApi(botToken, 'sendMessage', {
              chat_id: fromChatId,
              text: exhaustedText,
            });
            verificationResultInfo = { type: 'exhausted' };
          } else {
            // 还有重试机会，发送新挑战
            const retryText = `Incorrect answer. Please try again:\n\n${verifyResult.newChallenge.question}\n\nPlease reply with just the number.`;
            await postToTelegramApi(botToken, 'sendMessage', {
              chat_id: fromChatId,
              text: retryText,
            });
            verificationResultInfo = { type: 'retry', newChallenge: verifyResult.newChallenge };
          }
        }
      } else {
        // 不是答案，需要重新发送当前挑战
        currentChallenge = { answer: verificationStatus.currentAnswer };
        
        // 如果是 /start 命令，发送欢迎消息
        if (message.text === '/start' || message.text?.startsWith('/start@')) {
          await postToTelegramApi(botToken, 'sendMessage', {
            chat_id: fromChatId,
            text: VISITOR_WELCOME_TEXT,
            parse_mode: 'MarkdownV2',
          });
        }
        
        // 如果当日尝试次数已用尽，不回复访客
        if (verificationStatus.attempts >= 3) {
          // 继续转发消息但不回复
        } else {
          // 提醒访客需要先完成验证
          const reminderText = `Please complete the verification first by answering the math question. Reply with just the number.`;
          await postToTelegramApi(botToken, 'sendMessage', {
            chat_id: fromChatId,
            text: reminderText,
          });
        }
      }
    }
  }

  // forwardMessage to topic
  const forwardMessageResp = await (await postToTelegramApi(botToken, 'forwardMessage', {
    chat_id: superGroupChatId,
    message_thread_id: topicId,
    from_chat_id: fromChatId,
    message_id: pmMessageId,
  })).json();
  
  // 如果是未验证访客，在转发消息后发送状态信息到话题
  if (forwardMessageResp.ok && !verificationStatus.isVerified && !verificationStatus.isBanned) {
    let statusText = '';
    
    if (verificationResultInfo) {
      // 显示验证结果
      if (verificationResultInfo.type === 'success') {
        statusText = '✅ *VERIFICATION SUCCESSFUL*\n\n_Visitor has been verified\\. Future messages will trigger notifications\\._';
      } else if (verificationResultInfo.type === 'banned') {
        statusText = '🚫 *AUTO\\-BANNED*\n\n_Visitor has been automatically banned due to repeated verification failures\\._';
      } else if (verificationResultInfo.type === 'exhausted') {
        statusText = '⏰ *ATTEMPTS EXHAUSTED*\n\n_Visitor has used all verification attempts for today\\._';
      } else if (verificationResultInfo.type === 'retry') {
        const newQ = verificationResultInfo.newChallenge?.question || 'New challenge sent';
        statusText = '❌ *WRONG ANSWER*\n\nNew challenge sent: `' + parseMdReserveWord(newQ) + '`';
      }
    } else if (currentChallenge) {
      // 显示当前挑战
      const challengeDisplay = currentChallenge.question || ('Sum equals ' + currentChallenge.answer);
      statusText = '⚠️ *UNVERIFIED VISITOR*\n\nChallenge sent: `' + parseMdReserveWord(challengeDisplay) + '`\n\n_Waiting for verification\\.\\.\\._';
    }
    
    if (statusText) {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: superGroupChatId,
        message_thread_id: topicId,
        text: statusText,
        parse_mode: "MarkdownV2",
      });
    }
  }

  if (forwardMessageResp.ok) {
    const topicMessageId = forwardMessageResp.result.message_id;

    // replay
    const replayPmMsgId = message.reply_to_message?.message_id
    if (replayPmMsgId) {
      const checkMessageConnectionMetaDataResp =
          await checkMessageConnectionMetaDataForAction(botToken, superGroupChatId,
              `Can't find ORIGIN message for message EDITING.`, ownerUid);
      let replayedMessageId;
      const messageConnectionTextSplit = checkMessageConnectionMetaDataResp.metaDataMessageText?.split(';');
      if (messageConnectionTextSplit) {
        for (let i = 0; i < messageConnectionTextSplit.length; i++) {
          const messageConnectionTextSplitSplit = messageConnectionTextSplit[i].split(':');
          if (replayPmMsgId === parseInt(messageConnectionTextSplitSplit[1])) {
            const topicMessageMetaData = messageConnectionTextSplitSplit[0];
            const topicMessageMetaDataSplit = topicMessageMetaData.split('-');
            replayedMessageId = parseInt(topicMessageMetaDataSplit[1]);
            break;
          }
        }
      }

      let newMessageLink = `https://t.me/c/${superGroupChatId}/${topicId}/${topicMessageId}`;
      if (superGroupChatId.toString().startsWith("-100")) {
        newMessageLink = `https://t.me/c/${superGroupChatId.toString().substring(4)}/${topicId}/${topicMessageId}`;
      }
      let text = `*⬆️⬆️⬆️[REPLAY](${newMessageLink})⬆️⬆️⬆️*`;
      const sendReplayMessageBody = {
        chat_id: superGroupChatId,
        message_thread_id: topicId,
        text: text,
        parse_mode: "MarkdownV2"
      };
      let sendMessageResp;
      if (replayedMessageId) {
        sendReplayMessageBody.reply_parameters = {
          message_id: replayedMessageId,
          chat_id: superGroupChatId
        }
        sendMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', sendReplayMessageBody)).json();
      }
      if (!sendMessageResp || !sendMessageResp?.ok) {
        delete sendReplayMessageBody.reply_parameters;
        const isReplaySender = message.reply_to_message?.from.id === fromUserId;
        sendReplayMessageBody.text = `*⬆️⬆️⬆️[REPLAY](${newMessageLink})`;
        sendReplayMessageBody.text += isReplaySender ? ` MINE⬇️⬇️⬇️*` : ` YOURS⬇️⬇️⬇️*`;
        if (message.reply_to_message?.date) {
          const formatted = dayjs.unix(message.reply_to_message?.date)
              .tz('Asia/Shanghai')
              .format('YYYY-MM-DD HH:mm:ss');
          sendReplayMessageBody.text += `\n*${parseMdReserveWord(formatted)}*`;
        }
        if (message.reply_to_message.text) {
          sendReplayMessageBody.text += `\n\`\`\`\n`;
          sendReplayMessageBody.text += message.reply_to_message.text
              .substring(0, 128)
              .replace(/`/g, '\\`');
          sendReplayMessageBody.text += `\n\`\`\``;
        } else {
          sendReplayMessageBody.text += `\n*❎❎❎UNKNOWN❎❎❎*`;
        }
        await postToTelegramApi(botToken, 'sendMessage', sendReplayMessageBody)
      }
    }

    // 只在验证通过时或已验证用户发送消息时通知管理员
    if (shouldNotifyAdmin) {
      // send PM to bot owner for the bad notification on super group for first message
      let messageLink = `https://t.me/c/${superGroupChatId}/${topicId}/${topicMessageId}`;
      if (superGroupChatId.toString().startsWith("-100")) {
        messageLink = `https://t.me/c/${superGroupChatId.toString().substring(4)}/${topicId}/${topicMessageId}`
      }
      const parsedFromChatName = parseMdReserveWord(fromChatName)
      const text = `${messageLink
          ? `New PM chat from ${parsedFromChatName}` +
          `\n[Click the to view it in your SUPERGROUP](${messageLink})`
          : `New PM chat from ${parsedFromChatName}` +
          `\nGo view it in your SUPERGROUP`}`
      const sendMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: text,
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      })).json();
      if (!sendMessageResp.ok) {
        await postToTelegramApi(botToken, 'sendMessage', {
          chat_id: ownerUid,
          text: `New PM chat notify error, text: ${text} resp: ${JSON.stringify(sendMessageResp)}`,
        })
      }
    }
    // save messageId connection to superGroupChat pin message
    await saveMessageConnection(botToken, superGroupChatId, topicId, topicMessageId, pmMessageId, ownerUid);
    // notify sending status by MessageReaction (只在已验证时添加)
    if (shouldAddReaction) {
      await postToTelegramApi(botToken, 'setMessageReaction', {
        chat_id: fromChatId,
        message_id: pmMessageId,
        reaction: [{ type: "emoji", emoji: "🕊" }]
      });
    }
    return {
      success: true,
      targetChatId: superGroupChatId,
      targetTopicId: topicId,
      originChatId: fromChatId,
      originMessageId: pmMessageId,
      newMessageId: topicMessageId
    }
  } else if (forwardMessageResp.description.includes('message thread not found')) {
    // clean metadata message
    await cleanItemOnMetaData(botToken, metaDataMessage, ownerUid, topicId);
    fromChatToTopic.delete(fromChatId)
    // resend the message
    return await processPMReceived(botToken, ownerUid, message, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName)
  }
  return { success: false }
}

/**
 * 处理发送的私信消息
 * Process sent private message
 * @param {string} botToken - 机器人令牌
 * @param {object} message - Telegram 消息对象
 * @param {Map} topicToFromChat - 话题到访客的映射
 * @param {boolean} noReplay - 是否不回复
 * @returns {Promise<void>}
 */
export async function processPMSent(botToken, message, topicToFromChat, noReplay) {
  const ownerUid = message.from.id;
  const topicId = message.message_thread_id;
  const superGroupChatId = message.chat.id;
  const topicMessageId = message.message_id;
  const pmChatId = topicToFromChat.get(message.message_thread_id)

  // replay
  let replayPmMessageId;
  let replayText;
  if (!noReplay && message.reply_to_message && message.reply_to_message?.message_id !== topicId) {
    replayText = message.reply_to_message?.text;
    const checkMessageConnectionMetaDataResp =
        await checkMessageConnectionMetaDataForAction(botToken, superGroupChatId,
            `Can't find TARGET message for sending message REPLAY.`, ownerUid);
    if (!checkMessageConnectionMetaDataResp.failed) {
      const messageConnectionTextSplit = checkMessageConnectionMetaDataResp.metaDataMessageText.split(';').reverse();
      for (let i = 0; i < messageConnectionTextSplit.length; i++) {
        const messageConnectionTextSplitSplit = messageConnectionTextSplit[i].split(':');
        const topicMessageMetaData = messageConnectionTextSplitSplit[0];
        const topicMessageMetaDataSplit = topicMessageMetaData.split('-');
        if (message.reply_to_message?.message_id === parseInt(topicMessageMetaDataSplit[1])) {
          replayPmMessageId = messageConnectionTextSplitSplit[1];
          break;
        }
      }
    }
  }

  const copyMessageBody = {
    chat_id: pmChatId,
    from_chat_id: superGroupChatId,
    message_id: topicMessageId
  };
  if (replayPmMessageId) {
    copyMessageBody.reply_parameters = {
      message_id: replayPmMessageId,
      chat_id: pmChatId
    }
  }
  const copyMessageResp = await (await postToTelegramApi(botToken, 'copyMessage', copyMessageBody)).json();
  if (copyMessageResp.ok) {
    const pmMessageId = copyMessageResp.result.message_id
    // save messageId connection to group pin message
    await saveMessageConnection(botToken, superGroupChatId, topicId, topicMessageId, pmMessageId, ownerUid);
    // send replay message
    if (!replayPmMessageId && replayText) {
      let sendReplayText = `*⬆️⬆️⬆️REPLAY`;
      const isReplaySender = message.reply_to_message?.from.id === ownerUid;
      sendReplayText += isReplaySender ? ` MINE⬇️⬇️⬇️*` : ` YOURS⬇️⬇️⬇️*`;
      if (message.reply_to_message?.date) {
        const formatted = dayjs.unix(message.reply_to_message?.date)
            .tz('Asia/Shanghai')
            .format('YYYY-MM-DD HH:mm:ss');
        sendReplayText += `\n*${parseMdReserveWord(formatted)}*`;
      }
      const replayTextLines = replayText.split('\n');
      for (const replayTextLine of replayTextLines) {
        sendReplayText += `\n>${parseMdReserveWord(replayTextLine)}`;
      }
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: pmChatId,
        text: sendReplayText,
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      })
    }
    // notify sending status by MessageReaction
    await postToTelegramApi(botToken, 'setMessageReaction', {
      chat_id: superGroupChatId,
      message_id: topicMessageId,
      reaction: [{ type: "emoji", emoji: "🕊" }]
    });
  } else if (copyMessageResp.description.includes("message to be replied not found") || copyMessageResp.description.includes("repl")) {
    await processPMSent(botToken, message, topicToFromChat, true);
  } else {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: ownerUid,
      text: `SEND MESSAGE ERROR! copyMessageResp: ${JSON.stringify(copyMessageResp)} message: ${JSON.stringify(message)}`,
    });
  }
}

// ---------------------------------------- MESSAGE CONNECTION ----------------------------------------

/**
 * 检查消息连接元数据
 * Check message connection metadata
 * @param {string} botToken - 机器人令牌
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {string} failedMessage - 失败消息
 * @param {boolean} failed - 是否失败
 * @returns {Promise<{failedMessage: string, failed: boolean, metaDataMessageId: number, metaDataMessageText: string, metaDataMessage: object}>}
 */
async function checkMessageConnectionMetaData(botToken, superGroupChatId, failedMessage, failed) {
  let metaDataMessageId;
  let metaDataMessageText;
  let metaDataMessage;
  failedMessage = failedMessage || '';
  failed = failed || false;
  const checkMetaDataMessageResp = await (await postToTelegramApi(botToken, 'getChat', {
    chat_id: superGroupChatId,
  })).json();
  if (!checkMetaDataMessageResp.ok || !checkMetaDataMessageResp.result.pinned_message?.text) {
    failedMessage += " checkMetaDataMessageResp: " + JSON.stringify(checkMetaDataMessageResp);
    failed = true;
  } else {
    metaDataMessage = checkMetaDataMessageResp.result.pinned_message;
    metaDataMessageId = checkMetaDataMessageResp.result.pinned_message.message_id;
    metaDataMessageText = checkMetaDataMessageResp.result.pinned_message.text;
  }
  return { failedMessage, failed, metaDataMessageId, metaDataMessageText, metaDataMessage };
}

/**
 * 检查消息连接元数据并执行操作
 * Check message connection metadata for action
 * @param {string} botToken - 机器人令牌
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {string} failedMessage - 失败消息
 * @param {number} failedMessageChatId - 失败消息聊天ID
 * @returns {Promise<{failedMessage: string, failed: boolean, metaDataMessageId: number, metaDataMessageText: string, metaDataMessage: object}>}
 */
async function checkMessageConnectionMetaDataForAction(botToken, superGroupChatId, failedMessage, failedMessageChatId) {
  const checkMessageConnectionMetaDataResp = await checkMessageConnectionMetaData(
      botToken, superGroupChatId, failedMessage);
  if (checkMessageConnectionMetaDataResp.failed) {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: failedMessageChatId,
      text: failedMessage,
    });
  }
  return checkMessageConnectionMetaDataResp;
}

/**
 * 保存消息连接关系
 * Save message connection
 * @param {string} botToken - 机器人令牌
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {number} topicId - 话题ID
 * @param {number} topicMessageId - 话题消息ID
 * @param {number} pmMessageId - 私信消息ID
 * @param {string} ownerUid - 所有者用户ID
 * @returns {Promise<void>}
 */
async function saveMessageConnection(botToken, superGroupChatId, topicId, topicMessageId, pmMessageId, ownerUid) {
  let failed = false;
  let failedMessage = "Chat message connect failed, can't do emoji react, edit, delete.";
  const checkMessageConnectionMetaDataResp = await checkMessageConnectionMetaData(
      botToken, superGroupChatId, failedMessage, failed);
  failedMessage = checkMessageConnectionMetaDataResp.failedMessage;
  failed = checkMessageConnectionMetaDataResp.failed;
  let metaDataMessageId = checkMessageConnectionMetaDataResp.metaDataMessageId;
  let metaDataMessageText = checkMessageConnectionMetaDataResp.metaDataMessageText;
  if (failed) {
    // new message connection in superGroupChat pinned message
    failed = false;
    metaDataMessageText = `${topicId}-${topicMessageId}:${pmMessageId}`;
    const sendMetaDataMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: superGroupChatId,
      text: metaDataMessageText,
    })).json();
    if (!sendMetaDataMessageResp.ok) {
      failedMessage += " sendMetaDataMessageResp: " + JSON.stringify(sendMetaDataMessageResp);
      failed = true;
    }
    if (!failed) {
      metaDataMessageId = sendMetaDataMessageResp.result.message_id;
      const pinMetaDataMessageResp = await (await postToTelegramApi(botToken, 'pinChatMessage', {
        chat_id: superGroupChatId,
        message_id: metaDataMessageId,
      })).json();
      if (!pinMetaDataMessageResp.ok) {
        failedMessage += " pinMetaDataMessageResp: " + JSON.stringify(pinMetaDataMessageResp);
        failed = true;
      }
    }
  } else {
    // add message connection in superGroupChat pinned message
    metaDataMessageText = `${metaDataMessageText};${topicId}-${topicMessageId}:${pmMessageId}`;
    // text message max length 4096
    const processForTextMessageMaxLength = function (text, process) {
      if (text.length > 4096) {
        text = process(text);
        text = processForTextMessageMaxLength(text, process);
      }
      return text;
    }
    metaDataMessageText = processForTextMessageMaxLength(
        metaDataMessageText, (metaDataMessageText) => metaDataMessageText.split(';').slice(1).join(';'));
    const editMessageTextResp = await (await postToTelegramApi(botToken, 'editMessageText', {
      chat_id: superGroupChatId,
      message_id: metaDataMessageId,
      text: metaDataMessageText,
    })).json();
    if (!editMessageTextResp.ok) {
      failedMessage += " editMessageTextResp: " + JSON.stringify(editMessageTextResp);
      failed = true;
    }
  }
  if (failed) {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: ownerUid,
      text: `GROUP ${superGroupChatId} MESSAGE ${topicId}-${topicMessageId}:${pmMessageId}: ${failedMessage}`,
    });
  }
}

// ---------------------------------------- EMOJI REACTION ----------------------------------------

/**
 * 处理接收到的表情反应
 * Process received emoji reaction
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} fromUser - 发送用户对象
 * @param {object} messageReaction - 消息反应对象
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {Array} bannedTopics - 已封禁的话题列表
 * @returns {Promise<void>}
 */
export async function processERReceived(botToken, ownerUid, fromUser, messageReaction, superGroupChatId, bannedTopics) {
  const pmMessageId = messageReaction.message_id;
  let topicId;
  let topicMessageId;
  let reaction = messageReaction.new_reaction;

  const checkMessageConnectionMetaDataResp =
      await checkMessageConnectionMetaDataForAction(botToken, superGroupChatId, "Can't sent EMOJI REACTION.", ownerUid);
  if (checkMessageConnectionMetaDataResp.failed) return;

  const messageConnectionTextSplit = checkMessageConnectionMetaDataResp.metaDataMessageText.split(';').reverse();
  for (let i = 0; i < messageConnectionTextSplit.length; i++) {
    const messageConnectionTextSplitSplit = messageConnectionTextSplit[i].split(':');
    if (pmMessageId === parseInt(messageConnectionTextSplitSplit[1])) {
      const topicMessageMetaData = messageConnectionTextSplitSplit[0];
      const topicMessageMetaDataSplit = topicMessageMetaData.split('-');
      topicId = parseInt(topicMessageMetaDataSplit[0]);
      topicMessageId = parseInt(topicMessageMetaDataSplit[1]);
      break;
    }
  }

  if (bannedTopics.includes(topicId)) return;

  if (!topicMessageId) {
    return;
  }

  if (reaction.length === 0 && fromUser.id === ownerUid) {
    reaction = [
      {
        "type": "emoji",
        "emoji": "🕊"
      }
    ]
  }

  await sendEmojiReaction(botToken, superGroupChatId, topicMessageId, reaction, ownerUid);
}

/**
 * 处理发送的表情反应
 * Process sent emoji reaction
 * @param {string} botToken - 机器人令牌
 * @param {object} messageReaction - 消息反应对象
 * @param {Map} topicToFromChat - 话题到访客的映射
 * @returns {Promise<void>}
 */
export async function processERSent(botToken, messageReaction, topicToFromChat) {
  const ownerUid = messageReaction.user.id;
  const superGroupChatId = messageReaction.chat.id;
  let topicId;
  const topicMessageId = messageReaction.message_id;
  let pmChatId;
  let pmMessageId;
  let reaction = messageReaction.new_reaction;

  const checkMessageConnectionMetaDataResp =
      await checkMessageConnectionMetaDataForAction(botToken, superGroupChatId, "Can't sent EMOJI REACTION.", ownerUid);
  if (checkMessageConnectionMetaDataResp.failed) return;

  const messageConnectionTextSplit = checkMessageConnectionMetaDataResp.metaDataMessageText.split(';').reverse();
  for (let i = 0; i < messageConnectionTextSplit.length; i++) {
    const messageConnectionTextSplitSplit = messageConnectionTextSplit[i].split(':');
    const topicMessageMetaData = messageConnectionTextSplitSplit[0];
    const topicMessageMetaDataSplit = topicMessageMetaData.split('-');
    if (topicMessageId === parseInt(topicMessageMetaDataSplit[1])) {
      topicId = topicMessageMetaDataSplit[0];
      pmMessageId = messageConnectionTextSplitSplit[1];
      pmChatId = topicToFromChat.get(parseInt(topicId));
      break;
    }
  }

  if (!pmMessageId) {
    return;
  }

  // TODO: 2025/5/10 if react on owner's message, there's no need for a 🕊
  if (reaction.length === 0) {
    reaction = [
      {
        "type": "emoji",
        "emoji": "🕊"
      }
    ]
  }

  await sendEmojiReaction(botToken, pmChatId, pmMessageId, reaction, ownerUid);
}

/**
 * 发送表情反应
 * Send emoji reaction
 * @param {string} botToken - 机器人令牌
 * @param {number} targetChatId - 目标聊天ID
 * @param {number} targetMessageId - 目标消息ID
 * @param {Array} reaction - 反应数组
 * @param {string} ownerUid - 所有者用户ID
 * @returns {Promise<void>}
 */
async function sendEmojiReaction(botToken, targetChatId, targetMessageId, reaction, ownerUid) {
  const setMessageReactionResp = await (await postToTelegramApi(botToken, 'setMessageReaction', {
    chat_id: targetChatId,
    message_id: targetMessageId,
    reaction: reaction
  })).json();
  if (!setMessageReactionResp.ok) {
    if (setMessageReactionResp.description.includes('REACTIONS_TOO_MANY')) {
      await postToTelegramApi(botToken, 'setMessageReaction', {
        chat_id: targetChatId,
        message_id: targetMessageId,
        reaction: reaction.slice(-1)
      });
    } else if (setMessageReactionResp.description.includes('REACTION_INVALID')) {
    } else {
      // --- for debugging ---
      // await postToTelegramApi(botToken, 'sendMessage', {
      //   chat_id: ownerUid,
      //   text: `setMessageReactionResp : ${JSON.stringify(setMessageReactionResp)}`,
      // });
      // --- for debugging ---
    }
  }
}

// ---------------------------------------- EDIT MESSAGE ----------------------------------------

/**
 * 处理接收到的私信编辑
 * Process received private message edit
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {Map} fromChatToTopic - 访客到话题的映射
 * @param {Array} bannedTopics - 已封禁的话题列表
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {Map} fromChatToCommentName - 访客到备注名的映射
 * @returns {Promise<void>}
 */
export async function processPMEditReceived(botToken, ownerUid, message, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName) {
  const { success: isForwardSuccess, targetChatId, targetTopicId, originChatId, originMessageId, newMessageId } =
      await processPMReceived(botToken, ownerUid, message, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName)
  if (isForwardSuccess) {
    const checkMessageConnectionMetaDataResp =
        await checkMessageConnectionMetaDataForAction(botToken, superGroupChatId,
            `Can't find ORIGIN message for message EDITING.`, ownerUid);

    let newMessageLink = `https://t.me/c/${targetChatId}/${targetTopicId}/${newMessageId}`;
    if (targetChatId.toString().startsWith("-100")) {
      newMessageLink = `https://t.me/c/${targetChatId.toString().substring(4)}/${targetTopicId}/${newMessageId}`;
    }

    let oldMessageId;
    let oldMessageLink;
    const messageConnectionTextSplit = checkMessageConnectionMetaDataResp.metaDataMessageText?.split(';');
    if (messageConnectionTextSplit) {
      for (let i = 0; i < messageConnectionTextSplit.length; i++) {
        const messageConnectionTextSplitSplit = messageConnectionTextSplit[i].split(':');
        if (originMessageId === parseInt(messageConnectionTextSplitSplit[1])) {
          const topicMessageMetaData = messageConnectionTextSplitSplit[0];
          const topicMessageMetaDataSplit = topicMessageMetaData.split('-');
          oldMessageId = parseInt(topicMessageMetaDataSplit[1]);
          break;
        }
      }
      oldMessageLink = oldMessageId ? `https://t.me/c/${targetChatId}/${targetTopicId}/${oldMessageId}` : '';
      if (oldMessageId && targetChatId.toString().startsWith("-100")) {
        oldMessageLink = `https://t.me/c/${targetChatId.toString().substring(4)}/${targetTopicId}/${oldMessageId}`;
      }
    }

    let text = `⬆️⬆️⬆️⬆️⬆️⬆️`;
    if (oldMessageLink) {
      text += `\n*[Message](${newMessageLink}) edited from [MESSAGE](${oldMessageLink})*`;
    } else {
      text += `\n*[Message](${newMessageLink}) edited from unknown*`;
    }
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: targetChatId,
      message_thread_id: targetTopicId,
      text: text,
      parse_mode: "MarkdownV2",
    });
    await notifyMessageEditForward(botToken, originChatId, originMessageId);
  }
}

/**
 * 处理发送的私信编辑
 * Process sent private message edit
 * @param {string} botToken - 机器人令牌
 * @param {object} message - Telegram 消息对象
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {Map} topicToFromChat - 话题到访客的映射
 * @returns {Promise<void>}
 */
export async function processPMEditSent(botToken, message, superGroupChatId, topicToFromChat) {
  const ownerUid = message.from.id;
  const topicId = message.message_thread_id;
  const topicMessageId = message.message_id;
  const pmChatId = topicToFromChat.get(message.message_thread_id);
  let pmMessageId;

  const checkMessageConnectionMetaDataResp =
      await checkMessageConnectionMetaDataForAction(botToken, superGroupChatId,
          `Can't find TARGET message for sending message editing.`, ownerUid);
  if (checkMessageConnectionMetaDataResp.failed) return;

  const messageConnectionTextSplit = checkMessageConnectionMetaDataResp.metaDataMessageText.split(';').reverse();
  for (let i = 0; i < messageConnectionTextSplit.length; i++) {
    const messageConnectionTextSplitSplit = messageConnectionTextSplit[i].split(':');
    const topicMessageMetaData = messageConnectionTextSplitSplit[0];
    const topicMessageMetaDataSplit = topicMessageMetaData.split('-');
    if (topicMessageId === parseInt(topicMessageMetaDataSplit[1])) {
      pmMessageId = messageConnectionTextSplitSplit[1];
      break;
    }
  }

  let oldMessageLink = `https://t.me/c/${superGroupChatId}/${topicId}/${topicMessageId}`;
  if (superGroupChatId.toString().startsWith("-100")) {
    oldMessageLink = `https://t.me/c/${superGroupChatId.toString().substring(4)}/${topicId}/${topicMessageId}`;
  }
  if (!pmMessageId) {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: superGroupChatId,
      message_thread_id: topicId,
      text: `Can't find TARGET message for sending [message](${oldMessageLink}) EDITING\\.`,
      parse_mode: "MarkdownV2",
    });
    return;
  }

  if (message.text) {
    const editMessageTextResp = await (await postToTelegramApi(botToken, 'editMessageText', {
      chat_id: pmChatId,
      message_id: pmMessageId,
      text: message.text,
      parse_mode: message.parse_mode,
      entities: message.entities,
    })).json();
    if (editMessageTextResp.ok) {
      // notify sending status by MessageReaction
      await notifyMessageEditForward(botToken, superGroupChatId, topicMessageId);
    } else {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: `SEND EDITED MESSAGE ERROR! editMessageTextResp: ${JSON.stringify(editMessageTextResp)} message: ${JSON.stringify(message)}.` +
            `\nYou can send this to developer for getting help, or just delete this message.`,
      });
    }
  } else if (false) {
    // TODO: 2025/5/10 editMessageCaption
  } else if (false) {
    // TODO: 2025/5/10 editMessageMedia
  } else if (false) {
    // TODO: 2025/5/10 editMessageLiveLocation
  } else if (false) {
    // TODO: 2025/5/10 stopMessageLiveLocation
  }
}

/**
 * 通知消息编辑已转发
 * Notify message edit forwarded
 * @param {string} botToken - 机器人令牌
 * @param {number} fromChatId - 来源聊天ID
 * @param {number} fromMessageId - 来源消息ID
 * @returns {Promise<void>}
 */
async function notifyMessageEditForward(botToken, fromChatId, fromMessageId) {
  await postToTelegramApi(botToken, 'setMessageReaction', {
    chat_id: fromChatId,
    message_id: fromMessageId,
    reaction: [{ type: "emoji", emoji: "🦄" }]
  });
  await new Promise(resolve => setTimeout(resolve, 1000));
  await postToTelegramApi(botToken, 'setMessageReaction', {
    chat_id: fromChatId,
    message_id: fromMessageId,
    reaction: [{ type: "emoji", emoji: "🕊" }]
  });
}

// ---------------------------------------- DELETE MESSAGE ----------------------------------------

/**
 * 处理接收到的私信删除
 * Process received private message deletion
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @param {object} reply - 回复消息对象
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {Map} fromChatToTopic - 访客到话题的映射
 * @param {Array} bannedTopics - 已封禁的话题列表
 * @param {object} metaDataMessage - 元数据消息对象
 * @returns {Promise<void>}
 */
export async function processPMDeleteReceived(botToken, ownerUid, message, reply,
                                              superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage) {
  const commandMessageId = message.message_id;
  const targetChatId = superGroupChatId;
  const originMessageId = reply.message_id;
  const fromChat = message.chat;
  const fromChatId = fromChat.id;

  const checkMessageConnectionMetaDataResp =
      await checkMessageConnectionMetaDataForAction(botToken, superGroupChatId,
          `Can't find ORIGIN message for message DELETING.`, ownerUid);

  let targetMessageId;
  const messageConnectionTextSplit = checkMessageConnectionMetaDataResp.metaDataMessageText?.split(';');
  if (messageConnectionTextSplit) {
    for (let i = 0; i < messageConnectionTextSplit.length; i++) {
      const messageConnectionTextSplitSplit = messageConnectionTextSplit[i].split(':');
      if (originMessageId === parseInt(messageConnectionTextSplitSplit[1])) {
        const topicMessageMetaData = messageConnectionTextSplitSplit[0];
        const topicMessageMetaDataSplit = topicMessageMetaData.split('-');
        targetMessageId = parseInt(topicMessageMetaDataSplit[1]);
        break;
      }
    }
  }

  if (message.text) {
    const deleteMessageResp = await (await postToTelegramApi(botToken, 'deleteMessage', {
      chat_id: targetChatId,
      message_id: targetMessageId,
    })).json();
    if (deleteMessageResp.ok) {
      await notifyMessageDeleteForward(botToken, fromChatId, originMessageId, commandMessageId);
    } else {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: fromChatId,
        text: `SEND DELETING MESSAGE ERROR! deleteMessageResp: ${JSON.stringify(deleteMessageResp)} message: ${JSON.stringify(message)}.` +
            `\nYou can send this to developer for getting help, or just delete this message.`,
      });
    }
  }
}

/**
 * 处理发送的私信删除
 * Process sent private message deletion
 * @param {string} botToken - 机器人令牌
 * @param {object} message - Telegram 消息对象
 * @param {object} reply - 回复消息对象
 * @param {number} superGroupChatId - 超级群组聊天ID
 * @param {Map} topicToFromChat - 话题到访客的映射
 * @returns {Promise<void>}
 */
export async function processPMDeleteSent(botToken, message, reply, superGroupChatId, topicToFromChat) {
  const ownerUid = message.from.id;
  const commandMessageId = message.message_id;
  const topicId = message.message_thread_id;
  const deleteOriginMessageId = reply.message_id;
  const pmChatId = topicToFromChat.get(message.message_thread_id);
  let deleteTargetMessageId;

  const checkMessageConnectionMetaDataResp =
      await checkMessageConnectionMetaDataForAction(botToken, superGroupChatId,
          `Can't find TARGET message for sending message DELETING.`, ownerUid);
  if (checkMessageConnectionMetaDataResp.failed) return;

  const messageConnectionTextSplit = checkMessageConnectionMetaDataResp.metaDataMessageText.split(';').reverse();
  for (let i = 0; i < messageConnectionTextSplit.length; i++) {
    const messageConnectionTextSplitSplit = messageConnectionTextSplit[i].split(':');
    const topicMessageMetaData = messageConnectionTextSplitSplit[0];
    const topicMessageMetaDataSplit = topicMessageMetaData.split('-');
    if (deleteOriginMessageId === parseInt(topicMessageMetaDataSplit[1])) {
      deleteTargetMessageId = messageConnectionTextSplitSplit[1];
      break;
    }
  }

  let originMessageLink = `https://t.me/c/${superGroupChatId}/${topicId}/${deleteOriginMessageId}`;
  if (superGroupChatId.toString().startsWith("-100")) {
    originMessageLink = `https://t.me/c/${superGroupChatId.toString().substring(4)}/${topicId}/${deleteOriginMessageId}`;
  }
  if (!deleteTargetMessageId) {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: superGroupChatId,
      message_thread_id: topicId,
      text: `Can't find TARGET message for sending [message](${originMessageLink}) DELETING\\.`,
      parse_mode: "MarkdownV2",
    });
    return;
  }

  if (message.text) {
    const deleteMessageResp = await (await postToTelegramApi(botToken, 'deleteMessage', {
      chat_id: pmChatId,
      message_id: deleteTargetMessageId,
    })).json();
    if (deleteMessageResp.ok) {
      await notifyMessageDeleteForward(botToken, superGroupChatId, deleteOriginMessageId, commandMessageId, topicId);
    } else {
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: superGroupChatId,
        message_thread_id: topicId,
        text: `SEND DELETING MESSAGE ERROR! deleteMessageResp: ${JSON.stringify(deleteMessageResp)} message: ${JSON.stringify(message)}.` +
            `\nYou can send this to developer for getting help, or just delete this message.`,
      });
    }
  }
}

/**
 * 通知消息删除已转发
 * Notify message deletion forwarded
 * @param {string} botToken - 机器人令牌
 * @param {number} fromChatId - 来源聊天ID
 * @param {number} fromMessageId - 来源消息ID
 * @param {number} commandMessageId - 命令消息ID
 * @param {number} fromTopicId - 来源话题ID
 * @returns {Promise<void>}
 */
async function notifyMessageDeleteForward(botToken, fromChatId, fromMessageId, commandMessageId, fromTopicId) {
  await postToTelegramApi(botToken, 'setMessageReaction', {
    chat_id: fromChatId,
    message_id: commandMessageId,
    reaction: [{ type: "emoji", emoji: "🗿" }]
  });
  if (fromTopicId) {
    let originMessageLink = `https://t.me/c/${fromChatId}/${fromTopicId ? `${fromTopicId}/` : ''}${fromMessageId}`;
    if (fromChatId.toString().startsWith("-100")) {
      originMessageLink = `https://t.me/c/${fromChatId.toString().substring(4)}/${fromTopicId ? `${fromTopicId}/` : ''}${fromMessageId}`;
    }
    let commandMessageLink = `https://t.me/c/${fromChatId}/${fromTopicId ? `${fromTopicId}/` : ''}${commandMessageId}`;
    if (fromChatId.toString().startsWith("-100")) {
      commandMessageLink = `https://t.me/c/${fromChatId.toString().substring(4)}/${fromTopicId ? `${fromTopicId}/` : ''}${commandMessageId}`;
    }
    const sendMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: fromChatId,
      message_thread_id: fromTopicId,
      text: `*[MESSAGE](${originMessageLink}) has been DELETED*\\.` +
          `These three Message will be deleted after 1s automatically\\.` +
          `\nOr You can delete the *[ORIGIN MESSAGE](${originMessageLink})*` +
          ` and *[COMMAND MESSAGE](${commandMessageLink})*` +
          ` and *\\[THIS MESSAGE\\]* for yourself\\.`,
      parse_mode: "MarkdownV2",
    })).json();
    if (sendMessageResp.ok) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      // delete origin message
      await postToTelegramApi(botToken, 'deleteMessage', {
        chat_id: fromChatId,
        message_id: fromMessageId,
      });
      // delete command message
      await postToTelegramApi(botToken, 'deleteMessage', {
        chat_id: fromChatId,
        message_id: commandMessageId,
      });
      await postToTelegramApi(botToken, 'deleteMessage', {
        chat_id: fromChatId,
        message_id: sendMessageResp.result.message_id,
      });
    }
  } else {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: fromChatId,
      message_thread_id: fromTopicId,
      text: `*Message has been DELETED*\\.` +
          `\nYou can delete the *\\[ORIGIN MESSAGE\\]*` +
          ` and *\\[COMMAND MESSAGE\\]*` +
          ` and *\\[THIS MESSAGE\\]* for yourself\\.` +
          ` Limited by TG I can't do it for you, sorry\\.`,
      parse_mode: "MarkdownV2",
    });
  }
}

// ---------------------------------------- BAN TOPIC ----------------------------------------

/**
 * 封禁话题
 * Ban topic
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @param {Map} topicToFromChat - 话题到访客的映射
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {boolean} isSilent - 是否静默封禁
 * @returns {Promise<Response>}
 */
export async function banTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, isSilent) {
  const topicId = message.message_thread_id;
  const superGroupChatId = message.chat.id;

  const { isBannedBefore } =
      await banTopicOnMetaData(botToken, ownerUid, metaDataMessage, topicId);
  if (isBannedBefore) {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: superGroupChatId,
      message_thread_id: topicId,
      text: `This topic already been BANNED!`,
    });
    return new Response('OK');
  }

  await postToTelegramApi(botToken, 'sendMessage', {
    chat_id: superGroupChatId,
    message_thread_id: topicId,
    text: `Successfully BAN this topic for receiving private message!`,
  });

  if (isSilent) return new Response('OK');
  const chatId = topicToFromChat.get(topicId)
  await postToTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: `You have been BANNED for sending messages!`,
  });
  return new Response('OK');
}

/**
 * 解封话题
 * Unban topic
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {object} message - Telegram 消息对象
 * @param {Map} topicToFromChat - 话题到访客的映射
 * @param {object} metaDataMessage - 元数据消息对象
 * @param {boolean} isSilent - 是否静默解封
 * @returns {Promise<Response>}
 */
export async function unbanTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, isSilent) {
  const topicId = message.message_thread_id;
  const superGroupChatId = message.chat.id;

  const { isNotBannedBefore } =
      await unbanTopicOnMetaData(botToken, ownerUid, metaDataMessage, topicId);
  if (isNotBannedBefore) {
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: superGroupChatId,
      message_thread_id: topicId,
      text: `This topic has NOT benn banned!`,
    });
    return new Response('OK');
  }

  await postToTelegramApi(botToken, 'sendMessage', {
    chat_id: superGroupChatId,
    message_thread_id: topicId,
    text: `Successfully UN-BAN this topic for receiving private message!`,
  });

  if (isSilent) return new Response('OK');
  const chatId = topicToFromChat.get(topicId)
  await postToTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: `You have been UN-BANNED for sending messages!`,
  });
  return new Response('OK');
}

// ---------------------------------------- FIX SETTING ----------------------------------------

/**
 * 修复置顶消息
 * Fix pinned message
 * @param {string} botToken - 机器人令牌
 * @param {number} chatId - 聊天ID
 * @param {string} text - 消息文本
 * @param {number} oldPinMsgId - 旧的置顶消息ID
 * @returns {Promise<void>}
 */
export async function fixPinMessage(botToken, chatId, text, oldPinMsgId) {
  const sendMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: text,
  })).json();
  if (sendMessageResp.ok) {
    await postToTelegramApi(botToken, 'pinChatMessage', {
      chat_id: chatId,
      message_id: sendMessageResp.result.message_id,
    });
    await postToTelegramApi(botToken, 'unpinChatMessage', {
      chat_id: chatId,
      message_id: oldPinMsgId,
    });
  }
}

// ---------------------------------------- TOPIC COMMENT NAME ----------------------------------------

/**
 * 处理话题备注名编辑
 * Process topic comment name edit
 * @param {string} botToken - 机器人令牌
 * @param {string} ownerUid - 所有者用户ID
 * @param {number} topicId - 话题ID
 * @param {number} fromChatId - 访客聊天ID
 * @param {string} newTotalName - 新的完整名称
 * @param {object} metaDataMessage - 元数据消息对象
 * @returns {Promise<void>}
 */
export async function processTopicCommentNameEdit(botToken, ownerUid, topicId, fromChatId, newTotalName, metaDataMessage) {
  if (!newTotalName) return;
  const oldText = metaDataMessage.text;
  let commentName = newTotalName.includes('|') ?
      newTotalName.split('|')[0].trim().replace(/[:;]/g, '') : '';

  const escapeRegExp = str => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const checkRegex = new RegExp(`;${topicId}:b?${fromChatId}:${escapeRegExp(commentName)}(?:[;^])`, 'g');
  const isMatch = checkRegex.test(oldText);
  if (isMatch) {
    return;
  }
  const replaceRegex = new RegExp(`;${topicId}:(b?)${fromChatId}(?::[^;]*)?`, 'g');
  const newText = oldText.replace(replaceRegex, `;${topicId}:$1${fromChatId}:${commentName}`);
  await postToTelegramApi(botToken, 'editMessageText', {
    chat_id: ownerUid,
    message_id: metaDataMessage.message_id,
    text: newText,
  });
}
