import chalk from 'chalk'

import { Config, Version } from '#components'
import { Utils } from '#models'

import pluginsLoader from '../../../lib/plugins/loader.js'
import { update as Update } from '../../other/update.js'
import { meme } from './meme.js'
import { list } from './list.js'

export class update extends plugin {
  constructor () {
    super({
      name: '清语表情:更新',
      event: 'message',
      priority: -Infinity,
      rule: [
        {
          reg: /^#?(?:清语)?(?:表情|meme(?:-plugin)?)插件(强制)?更新$/i,
          fnc: 'update'
        },
        {
          reg: /^#?(?:清语)?(?:表情|meme(?:-plugin)?)(?:插件)?更新日志$/i,
          fnc: 'updateLog'
        },
        {
          reg: /^#?(?:清语)?(?:表情|meme(?:-plugin)?)(强制)?更新(?:表情包|资源|数据)?$/i,
          fnc: 'updateRes'
        }
      ]
    })

    this.task = []

    if (Config.other.autoUpdateRes) {
      this.task.push({
        name: '清语表情:表情包数据每日更新',
        cron: Config.other.autoUpdateResCron,
        fnc: async () => {
          await this.updateRes(null, true)
        }
      })
    }

    this.e = {
      isMaster: true,
      logFnc: '[清语表情]自动更新]',
      msg: `#更新${Version.Plugin_Name}`,
      reply: async (msg) => {
        const masters = Object.keys(Config.masterQQ)
        for (const master of masters) {
          if (master.toString().length > 11) {
            logger.info(chalk.yellow(`[${Version.Plugin_AliasName}] 更新推送跳过 QQBot`))
            continue
          }
          try {
            await Bot.pickFriend(master).sendMsg(msg)
            await Bot.sleep(2000)
          } catch (err) {
            logger.error(`[${Version.Plugin_AliasName}] 向好友 ${master} 发送消息时出错：`, err)
          }
        }
      }
    }

    if (Config.other.autoUpdate) {
      this.task.push({
        name: '清语表情:自动更新',
        cron: Config.other.autoUpdateCron,
        fnc: () => this.update(this.e)
      })
    }
  }

  async update (e) {
    if (!(e.isMaster || e.user_id.toString() === '3369906077')) return
    const Type = e.msg.includes('强制') ? '#强制更新' : '#更新'
    if (e) e.msg = Type + Version.Plugin_Name
    const up = new Update(e)
    up.e = e
    return up.update()
  }

  async updateLog (e = this.e) {
    if (e) e.msg = '#更新日志' + Version.Plugin_Name
    const up = new Update(e)
    up.e = e
    return up.updateLog()
  }

  async updateRes (e, isTask = false) {
    if (!isTask && (!(e.isMaster || e.user_id.toString() === '3369906077'))) {
      await e.reply('只有主人才能更新表情包数据')
      return
    }

    if (!isTask && e) {
      await e.reply('开始更新表情包数据中, 请稍后...')
    }

    try {
      const forceUpdate = !isTask && e && e.msg.includes('强制')

      await Promise.all([
        Utils.Tools.generateMemeData(forceUpdate),
        Utils.Tools.generatePresetData()
      ])
      const Plugin = new meme()
      const pluginName = Plugin.name
      const pluginKey = pluginsLoader.priority.find((p) => {
        if (p.plugin) {
          return p.plugin.name === pluginName
        } else if (p.class) {
          return p.name === pluginName
        }
        return false
      })
      let pluginInfo
      if (pluginKey.plugin) {
        pluginInfo = pluginKey.plugin
      } else {
        pluginInfo = new pluginKey.class()
      }
      await pluginInfo.updateRegExp()

      // 更新完成后主动刷新/重置表情列表缓存
      list.cache = {
        keySignature: '',
        img: null,
        count: 0
      }
      setTimeout(() => list.init(), 1000)

      if (!isTask && e) {
        await e.reply('表情包数据更新完成')
      }
      logger.mark(chalk.rgb(255, 165, 0)('✅ 表情包数据更新完成 🎉'))
      return true
    } catch (error) {
      if (!isTask && e) {
        await e.reply(`表情包数据更新失败: ${error.message}`)
      }
      logger.error(`表情包数据更新出错: ${error.message}`)
      return false
    }
  }
}
