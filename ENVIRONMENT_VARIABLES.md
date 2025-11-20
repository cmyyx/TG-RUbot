# 环境变量配置指南 / Environment Variables Configuration Guide

本文档说明 TG-RUbot 所需的环境变量配置。

This document explains the environment variables required for TG-RUbot.

## 必需的环境变量 / Required Environment Variables

### PREFIX
- **说明**: URL 前缀，用于访问路径
- **Description**: URL prefix for access path
- **示例 / Example**: `public`
- **配置位置 / Configuration Location**: Cloudflare Dashboard > Worker Settings > Variables

### SECRET_TOKEN
- **说明**: 安全令牌，用于验证请求
- **Description**: Secret token for request validation
- **要求 / Requirements**: 
  - 至少16个字符 / At least 16 characters
  - 必须包含大写字母 / Must contain uppercase letters
  - 必须包含小写字母 / Must contain lowercase letters
  - 必须包含数字 / Must contain numbers
- **示例 / Example**: `YourSecretToken123`
- **配置位置 / Configuration Location**: Cloudflare Dashboard > Worker Settings > Variables (Secret)

## 可选的环境变量 / Optional Environment Variables

以下环境变量用于启用**自动置顶续期功能**。如果不配置，该功能将无法工作，但不会影响其他功能。

The following environment variables are for enabling the **automatic pin renewal feature**. If not configured, this feature won't work, but other features remain functional.

### BOT_TOKEN
- **说明**: 机器人 API Token
- **Description**: Bot API Token
- **获取方式 / How to Get**: 
  1. 在 Telegram 中打开 [@BotFather](https://t.me/BotFather)
  2. 发送 `/newbot` 创建机器人
  3. 按照提示完成设置
  4. BotFather 会提供 API Token
- **格式 / Format**: `123456789:ABCDEFGhijklmnopqrstuvwxyz`
- **配置位置 / Configuration Location**: Cloudflare Dashboard > Worker Settings > Variables (Secret)

### OWNER_UID
- **说明**: Telegram 用户 ID
- **Description**: Telegram User ID
- **获取方式 / How to Get**:
  1. 在 Telegram 中打开 [@userinfobot](https://t.me/userinfobot)
  2. 发送任意消息
  3. 机器人会返回您的用户 ID
- **格式 / Format**: `123456789` (纯数字)
- **配置位置 / Configuration Location**: Cloudflare Dashboard > Worker Settings > Variables (Plaintext)

## 配置步骤 / Configuration Steps

### Cloudflare Workers

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入您的 Worker 项目
3. 点击 **Settings** 标签页
4. 导航到 **Variables and Secrets**
5. 点击 **Add variable** 添加环境变量
6. 对于敏感信息（如 SECRET_TOKEN、BOT_TOKEN），选择 **Encrypt** 类型
7. 对于非敏感信息（如 PREFIX、OWNER_UID），选择 **Plaintext** 类型

### Vercel

1. 登录 Vercel Dashboard
2. 进入您的项目
3. 点击 **Settings** > **Environment Variables**
4. 添加所需的环境变量
5. 选择适用的环境（Production、Preview、Development）

## 自动置顶续期功能说明 / Automatic Pin Renewal Feature

### 功能描述 / Feature Description

自动置顶续期功能会在每周日午夜自动检查元数据置顶消息的年龄，如果超过6天，则自动创建新消息并重新置顶，确保系统长期稳定运行。

The automatic pin renewal feature checks the age of metadata pinned messages every Sunday at midnight. If older than 6 days, it automatically creates a new message and re-pins it to ensure long-term stable operation.

### 工作原理 / How It Works

1. Cloudflare Workers 的 Cron Trigger 每周日午夜触发
2. 系统使用 `BOT_TOKEN` 和 `OWNER_UID` 访问 Telegram API
3. 检查管理员私聊中的置顶消息年龄
4. 如果超过6天，创建新消息并重新置顶
5. 保持原有元数据内容不变

### 为什么需要这个功能？ / Why Is This Feature Needed?

Telegram 的置顶消息对机器人 API 来说有时效性。如果消息长时间（约14天）没有更新，机器人可能无法通过 API 访问到该消息，导致系统功能异常。自动续期功能可以防止这个问题。

Telegram's pinned messages have a time limit for bot API access. If a message hasn't been updated for a long time (about 14 days), the bot may not be able to access it via API, causing system malfunction. The automatic renewal feature prevents this issue.

## 故障排除 / Troubleshooting

### 自动续期不工作 / Automatic Renewal Not Working

1. 检查是否配置了 `BOT_TOKEN` 和 `OWNER_UID`
2. 检查 `BOT_TOKEN` 是否正确（可以在 @BotFather 中重新生成）
3. 检查 `OWNER_UID` 是否正确（应该是纯数字）
4. 查看 Worker 日志中是否有错误信息
5. 确认 Cron Trigger 已在 `wrangler.toml` 中配置

### 其他功能不工作 / Other Features Not Working

1. 检查 `PREFIX` 和 `SECRET_TOKEN` 是否正确配置
2. 确认 `SECRET_TOKEN` 符合要求（至少16位，包含大小写字母和数字）
3. 检查 Worker 是否成功部署
4. 查看 Worker 日志中的错误信息

## 安全建议 / Security Recommendations

1. **不要**将环境变量提交到版本控制系统
   **Do not** commit environment variables to version control
   
2. 定期更换 `SECRET_TOKEN`
   Regularly rotate `SECRET_TOKEN`
   
3. 妥善保管 `BOT_TOKEN`，不要分享给他人
   Keep `BOT_TOKEN` secure and do not share with others
   
4. 如果 `BOT_TOKEN` 泄露，立即在 @BotFather 中重新生成
   If `BOT_TOKEN` is compromised, regenerate it immediately in @BotFather

## 参考文件 / Reference Files

- `.env.example` - 环境变量配置示例 / Environment variables example
- `wrangler.toml` - Cloudflare Workers 配置文件 / Cloudflare Workers configuration
- `README.md` - 完整部署指南 / Complete deployment guide
