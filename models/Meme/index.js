import { Config } from '#components'
import { Utils } from '#models'

import { handleArgs } from './args.js'
import { handleImages } from './images.js'
import { preset } from './preset.js'
import { handleTexts } from './texts.js'

/**
 * 生成表情包
 * @param {Object} e 事件对象
 * @param {string} memeKey 表情模板标识
 * @param {number} min_texts 最小文字数量
 * @param {number} max_texts 最大文字数量
 * @param {number} min_images 最小图片数量
 * @param {number} max_images 最大图片数量
 * @param {string[]} default_texts 默认文字数组
 * @param {string} args_type 参数类型
 * @param {string} userText 用户输入文本
 * @param {boolean} isPreset 是否为预设模式
 * @param {object} extraData 预设模式下带 { Preset }
 * @returns {Promise<string>} 生成的表情包图片base64 数据
 */
async function make (
  e,
  memeKey,
  min_texts,
  max_texts,
  min_images,
  max_images,
  default_texts,
  args_type,
  userText,
  isPreset = false,
  { Preset } = {}
) {
  const formData = new FormData()
  /* 引用消息的发送者（历史消息可能为空数组或缺少 sender，统一交给 Common 保护） */
  const quotedUser = await Utils.Common.getQuotedUser(e)
  const allUsers = [
    ...new Set([
      ...e.message
        .filter(m => m?.type === 'at')
        .map(at => at?.qq?.toString() ?? ''),
      ...[ ...userText.matchAll(/@\s*(\d+)/g) ].map(match => match[1] ?? '')
    ])
  ].filter(id => id && id !== quotedUser)

  if (userText) {
    userText = userText.replace(/@\s*\d+/g, '').trim()
  } else {
    userText = ''
  }


  try {
    /**
     * 处理参数类型
     */
    if (args_type !== null) {
      const args = await handleArgs(e, memeKey, userText, allUsers, formData, isPreset, Preset)
      if (!args.success) {
        throw new Error(args.message)
      }
      userText = args.text
    }

    /**
     * 处理图片类型
     */
    if (max_images !== 0) {
      const images = await handleImages(e, memeKey, userText, min_images, max_images, allUsers, formData)
      if (!images.success) {
        throw new Error(images.message)
      }
      userText = images.userText
    }

    /**
     * 处理文字类型
     */
    if (max_texts !== 0) {
      const finalTexts = await handleTexts(e, userText, min_texts, max_texts, default_texts, allUsers, formData)
      if (!finalTexts.success) {
        throw new Error(finalTexts.message)
      }
    }

    const result = await Utils.Tools.request(memeKey, formData, 'arraybuffer')
    if (!result.success) throw new Error(result.message)
    if (Config.stat.enable) {
      const stat = await Utils.Common.getStat(memeKey)
      await Utils.Common.addStat(memeKey, stat + 1)
    }
    const base64Image = await Utils.Common.getImageBase64(result.data, true)

    return base64Image
  } catch (error) {
    logger.error(error.message)
    let errorMessage
    try {
      const parsedError = JSON.parse(error.message)
      errorMessage = parsedError.detail
    } catch (parseError) {
      errorMessage = error.message
    }

    throw new Error(errorMessage)
  }
}

export { make, preset }
