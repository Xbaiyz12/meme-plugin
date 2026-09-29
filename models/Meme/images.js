import { Config } from '#components'
import { Utils } from '#models'

/**
 * 取得当前生效的保护 QQ 名单，以及触发者本人是否受保护
 * @param {object} e - 消息事件对象
 * @returns {Promise<{protectedIds: Set<string>, triggerIsProtected: boolean}>}
 */
async function getProtectedInfo (e) {
  if (!Config.protect.enable) {
    return { protectedIds: new Set(), triggerIsProtected: false }
  }

  const masterQQArray = Config.protect.master
    ? (Array.isArray(Config.masterQQ) ? Config.masterQQ : [ Config.masterQQ ]).map(String)
    : []
  const protectUsers = Config.protect.userEnable
    ? (Array.isArray(Config.protect.user) ? Config.protect.user : [ Config.protect.user ]).map(String)
    : []

  const protectedIds = new Set([ ...masterQQArray, ...protectUsers ].filter(Boolean))
  const triggerIsProtected = [ e.user_id, e.operator_id ]
    .filter(Boolean)
    .some((id) => protectedIds.has(String(id)))

  return { protectedIds, triggerIsProtected }
}

async function handleImages (e, memeKey, userText, min_images, max_images, allUsers, formData) {
  const messageImages = await Utils.Common.getImage(e)
  /** 头像统一存成 { qq, buffer }，表情保护按 qq 精确剔除，不依赖下标 */
  let userAvatars = []

  if (allUsers.length > 0) {
    userAvatars = await Utils.Common.getAvatar(e, allUsers)
  }

  /** 判断触发者本人是否也在保护名单里（自己用被保护的表情时不需要保护） */
  const { protectedIds, triggerIsProtected } = await getProtectedInfo(e)

  /** 只要一张图且没有消息图片时，先补上触发者头像，保证有"换人"的备选 */
  if (min_images === 1 && messageImages.length === 0) {
    const [ triggerAvatar ] = await Utils.Common.getAvatar(e, [ e.user_id ])
    if (triggerAvatar) {
      userAvatars.push(triggerAvatar)
    }
  }

  if (messageImages.length + userAvatars.length < min_images) {
    const [ triggerAvatar ] = await Utils.Common.getAvatar(e, [ e.user_id ])
    if (triggerAvatar) {
      userAvatars.unshift(triggerAvatar)
    }
  }

  /** 表情保护逻辑 */
  if (Config.protect.enable && protectedIds.size > 0) {
    const protectList = Config.protect.list
    if (protectList.length > 0) {
      /** 处理表情保护列表可能含有关键词 */
      const memeKeys = await Promise.all(protectList.map(async item => {
        const key = await Utils.Tools.getKey(item, 'meme')
        return key || item
      }))
      if (memeKeys.includes(memeKey) && !triggerIsProtected) {
        const protectAvatar = userAvatars.find((item) => protectedIds.has(String(item.qq)))
        if (protectAvatar) {
          /* 把被保护者移出图片序列：能剔除就剔除，只剩一张时用触发者头像顶替 */
          const rest = userAvatars.filter((item) => item !== protectAvatar)
          if (rest.length > 0) {
            userAvatars = rest
          } else {
            const [ triggerAvatar ] = await Utils.Common.getAvatar(e, [ e.user_id ])
            if (triggerAvatar) userAvatars = [ triggerAvatar ]
          }
        }
      }
    }
  }

  const finalImages = [ ...userAvatars.map((item) => item.buffer), ...messageImages ].slice(0, max_images)

  finalImages.forEach((buffer, index) => {
    formData.append('images', new Blob([ buffer ], { type: 'image/png' }), `image${index}.png`)
  })

  return finalImages.length < min_images
    ? {
      success: false,
      userText,
      message: `该表情需要${min_images} ~ ${max_images}张图片`
    }
    : {
      success: true,
      userText
    }
}

export { handleImages }
