import fs from 'node:fs'

import YAML from 'yaml'

export class YamlReader {
  constructor (yamlPath) {
    this.yamlPath = yamlPath
    this.isSave = false
    this.initYaml()
  }

  /** 初始化 YAML 解析 */
  initYaml () {
    if (!fs.existsSync(this.yamlPath)) fs.writeFileSync(this.yamlPath, '', 'utf8')
    this.document = YAML.parseDocument(fs.readFileSync(this.yamlPath, 'utf8')) || new YAML.Document()

    /* 配置写错时给出提示，避免静默套用错误值 */
    const errors = this.document.errors || []
    if (errors.length) {
      logger.error(`[清语表情] 配置文件解析失败: ${this.yamlPath}`)
      errors.forEach((err) => logger.error(`  ${err.message}`))
    }
  }

  /** 获取 YAML 转换后的 JSON 数据 */
  get jsonData () {
    return this.document?.toJSON() || {}
  }

  /** 设置 key 的值 */
  set (keyPath, value) {
    this.document.setIn(keyPath.split('.'), value)
    this.save()
  }

  /** 保存 YAML 文件 */
  save () {
    this.isSave = true
    fs.writeFileSync(this.yamlPath, this.document.toString(), 'utf8')
  }
}
