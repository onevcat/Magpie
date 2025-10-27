import type { AIAnalysisResult } from '../services/ai-analyzer.js'
import type { ScrapedContent } from '../services/web-scraper.js'

export interface LinkDataBuilderParams {
  url: string
  domain: string
  scrapedContent: ScrapedContent
  aiAnalysis: AIAnalysisResult
  aiAnalysisFailed: boolean
  aiError?: string | null
  skipConfirm: boolean
  category?: string | null
  tags?: string[] | null
  now: number
}

export function buildLinkData({
  url,
  domain,
  scrapedContent,
  aiAnalysis,
  aiAnalysisFailed,
  aiError,
  skipConfirm,
  category,
  tags,
  now
}: LinkDataBuilderParams) {
  // Determine title with priority: AI title > scraped title > empty string
  const title = aiAnalysis.title || scrapedContent.title || ''

  // Handle user fields based on skipConfirm flag
  // When skipConfirm=true (publishing): use user inputs or fall back to AI analysis
  // When skipConfirm=false (pending): set user fields to null (will be set during confirmation)
  const userDescription = skipConfirm ? aiAnalysis.summary : null
  const userCategory = skipConfirm ? (category || aiAnalysis.category) : null
  const userTags = skipConfirm ? JSON.stringify(tags || aiAnalysis.tags) : null

  return {
    url,
    domain,
    title,
    originalDescription: scrapedContent.description || '',
    aiSummary: aiAnalysis.summary,
    aiCategory: aiAnalysis.category,
    aiTags: JSON.stringify(aiAnalysis.tags),
    aiReadingTime: aiAnalysis.readingTime,
    aiAnalysisFailed: aiAnalysisFailed ? 1 : 0,
    aiError: aiError || null,
    userDescription,
    userCategory,
    userTags,
    status: skipConfirm ? 'published' as const : 'pending' as const,
    publishedAt: skipConfirm ? now : null,
    createdAt: now,
    updatedAt: now
  }
}