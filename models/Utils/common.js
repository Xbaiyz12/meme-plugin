import fs from 'node:fs/promises'

import { Config, Data, Version } from '#components'

import { db } from '../index.js'
import Request from './request.js'

const Common = {
  /**
   * 检查指定的文件是否存在
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} - 如果文件存在返回 true，否则返回 false
   */
  async fileExistsAsync (filePath) {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  },

  /**
   * 获取图片 Buffer
   * @param {string | Buffer} image - 图片地址或 Buffer
   * @returns {Promise<Buffer>} - 返回图片的 Buffer 数据
   * @throws {Error} - 如果图片地址为空或请求失败，则抛出异常
   */
  async getImageBuffer (image) {
    if (!image) throw new Error('图片地址不能为空')

    if (Buffer.isBuffer(image)) {
      return image
    }

    const response = await Request.get(image, {}, {}, 'arraybuffer')
    if (response.success) {
      return response.data
    } else {
      throw new Error('图片请求失败')
    }
  },

  /**
   * 获取图片 Base64 字符串
   * @param {string | Buffer} image - 图片的 URL、Buffer 或 Base64 字符串
   * @param {boolean} [withPrefix=false] - 是否添加 `base64://` 前缀
   * @returns {Promise<string>} - 返回 Base64 编码的图片字符串，可能包含 `base64://` 前缀
   * @throws {Error} - 如果图片地址为空或处理失败，则抛出异常
   */
  async getImageBase64 (image, withPrefix = false) {
    if (!image) {
      logger.error('图片地址不能为空')
      return null
    }

    if (typeof image === 'string' && image.startsWith('base64://')) {
      return withPrefix ? image : image.replace('base64://', '')
    }

    if (Buffer.isBuffer(image)) {
      const base64Data = image.toString('base64')
      return withPrefix ? `base64://${base64Data}` : base64Data
    }

    const response = await Request.get(image, {}, {}, 'arraybuffer')
    if (response.success) {
      const buffer = response.data
      const base64Data = Buffer.from(buffer).toString('base64')
      return withPrefix ? `base64://${base64Data}` : base64Data
    } else {
      logger.error(`图片处理失败, 错误信息: ${response.message}`)
      return null
    }
  },
  /**
   * 获取用户头像
   * 返回 { qq, buffer } 列表，调用方不用再靠下标去猜是哪个 QQ（部分失败时下标会错位）
   * @param {object} e - 消息事件对象
   * @param {string | string[]} userList - 单个或多个 QQ 号
   * @returns {Promise<Array<{qq: string, buffer: Buffer}>>} - 失败的会跳过，绝不返回 null
   * @throws {Error} - 用户列表为空时抛出异常
   */
  async getAvatar (e, userList) {
    if (!userList) {
      throw new Error('QQ 号不能为空')
    }
    if (!Array.isArray(userList)) userList = [ userList ]

    const cacheDir = `${Version.Plugin_Path}/data/avatar`

    if (Config.meme.cache && !await this.fileExistsAsync(cacheDir)) {
      await Data.createDir('data/avatar', '', false)
    }

    /**
     * 下载用户头像
     * @param {string} qq - QQ 号
     * @returns {Promise<Buffer>} - 返回头像 Buffer
     */
    const downloadAvatar = async (qq) => {
      const avatarUrl = await this.getAvatarURL(e, qq)

      if (!Config.meme.cache) {
        const response = await Request.get(avatarUrl, {}, {}, 'arraybuffer')
        if (response.success) {
          return response.data
        } else {
          throw new Error(`下载头像失败: ${avatarUrl}`)
        }
      }

      const cachePath = `${cacheDir}/avatar_${qq}.png`

      if (await this.fileExistsAsync(cachePath)) {
        const localStats = await fs.stat(cachePath)
        const remoteHeadResponse = await Request.head(avatarUrl).catch(() => null)

        if (remoteHeadResponse && remoteHeadResponse.success) {
          /* headers 在 remoteHeadResponse.headers，HEAD 的 body 里没有 last-modified */
          const lastModified = remoteHeadResponse.headers?.['last-modified']
          const remoteLastModified = lastModified ? new Date(lastModified) : null
          const localLastModified = localStats.mtime

          if (remoteLastModified && !isNaN(remoteLastModified.getTime()) && localLastModified >= remoteLastModified) {
            return await fs.readFile(cachePath)
          }
        }
      }

      const bufferResponse = await Request.get(avatarUrl, {}, {}, 'arraybuffer')
      if (bufferResponse.success) {
        const buffer = bufferResponse.data
        await fs.writeFile(cachePath, buffer)
        return buffer
      } else {
        throw new Error(`下载头像失败: ${avatarUrl}`)
      }
    }

    /* 单个头像失败不再让整批失败：返回成功的那部分，并带上对应 QQ */
    const results = await Promise.allSettled(userList.map((qq) => downloadAvatar(qq)))
    const avatars = []
    results.forEach((item, index) => {
      if (item.status === 'fulfilled' && item.value) {
        avatars.push({ qq: String(userList[index]), buffer: item.value })
      } else if (item.status === 'rejected') {
        logger.warn(`获取头像失败(${userList[index]}): ${item.reason?.message || item.reason}`)
      }
    })
    return avatars
  },
  /**
   * 获取引用消息的发送者 QQ
   * 历史消息可能返回空数组、也可能没有 sender，这里统一做保护
   * @param {object} e - 消息事件对象
   * @param {object|object[]|null} [resolvedSource] - 已经取到的引用消息，传入可避免重复请求
   * @returns {Promise<string|null>}
   */
  async getQuotedUser (e, resolvedSource = null) {
    let source = resolvedSource
    if (!source) {
      try {
        if (e.reply_id) {
          source = await e.getReply()
        } else if (e.source) {
          if (e.isGroup) {
            source = await Bot[e.self_id].pickGroup(e.group_id).getChatHistory(e.source.seq || e.reply_id, 1)
          } else if (e.isPrivate) {
            source = await Bot[e.self_id].pickFriend(e.user_id).getChatHistory(e.source.time || e.reply_id, 1)
          }
        }
      } catch (error) {
        logger.debug(`获取引用消息失败: ${error.message}`)
        return null
      }
    }

    if (!source) return null

    const item = Array.isArray(source) ? source[0] : source
    const sender = item?.sender?.user_id ?? item?.user_id

    return sender ? String(sender) : null
  },

  /**
   * 获取图片列表（包括消息和引用消息中的图片）
   * @param {object} e - 消息对象
   * @returns {Promise<Buffer[]>} - 返回图片 Buffer 数组
   */
  async getImage (e) {
    const imagesInMessage = e.message
      .filter((m) => m.type === 'image')
      .map((img) => img.url)

    const tasks = []

    /**
       * 获取引用消息中的图片
       */
    let quotedImages = []
    let source = null
    if (Config.meme.quotedImages) {
      if (e.reply_id) {
        source = await e.getReply()
      } else if (e.source) {
        if (e.isGroup) {
          source = await Bot[e.self_id].pickGroup(e.group_id).getChatHistory(e.source.seq || e.reply_id, 1)
        } else if (e.isPrivate) {
          source = await Bot[e.self_id].pickFriend(e.user_id).getChatHistory(e.source.time || e.reply_id, 1)
        }
      }
    }

    if (source) {
      const sourceArray = Array.isArray(source) ? source : [ source ]

      quotedImages = sourceArray
        .flatMap(item => item.message)
        .filter(msg => msg.type === 'image')
        .map(img => img.url)
    }

    /**
     * 如果没有引用消息中的图片，且消息中没有图片，则获取引用消息的发送者头像
     */
    if (
      quotedImages.length === 0 &&
      imagesInMessage.length === 0 &&
      source &&
      (e.source || e.reply_id)) {
      const quotedUser = await this.getQuotedUser(e, source)
      if (quotedUser) {
        const [ quotedAvatar ] = await this.getAvatar(e, [ quotedUser ])
        if (quotedAvatar?.buffer) {
          quotedImages.push(quotedAvatar.buffer)
        }
      }
    }

    /**
       * 引用消息中的图片任务
       */
    if (quotedImages.length > 0) {
      quotedImages.forEach((item) => {
        if (Buffer.isBuffer(item)) {
          tasks.push(Promise.resolve(item))
        } else {
          tasks.push(this.getImageBuffer(item))
        }
      })
    }

    /**
       * 消息中的图片任务
       */
    if (Config.meme.imagesInMessage) {
      if (imagesInMessage.length > 0) {
        tasks.push(...imagesInMessage.map((imageUrl) => this.getImageBuffer(imageUrl)))
      }
    }

    const results = await Promise.allSettled(tasks)
    const images = results
      .filter((res) => res.status === 'fulfilled' && res.value)
      .map((res) => res.value)
    return images
  },

  /**
   * 获取用户头像 URL
   * @param {object} e - 消息事件对象
   * @param {string} qq - QQ 号
   * @returns {Promise<string>} - 返回头像 URL
   */
  async getAvatarURL (e, qq) {
    if (!qq || !e) {
      throw new Error('QQ 号不能为空')
    }

    let avatarUrl = ''

    try {
      if (e.bot) {
        if (e.isGroup) {
          const member = e.bot.pickMember(e.group_id, qq)
          avatarUrl = await member.getAvatarUrl?.()
        } else if (e.isPrivate) {
          const friend = e.bot.pickFriend(qq)
          avatarUrl = await friend.getAvatarUrl?.()
        }
      } else if (typeof Bot !== 'undefined' && Bot[e.self_id]) {
        if (e.isGroup) {
          const member = Bot[e.self_id].pickGroup(e.group_id)?.pickMember?.(qq) || Bot[e.self_id].pickMember(e.group_id, qq)
          avatarUrl = await member?.getAvatarUrl?.()
        } else if (e.isPrivate) {
          const friend = Bot[e.self_id].pickFriend(qq)
          avatarUrl = await friend?.getAvatarUrl?.()
        }
      }
    } catch (err) {
    }

    return avatarUrl || `https://q1.qlogo.cn/g?b=qq&s=0&nk=${qq}`
  },

  /**
   * 获取用户昵称
   * @param {object} e - 消息事件对象
   * @param {string} qq - QQ 号
   * @returns {Promise<string>} - 返回用户昵称，若获取失败则返回 "未知"
   */
  async getNickname (e, qq) {
    if (!qq || !e) return '未知'

    try {
      if (e.isGroup) {
        const member = Bot[e.self_id].pickMember(e.group_id, qq)
        const memberInfo = await member.getInfo()
        return memberInfo.card || memberInfo.nickname || '未知'
      } else if (e.isPrivate) {
        const friend = Bot[e.self_id].pickFriend(qq)
        const friendInfo = await friend.getInfo()
        return friendInfo.nickname || '未知'
      }
    } catch {
      return '未知'
    }
  },

  /**
   * 获取用户性别
   * @param {object} e - 消息事件对象
   * @param {string} qq - QQ 号
   * @returns {Promise<string>} - 返回 'male'、'female' 或 'unknown'
   */
  async getGender (e, qq) {
    if (!qq || !e) return 'unknown'

    try {
      if (e.isGroup) {
        const member = Bot[e.self_id].pickMember(e.group_id, qq)
        const memberInfo = await member.getInfo()
        return memberInfo.sex || 'unknown'
      } else if (e.isPrivate) {
        const friend = Bot[e.self_id].pickFriend(qq)
        const friendInfo = await friend.getInfo()
        return friendInfo.sex || 'unknown'
      }
    } catch {
      return 'unknown'
    }
  },

  /**
   * 统计相关操作
   * @param {string} key - 统计项键名
   * @param {number} number - 统计数值
   * @returns {Promise<number|null>} - 返回更新后的统计数值或 null
   */
  async addStat (key, number) {
    return await db.stat.add(key, number) || null
  },

  async getStat (key) {
    return await db.stat.get(key, 'all') || null
  },

  async getStatAll () {
    return await db.stat.getAll() || null
  }
}

export { Common }
