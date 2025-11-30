import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { db } from '../../db/index.js'
import { links } from '../../db/schema.js'
import { eq, desc, asc, like, and, or, count, sql } from 'drizzle-orm'
import { sendSuccess, sendError, notFound } from '../../utils/response.js'
import { linksQuerySchema, idParamSchema, buildDateFilter } from '../../utils/validation.js'
import { getSettings } from '../../utils/settings.js'
import { apiLogger } from '../../utils/logger.js'
import type { LinksResponse, Link, Pagination } from '@magpie/shared'

// Create public links router with optional database dependency injection
function createLinksRouter(database = db) {
  const app = new Hono()

// 添加验证错误处理中间件
app.onError((err, c) => {
  apiLogger.error('Links API error', {
    error: err instanceof Error ? err.message : err,
    stack: err instanceof Error ? err.stack : undefined
  })
  
  // zod验证错误
  if (err instanceof Error && (err.message.includes('ZodError') || err.name === 'ZodError')) {
    return sendError(c, 'VALIDATION_ERROR', 'Invalid request parameters', undefined, 400)
  }
  
  return sendError(c, 'INTERNAL_SERVER_ERROR', 'An internal server error occurred', undefined, 500)
})

// GET /api/links - 获取链接列表
app.get('/', zValidator('query', linksQuerySchema), async (c) => {
  try {
    const queryParams = c.req.valid('query')
    const {
      page,
      limit: initialLimit,
      category,
      tags,
      search,
      domain,
      year,
      month,
      sort,
      id,
    } = queryParams
    let limit = initialLimit
    
    // 如果没有提供limit参数，从系统设置中获取默认值
    if (!c.req.query('limit')) {
      try {
        const settings = await getSettings(database)
        const itemsPerPage = parseInt(settings.items_per_page || '20')
        limit = Math.min(Math.max(itemsPerPage, 1), 100) // 确保在1-100范围内
      } catch (error) {
        apiLogger.warn('Failed to derive items_per_page from settings, using default', {
          error: error instanceof Error ? error.message : error,
          fallbackLimit: 20
        })
        limit = 20 // 如果获取设置失败，使用默认值
      }
    }
    
    const offset = (page - 1) * limit
    
    // 构建查询条件
    const whereConditions: any[] = [eq(links.status, 'published')]
    
    if (id) {
      whereConditions.push(eq(links.id, id))
    }
    
    if (category) {
      whereConditions.push(eq(links.userCategory, category))
    }
    
    if (domain) {
      whereConditions.push(eq(links.domain, domain))
    }
    
    if (search) {
      whereConditions.push(
        or(
          like(links.title, `%${search}%`),
          like(links.userDescription, `%${search}%`),
          like(links.userTags, `%${search}%`)
        )
      )
    }
    
    if (tags) {
      const tagList = tags.split(',').map(t => t.trim())
      const tagConditions = tagList.map(tag => 
        like(links.userTags, `%${tag}%`)
      )
      whereConditions.push(or(...tagConditions))
    }
    
    // 日期筛选
    const dateFilter = buildDateFilter(year, month)
    if (dateFilter) {
      whereConditions.push(
        and(
          sql`${links.publishedAt} >= ${dateFilter.start}`,
          sql`${links.publishedAt} <= ${dateFilter.end}`
        )
      )
    }
    
    const whereClause = and(...whereConditions)
    
    // 构建排序
    let orderBy: any
    switch (sort) {
      case 'oldest':
        orderBy = asc(links.publishedAt)
        break
      case 'title':
        orderBy = asc(links.title)
        break
      case 'domain':
        orderBy = asc(links.domain)
        break
      default: // newest
        orderBy = desc(links.publishedAt)
    }
    
    // 获取总数
    const totalResult = await database
      .select({ count: count() })
      .from(links)
      .where(whereClause)
    
    const total = totalResult[0].count
    
    // 获取链接列表 (直接使用user字段)
    const linksResult = await database
      .select({
        id: links.id,
        url: links.url,
        title: links.title,
        description: links.userDescription,
        category: links.userCategory,
        tags: links.userTags,
        domain: links.domain,
        readingTime: links.aiReadingTime,
        publishedAt: links.publishedAt,
        createdAt: links.createdAt,
      })
      .from(links)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset)
    
    // 格式化响应数据
    const formattedLinks: Link[] = linksResult.map(link => ({
      id: link.id,
      url: link.url,
      title: link.title || '',
      description: link.description || '',
      category: link.category || '',
      tags: link.tags ? JSON.parse(link.tags) : [],
      domain: link.domain,
      readingTime: link.readingTime || undefined,
      publishedAt: link.publishedAt || 0,
      createdAt: link.createdAt,
    }))
    
    const pages = Math.ceil(total / limit)
    
    const pagination: Pagination = {
      page,
      limit,
      total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1,
    }
    
    // 获取filters统计数据（移除域名统计，按需加载）
    const [categoryStats, tagData, yearMonthData] = await Promise.all([
      // 分类统计 (直接使用user字段)
      database
        .select({
          name: links.userCategory,
          count: sql<number>`count(*)`
        })
        .from(links)
        .where(eq(links.status, 'published'))
        .groupBy(links.userCategory)
        .having(sql`${links.userCategory} IS NOT NULL AND ${links.userCategory} != ''`)
        .orderBy(sql`count(*) desc`),

      // 标签数据（直接使用user字段）
      database
        .select({ 
          tags: links.userTags 
        })
        .from(links)
        .where(eq(links.status, 'published')),

      // 年月数据
      database
        .select({ 
          publishedAt: links.publishedAt,
          count: sql<number>`count(*)`
        })
        .from(links)
        .where(eq(links.status, 'published'))
        .groupBy(sql`strftime('%Y-%m', datetime(${links.publishedAt}, 'unixepoch'))`)
        .orderBy(desc(links.publishedAt))
    ])

    // 处理标签统计
    const tagCounts: { [key: string]: number } = {}
    tagData.forEach(item => {
      if (item.tags) {
        try {
          const tags = JSON.parse(item.tags) as string[]
          tags.forEach((tag: string) => {
            if (tag.trim()) {
              tagCounts[tag] = (tagCounts[tag] || 0) + 1
            }
          })
        } catch (error) {
          // 忽略无效的JSON
        }
      }
    })

    const tagStats = Object.entries(tagCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    // 处理年月统计
    const yearMonthStats = yearMonthData.map(item => {
      const date = item.publishedAt ? new Date(item.publishedAt * 1000) : new Date()
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        count: item.count
      }
    })

    const filters = {
      categories: categoryStats.map(cat => ({
        name: cat.name || 'Uncategorized',
        count: cat.count
      })),
      tags: tagStats,
      domains: undefined, // TODO: Add domain stats implementation
      yearMonths: yearMonthStats,
    }
    
    const responseData: LinksResponse = {
      links: formattedLinks,
      pagination,
      filters,
    }
    
    return sendSuccess(c, responseData)
    
  } catch (error) {
    apiLogger.error('Error fetching links', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    })
    return sendError(c, 'INTERNAL_SERVER_ERROR', 'Failed to fetch links', undefined, 500)
  }
})

