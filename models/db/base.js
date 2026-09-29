import fs from 'node:fs'

import chalk from 'chalk'
import { col, DataTypes, fn, literal, Op, Sequelize } from 'sequelize'

import { Version } from '#components'

/* 这里不能引 ../Utils（utils → 本文件 → utils 循环依赖会让 sequelize 处于 TDZ） */
const dbPath = `${Version.Plugin_Path}/data`
if (!fs.existsSync(dbPath)) {
  fs.mkdirSync(dbPath, { recursive: true })
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: `${dbPath}/data.db`,
  logging: false
})
/** 测试连接 */
try {
  await sequelize.authenticate()
  logger.debug(chalk.bold.cyan(`[${Version.Plugin_AliasName}] 数据库连接成功`))
} catch (error) {
  logger.error(chalk.bold.cyan(`[${Version.Plugin_AliasName}] 数据库连接失败: ${error}`))
}

/**
 * 通过指定字段查询数据（支持 JSON 数组、字符串、数值）
 * 字段名走白名单，值交给 Sequelize 绑定参数，避免任意字段名/值拼进 SQL
 * @param {import('sequelize').ModelStatic<any>} table - 目标模型
 * @param {string} field - 需要查询的字段
 * @param {string | number | string[] | number[]} value - 需要匹配的值（支持多个）
 * @param {string | string[]} returnField - 返回字段（默认 key）
 * @returns 返回符合条件的记录
 */
export async function queryByField (table, field, value, returnField = 'key') {
  const attributes = table.getAttributes()
  const jsonFields = new Set(
    Object.entries(attributes)
      .filter(([ , attr ]) => attr.type instanceof DataTypes.JSON)
      .map(([ name ]) => name)
  )

  if (!field || !attributes[field]) {
    throw new Error(`查询字段不存在: ${field}`)
  }

  const returnFields = Array.isArray(returnField) ? returnField : [ returnField ]
  for (const name of returnFields) {
    if (!attributes[name]) throw new Error(`返回字段不存在: ${name}`)
  }

  const values = Array.isArray(value) ? value : [ value ]

  /* JSON 列里存的是 JSON 文本（如 ["晚安"]）；Sequelize 绑定值时会吃掉双引号导致等值比较
     永远不命中，所以统一按"JSON 数组包含该值"匹配，精确命中优先返回 */
  const isJson = jsonFields.has(field)
  const jsonContains = (name) => literal(
    'EXISTS (SELECT 1 FROM json_each(`' + field + '`) WHERE json_each.value = ' + sequelize.escape(String(name)) + ')'
  )

  const where = isJson
    ? {
      [Op.and]: [
        { [Op.or]: values.map((v) => sequelize.where(jsonContains(v), { [Op.eq]: 1 })) }
      ]
    }
    : { [Op.and]: values.map((v) => ({ [field]: v })) }

  const res = await table.findAll({
    attributes: returnFields,
    where,
    order: isJson
      ? [ [ sequelize.literal('CASE WHEN `' + field + '` = ' + sequelize.escape(JSON.stringify(String(values[0]))) + ' THEN 0 ELSE 1 END'), 'ASC' ] ]
      : undefined
  })

  return Array.isArray(returnField)
    ? res.map(item => item.toJSON())
    : res.map(item => item[returnField])
}

export {
  col,
  DataTypes,
  fn,
  literal,
  Op,
  sequelize
}