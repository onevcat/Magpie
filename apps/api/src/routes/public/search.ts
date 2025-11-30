import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { db } from '../../db/index.js'
import { links } from '../../db/schema.js'
import { eq, desc, asc, and, count, sql } from 'drizzle-orm'
import { sendSuccess, sendError } from '../../utils/response.js'
import { searchQuerySchema, suggestionsQuerySchema, buildSearchDateFilter } from '../../utils/validation.js'
import { apiLogger } from '../../utils/logger.js'
import type { SearchResponse, SearchResult, Suggestion } from '@magpie/shared'

const app = new Hono()

// 添加验证错误处理中间件
app.onError((err, c) => {
  apiLogger.error('Search API error', {
    error: err instanceof Error ? err.message : err,
    stack: err instanceof Error ? err.stack : undefined
  })
  
  // zod验证错误
  if (err instanceof Error && (err.message.includes('ZodError') || err.name === 'ZodError')) {
    return sendError(c, 'VALIDATION_ERROR', 'Invalid request parameters', undefined, 400)
  }
  
  return sendError(c, 'INTERNAL_SERVER_ERROR', 'An internal server error occurred', undefined, 500)
})

// GET /api/search - 使用 FTS5 搜索链接
app.get('/', zValidator('query', searchQuerySchema), async (c) => {
  try {
    const startTime = Date.now()
    const { q, page, limit, category, tags, domain, before, after, sort, highlight } = c.req.valid('query')
    
    const offset = (page - 1) * limit
    
    // 构建 FTS5 查询
    const ftsQuery = buildFTS5Query(q, tags)
    
    // 构建额外的筛选条件
    const joinConditions: any[] = []
    
    if (category) {
      joinConditions.push(eq(links.userCategory, category))
    }
    
    if (domain) {
      joinConditions.push(eq(links.domain, domain))
    }
    
    // 日期筛选
    const dateFilter = buildSearchDateFilter(before, after)
    if (dateFilter) {
      if (dateFilter.start) {
        joinConditions.push(sql`${links.publishedAt} >= ${dateFilter.start}`)
      }
      if (dateFilter.end) {
        joinConditions.push(sql`${links.publishedAt} <= ${dateFilter.end}`)
      }
    }
    
    // 状态筛选 - 只搜索已发布的内容
    joinConditions.push(eq(links.status, 'published'))
    
    const joinWhereClause = joinConditions.length > 0 ? and(...joinConditions) : undefined
    
    // 构建基础查询
    let baseQuery = db
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
        rank: sql`links_fts.rank`.as('rank')
      })
      .from(sql`links_fts`)
      .innerJoin(links, sql`links.id = links_fts.rowid`)
      .where(sql`links_fts MATCH ${ftsQuery}`)
    
    // 添加额外的筛选条件
    if (joinWhereClause) {
      // Instead of calling where twice, rebuild the query with combined conditions
      const combinedWhereClause = and(sql`links_fts MATCH ${ftsQuery}`, joinWhereClause)
      baseQuery = db
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
          rank: sql`links_fts.rank`.as('rank')
        })
        .from(sql`links_fts`)
        .innerJoin(links, sql`links.id = links_fts.rowid`)
        .where(combinedWhereClause)
    }
    
    // 获取总数 - 使用相同的查询条件
    let countQuery = db
      .select({ count: count() })
      .from(sql`links_fts`)
      .innerJoin(links, sql`links.id = links_fts.rowid`)
      .where(sql`links_fts MATCH ${ftsQuery}`)
    
    if (joinWhereClause) {
      // Instead of calling where twice, rebuild the query with combined conditions
      const combinedWhereClause = and(sql`links_fts MATCH ${ftsQuery}`, joinWhereClause)
      countQuery = db
        .select({ count: count() })
        .from(sql`links_fts`)
        .innerJoin(links, sql`links.id = links_fts.rowid`)
        .where(combinedWhereClause)
    }
    
    const totalResult = await countQuery
    const total = totalResult[0].count
    
    // 构建排序
    let orderBy: any
    switch (sort) {
      case 'oldest':
        orderBy = asc(links.publishedAt)
        break
      case 'newest':
        orderBy = desc(links.publishedAt)
        break
      default: // relevance - 使用 FTS5 的内置排序
        orderBy = sql`links_fts.rank`
    }
    
    // 获取搜索结果
    const searchResult = await baseQuery
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset)
    
    // 格式化响应数据，添加搜索相关性和高亮
    const results: SearchResult[] = searchResult.map((link) => {
      const result: SearchResult = {
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
        score: Math.abs(Number(link.rank) || 0), // FTS5 rank score (absolute value, lower is better)
        highlights: {}
      }
      
      // 高亮处理和摘录生成
      if (highlight) {
        const searchRegex = new RegExp(`(${escapeRegex(q)})`, 'gi')
        
        if (result.title.toLowerCase().includes(q.toLowerCase())) {
          result.highlights.title = result.title.replace(searchRegex, '<mark>$1</mark>')
        }
        
        // 生成高亮的描述摘录
        if (result.description.toLowerCase().includes(q.toLowerCase())) {
          const snippet = generateSnippet(result.description, q, 200)
          result.highlights.description = snippet.replace(searchRegex, '<mark>$1</mark>')
        }
        
        // 标签高亮
        if (result.tags.some(tag => tag.toLowerCase().includes(q.toLowerCase()))) {
          result.highlights.tags = result.tags.map(tag => {
            if (tag.toLowerCase().includes(q.toLowerCase())) {
              return tag.replace(searchRegex, '<mark>$1</mark>')
            }
            return tag
          })
        }
      }
      
      return result
    })

    // FTS5 已经提供了最佳的相关性排序，无需额外处理
    
    const pages = Math.ceil(total / limit)
    const totalTime = Date.now() - startTime

    // 如果搜索结果较少，生成搜索建议
    const suggestions = total < 5 && page === 1
      ? await generateSearchSuggestions(q, category, domain)
      : undefined
    
    const responseData: SearchResponse = {
      results,
      pagination: {
        page,
        limit,
        total,
        pages,
        hasNext: page < pages,
        hasPrev: page > 1,
      },
      query: {
        originalQuery: q,
        processedQuery: q.trim().toLowerCase(), // 简化的查询处理
        filters: {
          category,
          tags: tags ? tags.split(',').map(t => t.trim()) : undefined,
          domain,
          before,
          after,
        }
      },
      suggestions,
      totalTime
    }
    
    return sendSuccess(c, responseData)
    
  } catch (error) {
    apiLogger.error('Error searching links', {
      query: c.req.query('q'),
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    })
    return sendError(c, 'INTERNAL_SERVER_ERROR', 'Failed to search links', undefined, 500)
  }
})