// GET /api/links/:id - 获取单个链接详情
app.get('/:id', zValidator('param', idParamSchema), async (c) => {
  let requestedId: number | undefined

  try {
    const params = c.req.valid('param')
    requestedId = params.id
    const { id } = params
    
    const linkResult = await database
      .select({
        id: links.id,
        url: links.url,
        title: links.title,
        description: links.userDescription,
        category: links.userCategory,
        tags: links.userTags,
        domain: links.domain,
        readingTime: links.aiReadingTime,
        publishedAt: links.publishedAt,
        createdAt: links.createdAt,
      })
      .from(links)
      .where(and(eq(links.id, id), eq(links.status, 'published')))
      .limit(1)
    
    if (linkResult.length === 0) {
      return notFound(c, 'Link not found')
    }
    
    const link = linkResult[0]
    
    const formattedLink: Link = {
      id: link.id,
      url: link.url,
      title: link.title || '',
      description: link.description || '',
      category: link.category || '',
      tags: link.tags ? JSON.parse(link.tags) : [],
      domain: link.domain,
      readingTime: link.readingTime || undefined,
      publishedAt: link.publishedAt || 0,
      createdAt: link.createdAt,
    }
    
    return sendSuccess(c, formattedLink)
    
  } catch (error) {
    apiLogger.error('Error fetching link', {
      linkId: requestedId ?? Number.parseInt(c.req.param('id'), 10),
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    })
    return sendError(c, 'INTERNAL_SERVER_ERROR', 'Failed to fetch link', undefined, 500)
  }
})

  return app
}

// Export both the router factory and a default instance
export { createLinksRouter }
export default createLinksRouter()
