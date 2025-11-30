import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { db } from '../../db/index.js'
import { apiTokens } from '../../db/schema.js'
import { eq, desc, and } from 'drizzle-orm'
import { sendSuccess, sendError, notFound } from '../../utils/response.js'
import { tokensQuerySchema, createTokenSchema, idParamSchema } from '../../utils/validation.js'
import { requireAdmin } from '../../middleware/admin.js'
import crypto from 'crypto'
import { adminLogger } from '../../utils/logger.js'

// Create admin tokens router with optional database dependency injection
function createAdminTokensRouter(database = db) {
  const app = new Hono()

  // Error handling middleware
  app.onError((err, c) => {
    adminLogger.error('Admin Tokens API error', {
      error: err instanceof Error ? err.message : err,
      stack: err instanceof Error ? err.stack : undefined
    })
    
    if (err instanceof Error && (err.message.includes('ZodError') || err.name === 'ZodError')) {
      return sendError(c, 'VALIDATION_ERROR', 'Invalid request parameters', undefined, 400)
    }
    
    return sendError(c, 'INTERNAL_SERVER_ERROR', 'An internal server error occurred', undefined, 500)
  })

  // Helper function to mask token for display
  function maskToken(token: string): string {
    if (!token || token.length < 10) return token
    const prefix = token.substring(0, 4) // Keep 'mgp_' prefix
    const suffix = token.substring(Math.max(0, token.length - 4))
    return prefix + '***' + suffix
  }

  // GET /api/admin/tokens - Get token list
  app.get('/', requireAdmin(database), zValidator('query', tokensQuerySchema), async (c) => {
    try {
      const { page, limit, status } = c.req.valid('query')
      const offset = (page - 1) * limit

      // Build where conditions
      const whereConditions: any[] = []
      if (status) {
        whereConditions.push(eq(apiTokens.status, status))
      }

      const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined

      // Get tokens with pagination
      const [tokens, countResult] = await Promise.all([
        database
          .select({
            id: apiTokens.id,
            token: apiTokens.token,
            name: apiTokens.name,
            prefix: apiTokens.prefix,
            status: apiTokens.status,
            usageCount: apiTokens.usageCount,
            lastUsedAt: apiTokens.lastUsedAt,
            lastUsedIp: apiTokens.lastUsedIp,
            createdAt: apiTokens.createdAt,
            revokedAt: apiTokens.revokedAt,
          })
          .from(apiTokens)
          .where(whereClause)
          .orderBy(desc(apiTokens.createdAt))
          .limit(limit)
          .offset(offset),
        database
          .select({ count: apiTokens.id })
          .from(apiTokens)
          .where(whereClause)
      ])

      const total = countResult.length
      const pages = Math.ceil(total / limit)

      // Mask tokens for security
      const maskedTokens = tokens.map(token => ({
        ...token,
        token: maskToken(token.token),
      }))

      const pagination = {
        page,
        limit,
        total,
        pages,
        hasNext: page < pages,
        hasPrev: page > 1,
      }

      return sendSuccess(c, { tokens: maskedTokens, pagination }, 'Tokens retrieved successfully')
    } catch (error) {
      adminLogger.error('Failed to get tokens', {
        requestUrl: c.req.url,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      })
      return sendError(c, 'DATABASE_ERROR', 'Failed to retrieve tokens', undefined, 500)
    }
  })

  // POST /api/admin/tokens - Create new token
  app.post('/', requireAdmin(database), zValidator('json', createTokenSchema), async (c) => {
    try {
      const { name } = c.req.valid('json')
      const now = Math.floor(Date.now() / 1000)

      // Generate secure random token
      const tokenValue = 'mgp_' + crypto.randomBytes(32).toString('hex')

      // Insert new token
      const result = await database.insert(apiTokens).values({
        token: tokenValue,
        name: name || null,
        prefix: 'mgp_',
        status: 'active',
        usageCount: 0,
        createdAt: now,
      }).returning({
        id: apiTokens.id,
        token: apiTokens.token,
        name: apiTokens.name,
        prefix: apiTokens.prefix,
        status: apiTokens.status,
        createdAt: apiTokens.createdAt,
      })

      const newToken = result[0]

      return sendSuccess(c, newToken, 'Token created successfully', 201)
    } catch (error) {
      adminLogger.error('Failed to create token', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      })
      return sendError(c, 'DATABASE_ERROR', 'Failed to create token', undefined, 500)
    }
  })

  // DELETE /api/admin/tokens/:id - Revoke token
  app.delete('/:id', requireAdmin(database), zValidator('param', idParamSchema), async (c) => {
    let tokenId: number | undefined

    try {
      const params = c.req.valid('param')
      tokenId = params.id
      const { id } = params
      const now = Math.floor(Date.now() / 1000)

      // Check if token exists
      const existingToken = await database
        .select({
          id: apiTokens.id,
          status: apiTokens.status,
          name: apiTokens.name,
        })
        .from(apiTokens)
        .where(eq(apiTokens.id, id))
        .limit(1)

      if (existingToken.length === 0) {
        return notFound(c, 'Token not found')
      }

      const token = existingToken[0]

      // Check if token is already revoked
      if (token.status === 'revoked') {
        return sendError(c, 'INVALID_OPERATION', 'Token is already revoked', undefined, 400)
      }

      // Revoke the token
      await database
        .update(apiTokens)
        .set({
          status: 'revoked',
          revokedAt: now,
        })
        .where(eq(apiTokens.id, id))

      return sendSuccess(c, { id, status: 'revoked' }, `Token "${token.name || id}" revoked successfully`)
    } catch (error) {
      adminLogger.error('Failed to revoke token', {
        tokenId: tokenId ?? Number.parseInt(c.req.param('id'), 10),
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      })
      return sendError(c, 'DATABASE_ERROR', 'Failed to revoke token', undefined, 500)
    }
  })

  return app
}

// Export both the router factory and a default instance
export { createAdminTokensRouter }
export default createAdminTokensRouter()
