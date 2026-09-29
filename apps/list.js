import chalk from 'chalk'

import { Config, Render, Version } from '#components'
import { Utils } from '#models'

export class list extends plugin {
  constructor () {
    super({
      name: '清语表情:列表',
      event: 'message',
      priority: -Infinity,
      rule: [ { reg: /^#?(?:(清语)?表情|meme(?:-plugin)?)列表$/i, fnc: 'list' } ]
    })
  }

  static cache = {
    keySignature: '',
    img: null,
    count: 0
  }

  static isRendering = false

  /** generateCache 在渲染中返回它，调用方据此区分"正在生成"和"没有数据" */
  static RENDERING = { rendering: true }

  static async init () {
    if (!Config.meme.enable) return
    try {
      logger.info(chalk.bold.magenta(`[${Version.Plugin_AliasName}] ⏳ 正在后台预加载表情列表...`))

      await list.generateCache()

      if (list.cache.img) {
        logger.info(chalk.bold.magenta(`[${Version.Plugin_AliasName}] 🎉 表情列表预加载完成，当前收录: ${list.cache.count}`))
      }
    } catch (e) {
      logger.error(`[${Version.Plugin_AliasName}] 表情列表预加载失败`, e)
    }
  }

  static async generateCache (providedKeys = null) {
    if (list.isRendering) return list.RENDERING
    list.isRendering = true

    try {
      const keys = providedKeys || (await Utils.Tools.getAllKeys() || []).sort()
      const currentSignature = JSON.stringify(keys)

      if (list.cache.keySignature === currentSignature && list.cache.img) {
        return list.cache.img
      }

      const tasks = keys.map(async (key) => {
        const [ keyWords, params ] = await Promise.all([
          Utils.Tools.getKeyWords(key),
          Utils.Tools.getParams(key)
        ])

        if (!keyWords || keyWords.length === 0) return null

        const { min_texts = 0, min_images = 0, args_type = null } = params || {}

        const types = []
        if (min_texts >= 1) types.push('text')
        if (min_images >= 1) types.push('image')
        if (args_type !== null) types.push('arg')

        return {
          name: keyWords[0],
          types
        }
      })

      const memeList = (await Promise.all(tasks)).filter(item => item !== null)
      const realTotal = memeList.length

      if (realTotal === 0) return null

      const img = await Render.render('list/index', {
        memeList,
        total: realTotal
      })

      list.cache = {
        keySignature: currentSignature,
        img,
        count: realTotal
      }

      return img

    } catch (error) {
      logger.error('生成表情列表缓存失败:', error)
      throw error
    } finally {
      list.isRendering = false
    }
  }

  async list (e) {
    if (!Config.meme.enable) return false

    try {
      const keys = (await Utils.Tools.getAllKeys() || []).sort()
      const currentSignature = JSON.stringify(keys)

      if (list.cache.keySignature === currentSignature && list.cache.img) {
        await e.reply(list.cache.img)
        return true
      }

      /* 命中已有缓存但数据变了：先给个提示，再重新渲染 */
      if (list.cache.keySignature !== '' && !list.isRendering) {
        await e.reply(`[${Version.Plugin_AliasName}] 表情已更新请耐心等待...`, true)
      }

      const img = await list.generateCache(keys)

      /* 已有渲染在进行：回缓存图（若有），否则告知正在生成，不要谎报"没有数据" */
      if (img === list.RENDERING) {
        if (list.cache.img) {
          await e.reply(list.cache.img)
        } else {
          await e.reply(`[${Version.Plugin_AliasName}] 表情列表正在生成中，请稍后再试`, true)
        }
        return true
      }

      if (!img) {
        await e.reply(`[${Version.Plugin_AliasName}]没有找到表情列表, 请使用[#表情更新], 稍后再试`, true)
        return true
      }
      await e.reply(img)
      return true

    } catch (error) {
      logger.error('加载表情列表失败:', error)
      await e.reply('加载表情列表失败，请稍后重试', true)
      return true
    }
  }
}

// 插件加载 5 秒后自动触发预加载
setTimeout(() => list.init(), 5000)
