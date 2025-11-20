/**
 * 验证管理器 - 处理人机验证逻辑
 * Verification Manager - Handles human verification logic
 */

/**
 * 生成算术挑战
 * Generate an arithmetic challenge with two single-digit numbers
 * @returns {{num1: number, num2: number, answer: number, question: string}}
 */
export function generateChallenge() {
  // 生成1-9范围内的随机数字
  const num1 = Math.floor(Math.random() * 9) + 1;
  const num2 = Math.floor(Math.random() * 9) + 1;
  const answer = num1 + num2;
  
  // 格式化挑战文本（英文）
  const question = `${num1} + ${num2} = ?`;
  
  return {
    num1,
    num2,
    answer,
    question
  };
}

/**
 * 从元数据字符串解析验证状态
 * Parse verification status from metadata string
 * @param {number} fromChatId - 访客的聊天ID
 * @param {string} metaDataText - 元数据消息文本
 * @returns {{isVerified: boolean, isBanned: boolean, currentAnswer: number, attempts: number, lastAttemptDate: string, failedDays: number}}
 */
export function parseVerificationStatus(fromChatId, metaDataText) {
  // 默认状态：未验证
  const defaultStatus = {
    isVerified: false,
    isBanned: false,
    currentAnswer: 0,
    attempts: 0,
    lastAttemptDate: '',
    failedDays: 0
  };
  
  if (!metaDataText) {
    return defaultStatus;
  }
  
  // 查找访客记录
  const metaDataSplit = metaDataText.split(";");
  for (let i = 1; i < metaDataSplit.length; i++) {
    const parts = metaDataSplit[i].split(":");
    if (parts.length < 2) continue;
    
    const topicId = parseInt(parts[0]);
    if (!topicId) continue;
    
    const fromChatPart = parts[1];
    
    // 检查是否是封禁状态
    if (fromChatPart.startsWith('b')) {
      const chatId = parseInt(fromChatPart.substring(1));
      if (chatId === fromChatId) {
        return {
          ...defaultStatus,
          isBanned: true
        };
      }
    }
    // 检查是否是未验证状态（带验证前缀）
    else if (fromChatPart.startsWith('v')) {
      // 格式: v{answer}_{attempts}_{lastDate}_{failedDays}_{fromChatId}
      const verificationMatch = fromChatPart.match(/^v(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/);
      if (verificationMatch) {
        const chatId = parseInt(verificationMatch[5]);
        if (chatId === fromChatId) {
          return {
            isVerified: false,
            isBanned: false,
            currentAnswer: parseInt(verificationMatch[1]),
            attempts: parseInt(verificationMatch[2]),
            lastAttemptDate: verificationMatch[3],
            failedDays: parseInt(verificationMatch[4])
          };
        }
      }
    }
    // 已验证状态（无前缀）
    else {
      const chatId = parseInt(fromChatPart);
      if (chatId === fromChatId) {
        return {
          ...defaultStatus,
          isVerified: true
        };
      }
    }
  }
  
  return defaultStatus;
}

/**
 * 将验证状态序列化为元数据前缀格式
 * Serialize verification status to metadata prefix format
 * @param {number} fromChatId - 访客的聊天ID
 * @param {{isVerified: boolean, isBanned: boolean, currentAnswer: number, attempts: number, lastAttemptDate: string, failedDays: number}} status - 验证状态对象
 * @returns {string} - 序列化后的前缀字符串
 */
export function serializeVerificationStatus(fromChatId, status) {
  if (status.isBanned) {
    return `b${fromChatId}`;
  }
  
  if (status.isVerified) {
    return `${fromChatId}`;
  }
  
  // 未验证状态
  return `v${status.currentAnswer}_${status.attempts}_${status.lastAttemptDate}_${status.failedDays}_${fromChatId}`;
}

/**
 * 更新元数据消息中的访客验证状态
 * Update visitor verification status in metadata message
 * @param {string} metaDataText - 原始元数据文本
 * @param {number} topicId - 话题ID
 * @param {number} fromChatId - 访客的聊天ID
 * @param {{isVerified: boolean, isBanned: boolean, currentAnswer: number, attempts: number, lastAttemptDate: string, failedDays: number}} status - 新的验证状态
 * @returns {string} - 更新后的元数据文本
 */
export function updateVerificationStatusInMetadata(metaDataText, topicId, fromChatId, status) {
  if (!metaDataText) {
    return metaDataText;
  }
  
  const serializedStatus = serializeVerificationStatus(fromChatId, status);
  const metaDataSplit = metaDataText.split(";");
  
  // 查找并更新访客记录
  for (let i = 1; i < metaDataSplit.length; i++) {
    const parts = metaDataSplit[i].split(":");
    if (parts.length < 2) continue;
    
    const currentTopicId = parseInt(parts[0]);
    if (currentTopicId !== topicId) continue;
    
    // 找到对应的话题，更新fromChatId部分
    const fromChatPart = parts[1];
    
    // 检查是否匹配当前访客
    let matches = false;
    if (fromChatPart.startsWith('b')) {
      const chatId = parseInt(fromChatPart.substring(1));
      matches = (chatId === fromChatId);
    } else if (fromChatPart.startsWith('v')) {
      const verificationMatch = fromChatPart.match(/^v\d+_\d+_\d+_\d+_(\d+)$/);
      if (verificationMatch) {
        matches = (parseInt(verificationMatch[1]) === fromChatId);
      }
    } else {
      const chatId = parseInt(fromChatPart);
      matches = (chatId === fromChatId);
    }
    
    if (matches) {
      // 替换fromChatId部分
      parts[1] = serializedStatus;
      metaDataSplit[i] = parts.join(":");
      break;
    }
  }
  
  return metaDataSplit.join(";");
}

/**
 * 获取当前日期字符串（YYYYMMDD格式）
 * Get current date string in YYYYMMDD format
 * @returns {string}
 */
export function getCurrentDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 检查访客是否需要验证
 * Check if visitor needs verification
 * @param {number} fromChatId - 访客的聊天ID
 * @param {string} metaDataText - 元数据消息文本
 * @returns {boolean}
 */
export function needsVerification(fromChatId, metaDataText) {
  const status = parseVerificationStatus(fromChatId, metaDataText);
  return !status.isVerified && !status.isBanned;
}

/**
 * 检查是否是新的一天（用于重置尝试次数）
 * Check if it's a new day (for resetting attempts)
 * @param {string} lastAttemptDate - 上次尝试日期（YYYYMMDD格式）
 * @returns {boolean}
 */
export function isNewDay(lastAttemptDate) {
  if (!lastAttemptDate) return true;
  const currentDate = getCurrentDateString();
  return currentDate !== lastAttemptDate;
}

/**
 * 验证访客的答案
 * Verify visitor's answer
 * @param {number} fromChatId - 访客的聊天ID
 * @param {string|number} answer - 访客提供的答案
 * @param {string} metaDataText - 元数据消息文本
 * @returns {{isCorrect: boolean, newStatus: object, shouldBan: boolean, shouldReset: boolean}}
 */
export function verifyAnswer(fromChatId, answer, metaDataText) {
  const status = parseVerificationStatus(fromChatId, metaDataText);
  const currentDate = getCurrentDateString();
  
  // 解析答案为数字
  const numericAnswer = parseInt(answer);
  if (isNaN(numericAnswer)) {
    // 无效答案视为错误答案
    return handleWrongAnswer(status, currentDate);
  }
  
  // 检查答案是否正确
  const isCorrect = numericAnswer === status.currentAnswer;
  
  if (isCorrect) {
    // 答案正确，标记为已验证
    return {
      isCorrect: true,
      newStatus: {
        ...status,
        isVerified: true,
        currentAnswer: 0,
        attempts: 0,
        lastAttemptDate: '',
        failedDays: 0
      },
      shouldBan: false,
      shouldReset: false
    };
  } else {
    return handleWrongAnswer(status, currentDate);
  }
}

/**
 * 处理错误答案
 * Handle wrong answer
 * @param {object} status - 当前验证状态
 * @param {string} currentDate - 当前日期
 * @returns {{isCorrect: boolean, newStatus: object, shouldBan: boolean, shouldReset: boolean}}
 */
function handleWrongAnswer(status, currentDate) {
  const isNewDayFlag = isNewDay(status.lastAttemptDate);
  
  let newAttempts = status.attempts + 1;
  let newFailedDays = status.failedDays;
  
  // 如果是新的一天
  if (isNewDayFlag) {
    // 如果之前已经失败过（attempts >= 3），增加失败天数
    if (status.attempts >= 3) {
      newFailedDays = status.failedDays + 1;
    }
    // 重置尝试次数
    newAttempts = 1;
  }
  
  // 检查是否应该封禁（连续两天失败）
  const shouldBan = newFailedDays >= 2;
  
  // 检查是否应该重置（跨天且之前未达到3次）
  const shouldReset = isNewDayFlag && status.attempts < 3;
  
  // 生成新的挑战
  const newChallenge = generateChallenge();
  
  const newStatus = {
    ...status,
    currentAnswer: newChallenge.answer,
    attempts: newAttempts,
    lastAttemptDate: currentDate,
    failedDays: newFailedDays,
    isBanned: shouldBan
  };
  
  return {
    isCorrect: false,
    newStatus,
    newChallenge,
    shouldBan,
    shouldReset,
    attemptsExhausted: newAttempts >= 3
  };
}

/**
 * 为新访客初始化验证状态
 * Initialize verification status for new visitor
 * @returns {{isVerified: boolean, isBanned: boolean, currentAnswer: number, attempts: number, lastAttemptDate: string, failedDays: number, challenge: object}}
 */
export function initializeVerificationStatus() {
  const challenge = generateChallenge();
  const currentDate = getCurrentDateString();
  
  return {
    isVerified: false,
    isBanned: false,
    currentAnswer: challenge.answer,
    attempts: 0,
    lastAttemptDate: currentDate,
    failedDays: 0,
    challenge
  };
}
