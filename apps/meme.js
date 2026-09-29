import { Config, Version } from '#components'
import { Meme, Utils } from '#models'

let memeRegExp, presetRegExp

/**
 * 生成正则表达式
 * @param {Function} getKeywords 获取关键词的函数
 * @returns {RegExp | null}
 */
const createRegex = async (getKeywords) => {
  const keywords = await getKeywords()
  if (!keywords) return null

  const prefix = Config.meme.forceSharp ? '^#' : '^#?'
  /* 长关键词优先，避免 "抱抱" 被短关键词 "抱" 抢先匹配后又被防误触发拦截 */
  const sortedKeywords = [ ...keywords ].sort((a, b) => b.length - a.length)

  /* 只有会"吃掉"更长关键词的短词才需要边界断言，其余保持原样以避免误伤
     （例如 "滑稽" 不会被 "滑稽撅" 遮蔽，加了断言反而无法触发） */
  const keywordSet = new Set(sortedKeywords)
  const toBoundary = new Set()
  for (const other of sortedKeywords) {
    for (let i = 1; i < other.length; i++) {
      const head = other.slice(0, i)
      if (keywordSet.has(head)) toBoundary.add(head)
    }
  }

  const escape = (keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = sortedKeywords
    .map((keyword) => {
      const escaped = escape(keyword)
      /* 后面不能紧跟中文正文，否则让位给更长的关键词 */
      return toBoundary.has(keyword) ? `(?:${escaped})(?![\\u4e00-\\u9fff])` : escaped
    })
    .join('|')

  return new RegExp(`${prefix}(${body})(.*)`, 'i')
}

/**
 * 刷新关键词正则
 * createRegex 是异步的，先在闭包里算好再赋值，避免读取时拿到 Promise
 * @returns {Promise<boolean>}
 */
const refreshRegExp = async () => {
  const [ nextMeme, nextPreset ] = await Promise.all([
    createRegex(() => Utils.Tools.getAllKeyWords('meme')),
    createRegex(() => Utils.Tools.getAllKeyWords('preset'))
  ])
  memeRegExp = nextMeme
  presetRegExp = nextPreset
  return true
}

await refreshRegExp()

/* 导出 live binding：update.js 刷新后能读到最新正则 */
export { memeRegExp, presetRegExp }

export class meme extends plugin {
  constructor () {
    super({
      name: '清语表情:表情包生成',
      event: 'message',
      priority: -Infinity,
      rule: [
        {
          reg: memeRegExp,
          fnc: 'meme'
        },
        {
          reg: presetRegExp,
          fnc: 'preset'
        }
      ]
    })
  }

  /**
   * 更新正则
   */
  async updateRegExp () {
    await refreshRegExp()

    this.rule = [
      {
        reg: memeRegExp,
        fnc: 'meme'
      },
      {
        reg: presetRegExp,
        fnc: 'preset'
      }
    ]

    return true
  }

  async meme (e) {
    return this.validatePrepareMeme(e, memeRegExp, Utils.Tools.getKey)
  }

  async preset (e) {
    return this.validatePrepareMeme(
      e,
      presetRegExp,
      Utils.Tools.getKey,
      true,
      'preset'
    )
  }
  /**
   * 通用处理函数, 用于验证权限获取需要的参数之类的
   */
  async validatePrepareMeme (
    e,
    regExp,
    getKeyFunc,
    isPreset = false,
    type = 'meme'
  ) {
    if (!Config.meme.enable) return false
    const message = (e.msg || '').trim()
    const match = message.match(regExp)
    if (!match) return false

    const matchedKeyword = match[1]
    const userText = match[2]?.trim() || ''
    if (!matchedKeyword) return false

    const memeKey = await getKeyFunc(matchedKeyword, type)
    if (!memeKey) return false

    /** 用户权限检查 */
    if (!this.checkUserAccess(e.user_id)) return false

    /* 黑名单检查 */
    if (
      Config.access.blackListEnable &&
      (await Utils.Tools.isBlacklisted(matchedKeyword))
    ) {
      logger.info(
        `[清语表情] 该表情 "${matchedKeyword}" 在禁用列表中，跳过生成`
      )
      return false
    }

    const params = await Utils.Tools.getParams(memeKey)
    if (!params) return false

    /* 防误触发 */
    if (params.min_texts === 0 && params.max_texts === 0 && userText) {
      const trimmedText = userText.trim()
      if (
        !/^(@\s*\d+\s*)+$/.test(trimmedText) &&
        !/^(#\S+\s+[^#]+(?:\s+#\S+\s+[^#]+)*)$/.test(trimmedText)
      ) {
        return false
      }
    }

    const extraData = isPreset
      ? { Preset: await Utils.Tools.getPreseInfo(matchedKeyword) }
      : {}

    return this.makeMeme(e, memeKey, params, userText, isPreset, extraData)
  }

  /**
   * 用户权限检查
   */
  checkUserAccess (userId) {
    if (!Config.access.enable) return true

    if (
      (Config.access.mode === 0 &&
        !Config.access.userWhiteList.includes(userId)) ||
      (Config.access.mode === 1 && Config.access.userBlackList.includes(userId))
    ) {
      logger.info(
        `[${Version.Plugin_AliasName}] 用户 ${userId} 没有权限，跳过生成`
      )
      return false
    }
    return true
  }

  /**
   * 调用 Meme 生成方法
   */
  async makeMeme (e, memeKey, params, userText, isPreset, extraData) {
    try {
      const result = await Meme.make(
        e,
        memeKey,
        params.min_texts,
        params.max_texts,
        params.min_images,
        params.max_images,
        params.default_texts,
        params.args_type,
        userText,
        isPreset,
        extraData
      )
      await e.reply(segment.image(result), Config.meme.reply)
      return true
    } catch (error) {
      logger.error(error.message)
      if (Config.meme.errorReply) {
        await e.reply(
          `[${Version.Plugin_AliasName}] 生成表情失败, 错误信息: ${error.message}`
        )
      }
      return false
    }
  }
}

export { refreshRegExp }
