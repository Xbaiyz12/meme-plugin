import _ from 'lodash'

import { Utils } from '#models'

async function handleArgs (e, memeKey, userText, allUsers, formData, isPreset, Preset) {
  const argsArray = {}

  /* 参数值只取一个 token，否则 "#number 1 你好" 会把正文一起吞进参数值 */
  const argsReg = /#(\S+)\s+(\S+)/g

  const argsMatches = userText.match(argsReg)
  if (argsMatches) {
    for (const match of argsMatches) {
      const [ _, key, value ] = match.match(/#(\S+)\s+(\S+)/)
      argsArray[key.toLowerCase()] = value
    }
  }
  if (isPreset && Preset?.arg_name) {
    argsArray[Preset.arg_name] = Preset.arg_value
  }

  const argsResult = await handle(e, memeKey, allUsers, argsArray)

  if (!argsResult.success) {
    return {
      success: argsResult.success,
      message: argsResult.message
    }
  }
  if (argsResult.argsString) {
    formData.append('args', argsResult.argsString)
  }

  return {
    success: true,
    text: userText.replace(argsReg, '').trim()
  }
}

async function handle (e, key, allUsers, args) {
  if (!args) args = {}

  const argsObj = {}
  const paramInfos = await Utils.Tools.getParamInfo(key)

  if (!paramInfos || paramInfos.length === 0) {
    return {
      success: false,
      message: '未找到任何参数信息'
    }
  }

  const paramMap = paramInfos.reduce((acc, { name }) => {
    acc[name.toLowerCase()] = name
    return acc
  }, {})

  for (const [ argName, argValue ] of Object.entries(args)) {
    const canonical = paramMap[argName.toLowerCase()]
    if (!canonical) {
      return {
        success: false,
        message: `该表情不支持参数：${argName}`
      }
    }
    argsObj[canonical] = argValue
  }

  const userInfos = [
    {
      text: await Utils.Common.getNickname(e, allUsers[0] || e.user_id),
      gender: await Utils.Common.getGender(e, allUsers[0] || e.user_id)
    }
  ]

  return {
    success: true,
    argsString: JSON.stringify({
      user_infos: userInfos,
      ...argsObj
    })
  }
}

export { handle, handleArgs }
