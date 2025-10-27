import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clearTestData } from './helpers.js'
import { testDrizzle } from './setup.js'
import { links, apiTokens, settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { createAddLinkRouter } from '../routes/auth/add-link.js'
import { createAddLinkStreamRouter } from '../routes/auth/add-link-stream.js'
import type { ScrapedContent } from '../services/web-scraper.js'
import type { AIAnalysisResult } from '../services/ai-analyzer.js'

// Mock web scraper
vi.mock('../services/web-scraper.js', () => ({
  webScraper: {
    scrape: vi.fn()
  }
}))

// Mock readability scraper
vi.mock('../services/readability-scraper.js', () => ({
  readabilityScraper: {
    scrape: vi.fn()
  }
}))

// Mock AI analyzer
vi.mock('../services/ai-analyzer.js', () => ({
  createAIAnalyzer: vi.fn(),
  AIAnalyzer: vi.fn()
}))

describe('Add Link Integration Tests', () => {
  let app: any
  let streamApp: any
  let testToken: string
  let mockWebScraper: any
  let mockReadabilityScraper: any
  let mockCreateAIAnalyzer: any

  beforeEach(async () => {
    clearTestData()
    
    // Use real router with test database injection
    app = createAddLinkRouter(testDrizzle)
    streamApp = createAddLinkStreamRouter(testDrizzle)
    
    // Get mock functions
    const { webScraper } = await import('../services/web-scraper.js')
    const { readabilityScraper } = await import('../services/readability-scraper.js')
    const { createAIAnalyzer } = await import('../services/ai-analyzer.js')
    
    mockWebScraper = webScraper as any
    mockReadabilityScraper = readabilityScraper as any
    mockCreateAIAnalyzer = createAIAnalyzer as any
    
    // Reset mocks
    mockWebScraper.scrape.mockReset()
    mockReadabilityScraper.scrape.mockReset()
    mockCreateAIAnalyzer.mockReset()
    
    // Create test API token
    const now = Math.floor(Date.now() / 1000)
    testToken = 'mgp_' + '0'.repeat(64) // Valid format test token
    
    await testDrizzle.insert(apiTokens).values({
      token: testToken,
      name: 'Test Token',
      prefix: 'mgp_',
      status: 'active',
      usageCount: 0,
      createdAt: now,
    })
    
    // Initialize test settings
    await testDrizzle.insert(settings).values([
      {
        key: 'openai_api_key',
        value: 'test-api-key',
        type: 'string',
        description: 'Test OpenAI API key',
        createdAt: now,
        updatedAt: now,
      },
      {
        key: 'openai_base_url',
        value: 'https://api.openai.com/v1',
        type: 'string',
        description: 'OpenAI API base URL',
        createdAt: now,
        updatedAt: now,
      },
      {
        key: 'categories',
        value: JSON.stringify(['tech', 'science', 'business', 'other']),
        type: 'json',
        description: 'Available categories',
        createdAt: now,
        updatedAt: now,
      },
      {
        key: 'default_category',
        value: '其他',
        type: 'string',
        description: 'Default category for test',
        createdAt: now,
        updatedAt: now,
      }
    ])
  })

  describe('POST / with real content processing', () => {
    it('should successfully process URL with web scraping and AI analysis', async () => {
      // Mock scraped content
      const mockScrapedContent: ScrapedContent = {
        url: 'https://example.com/tech-article',
        contentType: 'article',
        title: 'Advanced JavaScript Techniques',
        description: 'Learn advanced JavaScript patterns and techniques',
        content: 'This article covers advanced JavaScript concepts including closures, promises, and async/await patterns.',
        domain: 'example.com',
        wordCount: 150,
        language: 'en',
        author: 'John Doe',
        siteName: 'TechBlog'
      }
      
      // Mock AI analysis result
      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'An in-depth guide to advanced JavaScript programming techniques and patterns.',
        category: 'tech',
        tags: ['javascript', 'programming', 'web-development'],
        language: 'en',
        sentiment: 'neutral',
        readingTime: 5
      }
      
      // Mock AI analyzer instance
      const mockAnalyzer = {
        analyze: vi.fn().mockResolvedValue(mockAIAnalysis)
      }
      
      // Setup mocks
      mockReadabilityScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockCreateAIAnalyzer.mockResolvedValue(mockAnalyzer)

      const response = await app.request('/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: 'https://example.com/tech-article',
          skipConfirm: true
        })
      })
      
      const data = await response.json() as any

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('published')
      expect(data.data.title).toBe('Advanced JavaScript Techniques')
      expect(data.data.category).toBe('tech')
      expect(data.data.tags).toEqual(['javascript', 'programming', 'web-development'])
      
      // Verify readability scraper was called first
      expect(mockReadabilityScraper.scrape).toHaveBeenCalledWith('https://example.com/tech-article')
      
      // Verify AI analyzer was created and used
      expect(mockCreateAIAnalyzer).toHaveBeenCalled()
      expect(mockAnalyzer.analyze).toHaveBeenCalledWith(mockScrapedContent)
      
      // Verify data was saved to database
      const savedLink = await testDrizzle
        .select()
        .from(links)
        .where(eq(links.id, data.data.id))
        .limit(1)
      
      expect(savedLink).toHaveLength(1)
      expect(savedLink[0].title).toBe('Advanced JavaScript Techniques')
      expect(savedLink[0].aiSummary).toBe('An in-depth guide to advanced JavaScript programming techniques and patterns.')
      expect(savedLink[0].aiCategory).toBe('tech')
      expect(JSON.parse(savedLink[0].aiTags || '[]')).toEqual(['javascript', 'programming', 'web-development'])
      expect(savedLink[0].status).toBe('published')
    })

    it('should handle web scraping failure gracefully', async () => {
      // Mock both scrapers failing
      mockReadabilityScraper.scrape.mockRejectedValue(new Error('Readability failed'))
      mockWebScraper.scrape.mockRejectedValue(new Error('Failed to fetch page'))

      const response = await app.request('/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: 'https://invalid-url.com',
          skipConfirm: true
        })
      })
      
      const data = await response.json() as any

      // Should succeed with fallback content
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('published')
      expect(data.data.scrapingFailed).toBe(true)
      
      // Verify link was created with fallback content
      const savedLinks = await testDrizzle.select().from(links)
      expect(savedLinks).toHaveLength(1)
      expect(savedLinks[0].title).toContain('invalid url.com')
      expect(savedLinks[0].aiSummary).toContain('无法自动分析内容')
      expect(savedLinks[0].aiCategory).toBe('其他')
    })

    it('should fallback to basic analysis when AI fails', async () => {
      const mockScrapedContent: ScrapedContent = {
        url: 'https://example.com/article',
        contentType: 'article',
        title: 'Test Article',
        description: 'Test description',
        content: 'Test content',
        domain: 'example.com',
        wordCount: 50,
        language: 'en'
      }
      
      // Mock successful scraping but AI failure
      mockReadabilityScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockCreateAIAnalyzer.mockRejectedValue(new Error('AI service unavailable'))

      const response = await app.request('/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: 'https://example.com/article',
          skipConfirm: true
        })
      })
      
      const data = await response.json() as any

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('published')
      expect(data.data.title).toBe('Test Article')
      expect(data.data.category).toBe('其他') // Fallback category
      expect(data.data.tags).toEqual(['article']) // Fallback tags
      
      // Verify fallback data in database
      const savedLink = await testDrizzle
        .select()
        .from(links)
        .where(eq(links.id, data.data.id))
        .limit(1)
      
      expect(savedLink[0].aiCategory).toBe('其他')
      expect(JSON.parse(savedLink[0].aiTags || '[]')).toEqual(['article'])
    })

    it('should handle missing AI configuration gracefully', async () => {
      // Remove AI API key setting
      await testDrizzle
        .delete(settings)
        .where(eq(settings.key, 'openai_api_key'))
      
      const mockScrapedContent: ScrapedContent = {
        url: 'https://example.com/article',
        contentType: 'article',
        title: 'Test Article',
        description: 'Test description',
        content: 'Test content',
        domain: 'example.com',
        wordCount: 50,
        language: 'en'
      }
      
      mockReadabilityScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)

      const response = await app.request('/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: 'https://example.com/article',
          skipConfirm: true
        })
      })
      
      const data = await response.json() as any

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('published')
      
      // Should use fallback analysis
      expect(data.data.category).toBe('其他')
      expect(data.data.tags).toEqual(['article'])
    })

    it('should preserve original content for manual review when skipConfirm=false', async () => {
      const mockScrapedContent: ScrapedContent = {
        url: 'https://example.com/review-article',
        contentType: 'article',
        title: 'Article for Review',
        description: 'Article that needs review',
        content: 'Content to be reviewed',
        domain: 'example.com',
        wordCount: 80,
        language: 'en'
      }
      
      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'AI generated summary',
        category: 'tech',
        tags: ['review', 'pending'],
        language: 'en',
        sentiment: 'neutral',
        readingTime: 3
      }
      
      const mockAnalyzer = {
        analyze: vi.fn().mockResolvedValue(mockAIAnalysis)
      }
      
      mockReadabilityScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockCreateAIAnalyzer.mockResolvedValue(mockAnalyzer)

      const response = await app.request('/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          url: 'https://example.com/review-article',
          skipConfirm: false
        })
      })
      
      const data = await response.json() as any

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('pending')
      expect(data.data.confirmUrl).toBeDefined()
      
      // Verify pending link in database
      const savedLink = await testDrizzle
        .select()
        .from(links)
        .where(eq(links.id, data.data.id))
        .limit(1)
      
      expect(savedLink[0].status).toBe('pending')
      expect(savedLink[0].aiSummary).toBe('AI generated summary')
      expect(savedLink[0].userDescription).toBeNull() // Not set until confirmed
    })
  })

  describe('POST /stream progress endpoint', () => {
    it('should include confirmUrl in completion event for pending links', async () => {
      const mockScrapedContent: ScrapedContent = {
        url: 'https://example.com/review-article',
        contentType: 'article',
        title: 'Review Workflow Article',
        description: 'A deep dive into review flows',
        content: 'Detailed guide about review pipelines.',
        domain: 'example.com',
        wordCount: 120,
        language: 'en',
        author: 'Jane Reviewer',
        siteName: 'Example'
      }

      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'Explains how review pipelines operate.',
        category: 'process',
        tags: ['workflow', 'review'],
        language: 'en',
        sentiment: 'neutral',
        readingTime: 3
      }

      const mockAnalyzer = {
        analyze: vi.fn().mockResolvedValue(mockAIAnalysis)
      }

      mockReadabilityScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockCreateAIAnalyzer.mockResolvedValue(mockAnalyzer)

      const response = await streamApp.request('/stream', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          url: 'https://example.com/review-article',
          skipConfirm: false
        })
      })

      const rawStream = await response.text()
      const eventLines = rawStream
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.startsWith('data: '))

      expect(eventLines.length).toBeGreaterThan(0)

      const lastEvent = eventLines[eventLines.length - 1]
      const payload = JSON.parse(lastEvent.slice(6))

      expect(payload.stage).toBe('completed')
      expect(payload.data?.status).toBe('pending')
      expect(payload.data?.confirmUrl).toBeDefined()
      expect(payload.data?.confirmUrl).toBe(`/confirm/${payload.data?.id}`)

      const savedLink = await testDrizzle
        .select()
        .from(links)
        .where(eq(links.id, payload.data?.id))
        .limit(1)

      expect(savedLink[0].status).toBe('pending')
    })

    it('should set user fields correctly when skipConfirm=true (immediate publish)', async () => {
      const mockScrapedContent: ScrapedContent = {
        url: 'https://example.com/published-article',
        contentType: 'article',
        title: 'Published Article',
        description: 'This article will be published immediately',
        content: 'Content that will be published without review.',
        domain: 'example.com',
        wordCount: 100,
        language: 'en'
      }

      const mockAIAnalysis: AIAnalysisResult = {
        summary: 'AI-generated summary for immediate publication',
        category: 'tech',
        tags: ['immediate', 'publish', 'test'],
        language: 'en',
        sentiment: 'positive',
        readingTime: 4
      }

      const mockAnalyzer = {
        analyze: vi.fn().mockResolvedValue(mockAIAnalysis)
      }

      mockReadabilityScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockCreateAIAnalyzer.mockResolvedValue(mockAnalyzer)

      const response = await streamApp.request('/stream', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          url: 'https://example.com/published-article',
          skipConfirm: true
        })
      })

      const rawStream = await response.text()
      const eventLines = rawStream
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.startsWith('data: '))

      expect(eventLines.length).toBeGreaterThan(0)

      const lastEvent = eventLines[eventLines.length - 1]
      const payload = JSON.parse(lastEvent.slice(6))

      expect(payload.stage).toBe('completed')
      expect(payload.data?.status).toBe('published')
      expect(payload.data?.confirmUrl).toBeUndefined() // No confirmation URL for published links

      // Verify the saved link in database has user fields set correctly
      const savedLink = await testDrizzle
        .select()
        .from(links)
        .where(eq(links.id, payload.data?.id))
        .limit(1)

      expect(savedLink[0].status).toBe('published')
      expect(savedLink[0].userDescription).toBe('AI-generated summary for immediate publication')
      expect(savedLink[0].userCategory).toBe('tech')
      expect(JSON.parse(savedLink[0].userTags || '[]')).toEqual(['immediate', 'publish', 'test'])

      // Verify AI fields are also set
      expect(savedLink[0].aiSummary).toBe('AI-generated summary for immediate publication')
      expect(savedLink[0].aiCategory).toBe('tech')
      expect(JSON.parse(savedLink[0].aiTags || '[]')).toEqual(['immediate', 'publish', 'test'])
      expect(savedLink[0].publishedAt).toBeDefined()
    })
  })
})