// GET /api/search/suggestions - 获取搜索建议
app.get('/suggestions', zValidator('query', suggestionsQuerySchema), async (c) => {
  try {
    const { q, type, limit } = c.req.valid('query')
    
    const suggestions: Suggestion[] = []
    const searchTerm = q.toLowerCase()
    
    if (!type || type === 'title') {
      // 使用 FTS5 从标题中查找建议
      const titleSuggestions = await db
        .select({ title: links.title })
        .from(sql`links_fts`)
        .innerJoin(links, sql`links.id = links_fts.rowid`)
        .where(
          and(
            sql`links_fts MATCH ${q}`,
            eq(links.status, 'published')
          )
        )
        .limit(Math.ceil(limit / 3)) // 为每种类型分配部分配额
      
      titleSuggestions.forEach(item => {
        if (item.title && !suggestions.find(s => s.text === item.title)) {
          suggestions.push({
            text: item.title,
            type: 'title',
            count: 1
          })
        }
      })
    }
    
    if (!type || type === 'category') {
      // 使用 FTS5 从分类中查找建议
      const categorySuggestions = await db
        .select({ 
          category: links.userCategory,
          count: count()
        })
        .from(sql`links_fts`)
        .innerJoin(links, sql`links.id = links_fts.rowid`)
        .where(
          and(
            sql`links_fts MATCH ${q}`,
            eq(links.status, 'published')
          )
        )
        .groupBy(links.userCategory)
        .limit(Math.ceil(limit / 3))
      
      categorySuggestions.forEach(item => {
        if (item.category && !suggestions.find(s => s.text === item.category)) {
          suggestions.push({
            text: item.category,
            type: 'category',
            count: item.count
          })
        }
      })
    }
    
    if (!type || type === 'tag') {
      // 从标签中查找建议
      const tagData = await db
        .select({ 
          tags: links.userTags 
        })
        .from(links)
        .where(eq(links.status, 'published'))

      const tagCounts: { [key: string]: number } = {}
      tagData.forEach(item => {
        if (item.tags) {
          try {
            const tags = JSON.parse(item.tags) as string[]
            tags.forEach((tag: string) => {
              if (tag.toLowerCase().includes(searchTerm)) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1
              }
            })
          } catch (error) {
            // 忽略无效的JSON
          }
        }
      })

      Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, Math.ceil(limit / 4))
        .forEach(([tag, count]) => {
          if (!suggestions.find(s => s.text === tag)) {
            suggestions.push({
              text: tag,
              type: 'tag',
              count
            })
          }
        })
    }

    if (!type || type === 'domain') {
      // 使用 FTS5 从域名中查找建议
      const domainSuggestions = await db
        .select({
          domain: links.domain,
          count: count()
        })
        .from(sql`links_fts`)
        .innerJoin(links, sql`links.id = links_fts.rowid`)
        .where(
          and(
            sql`links_fts MATCH ${q}`,
            eq(links.status, 'published')
          )
        )
        .groupBy(links.domain)
        .limit(Math.ceil(limit / 4))
      
      domainSuggestions.forEach(item => {
        if (!suggestions.find(s => s.text === item.domain)) {
          suggestions.push({
            text: item.domain,
            type: 'domain',
            count: item.count
          })
        }
      })
    }
    
    // 按相关性和计数排序，限制数量
    const sortedSuggestions = suggestions
      .sort((a, b) => {
        // 优先显示完全匹配的建议
        const aStartsWith = a.text.toLowerCase().startsWith(searchTerm)
        const bStartsWith = b.text.toLowerCase().startsWith(searchTerm)
        
        if (aStartsWith && !bStartsWith) return -1
        if (!aStartsWith && bStartsWith) return 1
        
        // 然后按使用次数排序
        return (b.count || 0) - (a.count || 0)
      })
      .slice(0, limit)
    
    return sendSuccess(c, {
      suggestions: sortedSuggestions
    })
    
  } catch (error) {
    apiLogger.error('Error getting search suggestions', {
      query: c.req.query('q'),
      type: c.req.query('type'),
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    })
    return sendError(c, 'INTERNAL_SERVER_ERROR', 'Failed to get suggestions', undefined, 500)
  }
})

