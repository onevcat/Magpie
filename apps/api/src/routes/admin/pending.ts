import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { db } from '../../db/index.js'
import { links } from '../../db/schema.js'
import { eq, desc, asc, count, and } from 'drizzle-orm'
import { sendSuccess, sendError } from '../../utils/response.js'
import { adminPendingQuerySchema } from '../../utils/validation.js'
import { requireAdmin } from '../../middleware/admin.js'
import type { PendingLink, Pagination } from '@magpie/shared'
import { adminLogger } from '../../utils/logger.js'

// Create admin pending links router with optional database dependency injection
function createAdminPendingRouter(database = db) {
  const app = new Hono()

  // Error handling middleware
  app.onError((err, c) => {
    adminLogger.error('Admin Pending Links API error', {
      error: err instanceof Error ? err.message : err,
      stack: err instanceof Error ? err.stack : undefined
    })
    
    if (err instanceof Error && (err.message.includes('ZodError') || err.name === 'ZodError')) {
      return sendError(c, 'VALIDATION_ERROR', 'Invalid request parameters', undefined, 400)
    }
    
    return sendError(c, 'INTERNAL_SERVER_ERROR', 'An internal server error occurred', undefined, 500)
  })

  // GET /api/admin/pending - Get pending links list
  app.get('/', requireAdmin(database), zValidator('query', adminPendingQuerySchema), async (c) => {
    try {
      const { page, limit, sort, domain, category } = c.req.valid('query')
      
      const offset = (page - 1) * limit
      
      // Build query conditions
      const whereConditions: any[] = [eq(links.status, 'pending')]
      
      if (domain) {
        whereConditions.push(eq(links.domain, domain))
      }
      
      if (category) {
        // Check both AI category and user category
        whereConditions.push(
          eq(links.aiCategory, category)
          // Note: userCategory could also be checked here if needed
        )
      }
      
      const whereClause = and(...whereConditions)
      
      // Build sorting
      let orderBy: any
      switch (sort) {
        case 'oldest':
          orderBy = asc(links.createdAt)
          break
        default: // newest
          orderBy = desc(links.createdAt)
      }
      
      // Get total count
      const totalResult = await database
        .select({ count: count() })
        .from(links)
        .where(whereClause)
      
      const total = totalResult[0].count
      
      // Get pending links list
      const linksResult = await database
        .select({
          id: links.id,
          url: links.url,
          title: links.title,
          originalDescription: links.originalDescription,
          aiSummary: links.aiSummary,
          aiCategory: links.aiCategory,
          aiTags: links.aiTags,
          aiReadingTime: links.aiReadingTime,
          aiAnalysisFailed: links.aiAnalysisFailed,
          aiError: links.aiError,
          domain: links.domain,
          createdAt: links.createdAt,
          userDescription: links.userDescription,
          userCategory: links.userCategory,
          userTags: links.userTags,
        })
        .from(links)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset)
      
      // Format response data
      const formattedLinks: PendingLink[] = linksResult.map(link => ({
        id: link.id,
        url: link.url,
        title: link.title || '',
        originalDescription: link.originalDescription || '',
        aiSummary: link.aiSummary || '',
        aiCategory: link.aiCategory || '',
        aiTags: link.aiTags ? JSON.parse(link.aiTags) : [],
        aiReadingTime: link.aiReadingTime || undefined,
        aiAnalysisFailed: link.aiAnalysisFailed === 1,
        aiError: link.aiError || undefined,
        domain: link.domain,
        createdAt: link.createdAt,
        userDescription: link.userDescription || undefined,
        userCategory: link.userCategory || undefined,
        userTags: link.userTags ? JSON.parse(link.userTags) : undefined,
        status: 'pending' as const,
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
      
      const responseData = {
        links: formattedLinks,
        pagination,
      }
      
      return sendSuccess(c, responseData)
      
    } catch (error) {
      adminLogger.error('Error fetching pending links', {
        requestUrl: c.req.url,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      })
      return sendError(c, 'INTERNAL_SERVER_ERROR', 'Failed to fetch pending links', undefined, 500)
    }
  })

  return app
}

// Export both the router factory and a default instance
export { createAdminPendingRouter }
export default createAdminPendingRouter()
