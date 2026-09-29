import { meme } from '../db/index.js'

export const getMemeList = async () => {
  const keywordsRaw = await meme.getAllSelect('keyWords')

  const keywords = Array.from(new Set(
    keywordsRaw.flatMap(item => {
      try {
        return JSON.parse(item)
      } catch (e) {
        return []
      }
    })
  ))

  const keywordPromises1 = keywords.map(async keyword => {
    const keys = await meme.getByField('keyWords', keyword)
    /* 取第一个匹配的 key，避免多个表情共用关键词时拼成 "keyA,keyB" 这种查不到的选项值 */
    const value = (Array.isArray(keys) ? keys.filter(Boolean)[0] : keys) || keyword
    return {
      label: keyword,
      value: String(value)
    }
  })

  const keywordPromises2 = keywords.map(keyword => ({
    label: keyword,
    value: keyword
  }))

  const result1 = await Promise.all(keywordPromises1)
  const result2 = keywordPromises2

  return [ ...result1, ...result2 ]
}
