import { Config, Version } from '#components'
import { Meme, Utils } from '#models'

const pokeCoolDownMap = new Map()
/** 冷却记录上限，超过就清理过期项，避免长时间运行后无限增长 */
const POKE_COOLDOWN_MAX = 1000

/** 清理已过期的冷却记录 */
const cleanCoolDownMap = () => {
  if (pokeCoolDownMap.size < POKE_COOLDOWN_MAX) return
  const now = Date.now()
  const expireMs = Math.max(Config.meme.pokeLimit || 0, 1) * 1000
  for (const [ key, time ] of pokeCoolDownMap) {
    if (now - time > expireMs) pokeCoolDownMap.delete(key)
  }
}

export class pokeRandomMeme extends plugin {
  constructor () {
    super({
      name: '清语表情:戳一戳随机表情包',
      event: 'notice.*.poke',
      priority: -Infinity,
      rule: [
        {
          fnc: 'handlePoke'
        }
      ]
    })
  }

  async handlePoke () {
    const e = this.e

    /* 功能关闭时静默返回，不要每次戳一戳都写日志 */
    if (!Config.meme.enable || !Config.meme.pokeEnable) {
      return false
    }

    if (!e.message) {
      e.message = []
    }

    /* 兼容不同适配器的 id 类型差异（数字/字符串），用宽松比较 */
    const targetId = e.target_id || e.user_id
    if (String(targetId) !== String(e.self_id)) {
      return false
    }

    const operatorId = e.operator_id || e.user_id
    if (String(operatorId) === String(e.self_id)) {
      return false
    }

    const isGroup = !!e.group_id
    const pokeInfo = {
      operatorId: operatorId,
      targetId: targetId,
      isGroup: isGroup,
      groupId: e.group_id || null
    }

    logger.info(`戳一戳表情: ${pokeInfo.operatorId}(${operatorId}) ${isGroup ? '群聊' : '私聊'}戳了机器人`)

    const randomRate = Math.floor(Math.random() * 100) + 1
    if (randomRate > Config.meme.pokeProbability) {
      logger.info(`戳一戳触发概率不足（随机值:${randomRate}, 配置值:${Config.meme.pokeProbability}），跳过生成`)
      return false
    }

    const coolDownKey = `${pokeInfo.groupId || 'private'}-${pokeInfo.operatorId}`
    const lastTriggerTime = pokeCoolDownMap.get(coolDownKey) || 0
    const currentTime = Date.now()
    const coolDownMs = Config.meme.pokeLimit * 1000

    if (currentTime - lastTriggerTime < coolDownMs) {
      const remainTime = ((coolDownMs - (currentTime - lastTriggerTime)) / 1000).toFixed(1)
      logger.info(`戳一戳冷却中，剩余${remainTime}秒，跳过生成`)
      return false
    }

    cleanCoolDownMap()

    try {
      const allMemeKeys = await Utils.Tools.getAllKeys() ?? null
      if (!allMemeKeys || allMemeKeys.length === 0) {
        logger.warn('未找到可用的表情包')
        if (Config.meme.errorReply) {
          await e.reply(`[${Version.Plugin_AliasName}] 未找到可用的表情包`)
        }
        return false
      }

      const avatarRelatedKeys = []
      for (const key of allMemeKeys) {
        const params = await Utils.Tools.getParams(key)
        if (!params) continue

        const isAvatarMeme = params.min_images === 1
          && params.max_images === 1
          && params.min_texts === 0
          && params.max_texts === 0

        if (isAvatarMeme) {
          avatarRelatedKeys.push(key)
        }
      }

      if (avatarRelatedKeys.length === 0) {
        logger.warn('未找到仅需头像的表情包')
        if (Config.meme.errorReply) {
          await e.reply(`[${Version.Plugin_AliasName}] 未找到仅需头像的表情包`)
        }
        return false
      }

      for (let i = avatarRelatedKeys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[ avatarRelatedKeys[i], avatarRelatedKeys[j] ] = [ avatarRelatedKeys[j], avatarRelatedKeys[i] ]
      }

      let success = false
      let attemptedCount = 0
      const maxAttempts = 2

      for (const memeKey of avatarRelatedKeys) {
        if (attemptedCount >= maxAttempts) break
        attemptedCount++

        try {
          const params = await Utils.Tools.getParams(memeKey)
          if (!params) continue

          if (params.min_images !== 1 || params.max_images !== 1 || params.min_texts !== 0 || params.max_texts !== 0) {
            continue
          }

          logger.debug(`尝试生成头像表情: ${memeKey}`)

          const result = await Meme.make(
            e,
            memeKey,
            params.min_texts,
            params.max_texts,
            params.min_images,
            params.max_images,
            params.default_texts,
            params.args_type,
            '',
            false,
            {}
          )

          if (result) {
            pokeCoolDownMap.set(coolDownKey, currentTime)

            const keyWords = await Utils.Tools.getKeyWords(memeKey) ?? []
            const alias = Array.isArray(keyWords) ? keyWords.map(word => `[${word}]`).join(' ') : '[无]'

            const replyMessage = [
              '随机表情哦~:\n',
              `这是指令哦~: ${alias}\n`,
              segment.image(result)
            ]

            await e.reply(replyMessage)
            success = true
            logger.info(`成功生成头像表情: ${memeKey}`)
            break
          }
        } catch (makeError) {
          logger.warn(`生成头像表情 "${memeKey}" 失败: ${makeError.message}`)
          continue
        }
      }

      if (!success) {
        logger.info(`尝试${attemptedCount}个头像表情均失败`)
        if (Config.meme.errorReply) {
          await e.reply(`[${Version.Plugin_AliasName}] 戳一戳表情生成失败`)
        }
      }

    } catch (error) {
      logger.error(`戳一戳表情插件出错: ${error.message}`)
      logger.error(error.stack)

      if (Config.meme.errorReply) {
        await e.reply(`[${Version.Plugin_AliasName}] 戳一戳表情生成出错: ${error.message}`)
      }
    }

    return true
  }
}