// 工具函数：构建 FTS5 查询
function buildFTS5Query(query: string, tags?: string): string {
  // 转义 FTS5 特殊字符
  const escapedQuery = query.replace(/['"]/g, '""')
  
  // 构建基础查询
  let ftsQuery = `"${escapedQuery}"`
  
  // 如果有标签筛选，添加到 FTS5 查询中
  if (tags) {
    const tagList = tags.split(',').map(t => t.trim())
    const tagQueries = tagList.map(tag => `"${tag.replace(/['"]/g, '""')}"`).join(' OR ')
    ftsQuery = `(${ftsQuery}) AND (${tagQueries})`
  }
  
  return ftsQuery
}

// 工具函数：转义正则表达式特殊字符
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 工具函数：生成摘录
function generateSnippet(text: string, query: string, maxLength: number = 200): string {
  if (!text || text.length <= maxLength) {
    return text
  }
  
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()
  const queryIndex = textLower.indexOf(queryLower)
  
  if (queryIndex === -1) {
    // 如果没有找到查询词，返回开头部分
    return text.substring(0, maxLength) + '...'
  }
  
  // 计算摘录的开始位置，尽量让查询词居中
  const contextLength = Math.floor((maxLength - query.length) / 2)
  let start = Math.max(0, queryIndex - contextLength)
  
  // 尽量在单词边界开始
  if (start > 0) {
    const spaceIndex = text.indexOf(' ', start)
    if (spaceIndex !== -1 && spaceIndex < start + 20) {
      start = spaceIndex + 1
    }
  }
  
  let snippet = text.substring(start, start + maxLength)
  
  // 尽量在单词边界结束
  if (start + maxLength < text.length) {
    const lastSpaceIndex = snippet.lastIndexOf(' ')
    if (lastSpaceIndex > maxLength * 0.8) {
      snippet = snippet.substring(0, lastSpaceIndex)
    }
    snippet += '...'
  }
  
  // 如果不是从开头开始，添加省略号
  if (start > 0) {
    snippet = '...' + snippet
  }
  
  return snippet
}

// 工具函数：生成搜索建议
async function generateSearchSuggestions(
  query: string, 
  category?: string, 
  domain?: string
): Promise<string[]> {
  const suggestions: string[] = []
  const q = query.toLowerCase()
  
  try {
    // 使用 FTS5 查找相似的标题
    const baseConditions = [eq(links.status, 'published')]
    if (category) baseConditions.push(eq(links.userCategory, category))
    if (domain) baseConditions.push(eq(links.domain, domain))
    
    const titleSuggestions = await db
      .select({ title: links.title })
      .from(sql`links_fts`)
      .innerJoin(links, sql`links.id = links_fts.rowid`)
      .where(
        and(
          sql`links_fts MATCH ${buildFTS5Query(q)}`,
          ...baseConditions
        )
      )
      .limit(20)

    // 基于编辑距离的简单相似度匹配
    titleSuggestions.forEach(item => {
      if (item.title) {
        const words = item.title.toLowerCase().split(/\s+/)
        words.forEach(word => {
          if (word.length >= 3 && 
              word !== q && 
              !suggestions.includes(word) &&
              (word.includes(q) || q.includes(word) || 
               calculateEditDistance(word, q) <= 2)) {
            suggestions.push(word)
          }
        })
      }
    })

    // 查找常用分类
    if (!category) {
      const categoryData = await db
        .select({ 
          category: links.userCategory,
          count: count()
        })
        .from(links)
        .where(eq(links.status, 'published'))
        .groupBy(links.userCategory)
        .orderBy(sql`count(*) desc`)
        .limit(5)

      categoryData.forEach(item => {
        if (item.category && 
            item.category.toLowerCase().includes(q) &&
            !suggestions.includes(item.category)) {
          suggestions.push(item.category)
        }
      })
    }

    // 使用 FTS5 查找常用标签
    const tagData = await db
      .select({ tags: links.userTags })
      .from(sql`links_fts`)
      .innerJoin(links, sql`links.id = links_fts.rowid`)
      .where(
        and(
          sql`links_fts MATCH ${buildFTS5Query(q)}`,
          ...baseConditions
        )
      )
      .limit(50)

    const tagCounts: { [key: string]: number } = {}
    tagData.forEach(item => {
      if (item.tags) {
        try {
          const tags = JSON.parse(item.tags) as string[]
          tags.forEach(tag => {
            if (tag.toLowerCase().includes(q) || 
                q.includes(tag.toLowerCase()) ||
                calculateEditDistance(tag.toLowerCase(), q) <= 2) {
              tagCounts[tag] = (tagCounts[tag] || 0) + 1
            }
          })
        } catch (error) {
          // 忽略无效的JSON
        }
      }
    })

    Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .forEach(([tag]) => {
        if (!suggestions.includes(tag)) {
          suggestions.push(tag)
        }
      })

  } catch (error) {
    apiLogger.error('Error generating search suggestions', {
      query: q,
      category,
      domain,
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    })
  }
  
  return suggestions.slice(0, 5) // 最多返回5个建议
}

// 工具函数：计算编辑距离（简化版）
function calculateEditDistance(str1: string, str2: string): number {
  if (str1.length === 0) return str2.length
  if (str2.length === 0) return str1.length
  
  const matrix = Array(str2.length + 1).fill(null).map(() => 
    Array(str1.length + 1).fill(null)
  )
  
  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i
  }
  
  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j
  }
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[j][i] = matrix[j - 1][i - 1]
      } else {
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1, // deletion
          matrix[j][i - 1] + 1, // insertion
          matrix[j - 1][i - 1] + 1 // substitution
        )
      }
    }
  }
  
  return matrix[str2.length][str1.length]
}

export default app
