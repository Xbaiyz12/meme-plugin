import { Config, Version } from '#components'
import { Meme, Utils } from '#models'

export class random extends plugin {
  constructor () {
    super({
      name: '清语表情:随机表情包',
      event: 'message',
      priority: -Infinity,
      rule: [
        {
          reg: /^#?(?:(清语)?表情|meme(?:-plugin)?)?随机(?:表情|meme)(包)?$/i,
          fnc: 'random'
        }
      ]
    })
  }

  async random (e) {
    if (!Config.meme.enable) return false
    try {
      const memeKeys = await Utils.Tools.getAllKeys() ?? null
      if (!memeKeys || memeKeys.length === 0) {
        throw new Error('未找到可用的表情包')
      }

      for (let i = memeKeys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[ memeKeys[i], memeKeys[j] ] = [ memeKeys[j], memeKeys[i] ]
      }

      for (const memeKey of memeKeys) {
        const params = await Utils.Tools.getParams(memeKey) ?? null
        if (!params) continue

        const { min_texts, max_texts, min_images, max_images, default_texts, args_type } = params
        /* 只挑"单文本"或"单图片"的表情，未填的部分交给 default_texts 兜底 */
        const isTextOnly = min_texts === 1 && max_texts === 1
        const isImageOnly = min_images === 1 && max_images === 1
        if (!isTextOnly && !isImageOnly) continue

        /* 需要文字但没有默认文本的表情必然失败，直接跳过，避免一次随机刷一屏警告 */
        if (isTextOnly && !isImageOnly && (!default_texts || default_texts.length === 0)) continue

        try {
          let keyWords = await Utils.Tools.getKeyWords(memeKey) ?? null
          keyWords = Array.isArray(keyWords) ? keyWords.map(word => `[${word}]`).join(' ') : '[无]'

          const result = await Meme.make(
            e,
            memeKey,
            min_texts,
            max_texts,
            min_images,
            max_images,
            default_texts,
            args_type,
            ''
          )

          if (!result) continue

          const replyMessage = [
            '本次随机表情信息如下:\n',
            `表情的名称: ${memeKey}\n`,
            `表情的别名: ${keyWords}\n`,
            segment.image(result)
          ]
          await e.reply(replyMessage)
          return true
        } catch (error) {
          /* 单个候选失败不能中断整个随机流程，换下一个候选继续试 */
          logger.warn(`随机表情生成失败(${memeKey}): ${error.message}`)
          continue
        }
      }

      throw new Error('未找到有效的表情包')

    } catch (error) {
      logger.error(error.message)
      if (Config.meme.errorReply) {
        await e.reply(`[${Version.Plugin_AliasName}] 生成随机表情失败, 错误信息: ${error.message}`)
      }
    }
  }
}
