import { OpenAI } from 'openai'
import { aiLogger } from '../utils/logger.js'
import type { ScrapedContent } from './web-scraper.js'

export interface AIAnalysisResult {
  title?: string
  summary: string
  category: string
  tags: string[]
  language?: string
  sentiment?: 'positive' | 'neutral' | 'negative'
  readingTime?: number
}

export interface AIAnalyzerOptions {
  apiKey: string
  baseURL?: string
  model?: string
  temperature?: number
  maxTokens?: number
  timeout?: number
}

const DEFAULT_OPTIONS = {
  model: 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 1000,
  timeout: 30000
}

// Default categories fallback (Chinese-focused)
const DEFAULT_CATEGORIES = [
  '技术', '设计', '产品', '工具', '其他'
]

// Default AI prompt template (optimized for Chinese content with dynamic categories)
const DEFAULT_PROMPT_TEMPLATE = `你是一个专业的内容分析助手，可以阅读并理解网络内容，包括博客文章，各类新闻，视频，PDF或图片等。请分析以下网页内容并返回JSON格式的结构化摘要。

**重要：你必须严格按照以下JSON格式返回结果，不要添加任何其他文本、解释或格式：**

{
  "title": "根据输入的标题，生成简洁明确的中文新标题；如果输入标题合理，可以直接使用或翻译使用，否则基于内容生成",
  "summary": "简洁明了的3-4句话摘要，除非指定了其他语言，否则使用中文",
  "category": "从以下分类中选择最合适的一个：{categories}",
  "tags": ["中文的3-5个相关标签的字符串数组"],
  "language": "检测到的语言代码(zh, en, ja等)",
  "sentiment": "positive, neutral, 或 negative",
  "readingTime": 基于{wordCount}字的文章，按每分钟225字计算阅读时间(分钟数，整数，至少1分钟)
}

**分析要求：**
- 摘要要简洁且信息丰富，突出核心观点，可以带有一些戏谑性或者吸引人的幽默表达。如果用户有特殊要求，可以遵循
- 严格从给定的分类列表中选择最合适的一个分类
- 标签应该具体且相关，有助于内容检索
- 准确检测内容的主要语言
- 阅读时间基于提供的准确字数统计计算：Math.ceil({wordCount} / 225) 分钟，最小值为1

**请只返回JSON对象，不要包含任何其他文本。**

此外，用户还需要你注意遵守以下规则。如果这些要求和上述规则有严重冲突，请优先遵守上面的规则；否则，请尽量满足用户的要求：

{user_instructions}

以下是内容信息：
- URL: {url}
- 标题: {title}
- 内容类型: {contentType}
- 原始描述: {description}
- 主要内容: {content}
`

export class AIAnalyzer {
  private client: OpenAI
  private options: Required<Omit<AIAnalyzerOptions, 'apiKey' | 'baseURL'>>
  private userInstructions: string
  private availableCategories: string[]
  private defaultCategory: string
  private baseUrl: string

  constructor(options: AIAnalyzerOptions, userInstructions?: string, categories?: string[], defaultCategory?: string) {
    const baseUrl = options.baseURL || 'https://api.openai.com/v1'

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: baseUrl,
      timeout: options.timeout || DEFAULT_OPTIONS.timeout
    })
    this.baseUrl = baseUrl
    
    this.options = {
      model: options.model || DEFAULT_OPTIONS.model,
      temperature: options.temperature || DEFAULT_OPTIONS.temperature,
      maxTokens: options.maxTokens || DEFAULT_OPTIONS.maxTokens,
      timeout: options.timeout || DEFAULT_OPTIONS.timeout
    }

    this.userInstructions = userInstructions || ''
    this.availableCategories = categories || DEFAULT_CATEGORIES
    this.defaultCategory = defaultCategory || this.availableCategories[this.availableCategories.length - 1]
  }

  async analyze(content: ScrapedContent): Promise<AIAnalysisResult> {
    try {
      // Prepare content for AI analysis
      const prompt = this.buildPrompt(content)
      
      // Analyze content
      
      // Call OpenAI API with system message for better JSON compliance
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        messages: [
          {
            role: 'system',
            content: 'You are a professional content analyzer. You must always respond with valid JSON format only. Never include explanations, markdown formatting, or any text outside the JSON object.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: this.options.temperature,
        max_tokens: this.options.maxTokens,
        response_format: { type: 'json_object' } // Force JSON response if supported
      })

      const aiResponse = response.choices?.[0]?.message?.content?.trim()

      if (!aiResponse) {
        aiLogger.warn('AI service returned empty response', {
          url: content.url,
          model: this.options.model
        })
        return this.generateFallbackAnalysis(content)
      }

      // Parse JSON response
      let analysisResult: AIAnalysisResult
      try {
        analysisResult = JSON.parse(aiResponse)
      } catch (parseError) {
        aiLogger.warn('Failed to parse AI JSON response, attempting fallback extraction', {
          url: content.url,
          model: this.options.model,
          snippet: aiResponse ? aiResponse.substring(0, 200) : undefined
        })
        analysisResult = this.extractAnalysisFromText(aiResponse, content)
      }

      // Validate and sanitize the result
      const finalResult = this.validateAndSanitize(analysisResult, content)
      
      return finalResult

    } catch (error) {
      aiLogger.error('AI analysis failed', {
        url: content.url,
        model: this.options.model,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      })
      
      // Return fallback analysis
      return this.generateFallbackAnalysis(content)
    }
  }

  private buildPrompt(content: ScrapedContent): string {
    // Replace template variables in the default template
    const categoriesStr = this.availableCategories.join('、')
    
    return DEFAULT_PROMPT_TEMPLATE
      .replace('{url}', content.url)
      .replace('{title}', content.title || 'No title')
      .replace('{contentType}', content.contentType)
      .replace('{description}', content.description || 'No description')
      .replace('{content}', this.truncateContent(content.content))
      .replace('{categories}', categoriesStr)
      .replace('{wordCount}', content.wordCount.toString())
      .replace(/{wordCount}/g, content.wordCount.toString())
      .replace('{user_instructions}', this.userInstructions || '无特殊要求')
  }

  private truncateContent(text: string, maxLength: number = 8000): string {
    // Truncate content if needed
    
    if (text.length <= maxLength) {
      return text
    }
    
    // Try to cut at sentence boundary
    const truncated = text.substring(0, maxLength)
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?'),
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('！'),
      truncated.lastIndexOf('？')
    )
    
    if (lastSentenceEnd > maxLength * 0.8) {
      return truncated.substring(0, lastSentenceEnd + 1)
    }
    
    return truncated + '...'
  }

  private extractAnalysisFromText(text: string, content: ScrapedContent): AIAnalysisResult {
    // First, try to extract JSON from text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        // Successfully extracted JSON from AI response
        return parsed
      } catch (e) {
        aiLogger.warn('JSON extraction failed for AI response', {
          snippet: jsonMatch[0]?.substring(0, 200)
        })
      }
    }
    
    // Try to extract JSON from code blocks (```json ... ```)
    const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1])
        // Successfully extracted JSON from code block
        return parsed
      } catch (e) {
        aiLogger.warn('Code block JSON extraction failed', {
          snippet: codeBlockMatch[1]?.substring(0, 200)
        })
      }
    }
    
    // If we have plain text that looks like a summary, try to create a basic analysis
    if (text && !text.includes('{') && text.length > 10) {
      // AI returned plain text instead of JSON, creating fallback analysis
      
      // Use the AI response as the summary and generate other fields
      return {
        summary: text.substring(0, 200), // Use AI text as summary
        category: this.guessCategoryFromContent(content.title, content.description + ' ' + text),
        tags: this.extractBasicTags(content.title, content.description + ' ' + text),
        language: this.detectLanguage(text),
        sentiment: 'neutral',
        readingTime: Math.max(1, Math.ceil(content.wordCount / 225))
      }
    }
    
    aiLogger.warn('Could not extract useful analysis from AI response, using fallback')
    // If everything fails, generate fallback
    return this.generateFallbackAnalysis(content)
  }

  private validateAndSanitize(result: AIAnalysisResult, content: ScrapedContent): AIAnalysisResult {
    // Validate required fields
    const sanitized: AIAnalysisResult = {
      title: this.sanitizeText(result.title) || undefined, // Use AI title if available
      summary: this.sanitizeText(result.summary) || content.description || 'Content summary not available',
      category: this.validateCategory(result.category),
      tags: this.validateTags(result.tags),
      language: this.validateLanguage(result.language || content.language),
      sentiment: this.validateSentiment(result.sentiment),
      readingTime: this.validateReadingTime(result.readingTime, content.wordCount)
    }

    return sanitized
  }

  private sanitizeText(text: any): string {
    if (typeof text !== 'string') return ''
    return text.trim().substring(0, 500) // Limit length
  }

  private validateCategory(category: any): string {
    if (typeof category === 'string') {
      // Try exact match first (for Chinese categories)
      if (this.availableCategories.includes(category)) {
        return category
      }
      // Try lowercase match (for English categories)
      if (this.availableCategories.includes(category.toLowerCase())) {
        return category.toLowerCase()
      }
    }
    // Return default category
    return this.defaultCategory
  }

  private validateTags(tags: any): string[] {
    if (!Array.isArray(tags)) return []
    
    return tags
      .filter(tag => typeof tag === 'string')
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0 && tag.length <= 50)
      .slice(0, 10) // Limit to 10 tags
  }

  private validateLanguage(language: any): string | undefined {
    if (typeof language !== 'string') return undefined
    
    // Common language codes
    const validLanguages = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'ar', 'hi']
    const lang = language.toLowerCase().substring(0, 2)
    
    return validLanguages.includes(lang) ? lang : 'en'
  }

  private validateSentiment(sentiment: any): 'positive' | 'neutral' | 'negative' | undefined {
    if (sentiment === 'positive' || sentiment === 'neutral' || sentiment === 'negative') {
      return sentiment
    }
    return 'neutral'
  }

  private validateReadingTime(readingTime: any, wordCount: number): number | undefined {
    // Estimate reading time: average 200-250 words per minute
    const estimatedTime = Math.ceil(wordCount / 225)
    
    if (typeof readingTime === 'number' && readingTime > 0 && readingTime <= 60) {
      return readingTime
    }
    
    return estimatedTime > 0 ? estimatedTime : 1
  }

  private generateFallbackAnalysis(content: ScrapedContent): AIAnalysisResult {
    // Generate basic analysis when AI fails
    // First try content-based detection, then URL-based
    let category = this.guessCategoryFromContent(content.title, content.description)
    if (category === this.defaultCategory) {
      category = this.guessCategoryFromUrl(content.url)
    }
    const tags = this.extractBasicTags(content.title, content.description)
    const language = this.detectLanguage(content.title + ' ' + content.description)
    
    return {
      summary: content.description || content.title || 'Content analysis not available',
      category,
      tags,
      language,
      sentiment: 'neutral',
      readingTime: Math.max(1, Math.ceil(content.wordCount / 225))
    }
  }

  private guessCategoryFromUrl(url: string): string {
    const urlLower = url.toLowerCase()
    
    // Map common URL patterns to Chinese categories
    if (this.availableCategories.includes('技术')) {
      if (urlLower.includes('tech') || urlLower.includes('programming') || urlLower.includes('software') || 
          urlLower.includes('github') || urlLower.includes('dev') || urlLower.includes('code') ||
          urlLower.includes('api') || urlLower.includes('framework')) {
        return '技术'
      }
    }
    
    if (this.availableCategories.includes('设计')) {
      if (urlLower.includes('design') || urlLower.includes('ui') || urlLower.includes('ux') || 
          urlLower.includes('figma') || urlLower.includes('dribbble') || urlLower.includes('behance')) {
        return '设计'
      }
    }
    
    if (this.availableCategories.includes('产品')) {
      if (urlLower.includes('product') || urlLower.includes('startup') || urlLower.includes('business') ||
          urlLower.includes('pm') || urlLower.includes('strategy')) {
        return '产品'
      }
    }
    
    if (this.availableCategories.includes('工具')) {
      if (urlLower.includes('tool') || urlLower.includes('app') || urlLower.includes('software') ||
          urlLower.includes('extension') || urlLower.includes('plugin') || urlLower.includes('utility')) {
        return '工具'
      }
    }
    
    // Return default category
    return this.defaultCategory
  }

  private guessCategoryFromContent(title: string, description: string): string {
    const content = (title + ' ' + description).toLowerCase()
    
    // Map keywords to available Chinese categories
    const categoryKeywords = {
      '技术': ['technology', 'programming', 'software', 'code', 'api', 'framework', 'dev', 'tech', '技术', '编程', '软件', '代码', '开发'],
      '设计': ['design', 'ui', 'ux', 'visual', 'graphic', 'figma', '设计', '界面', '视觉'],
      '产品': ['product', 'startup', 'business', 'company', 'marketing', 'strategy', '产品', '商业', '创业', '营销'],
      '工具': ['tool', 'app', 'software', 'utility', 'plugin', 'extension', '工具', '应用', '插件']
    }
    
    // Check each available category
    for (const category of this.availableCategories) {
      if (category === this.defaultCategory) continue // Skip default category, it's the fallback
      
      const keywords = categoryKeywords[category as keyof typeof categoryKeywords]
      if (keywords && keywords.some(keyword => {
        // Use includes for Chinese characters, word boundary for English
        if (/[\u4e00-\u9fff]/.test(keyword)) {
          return content.includes(keyword)
        } else {
          const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
          return regex.test(content)
        }
      })) {
        return category
      }
    }
    
    // Return default category
    return this.defaultCategory
  }

  private extractBasicTags(title: string, description: string): string[] {
    const text = (title + ' ' + description).toLowerCase()
    const words = text.match(/\b\w{3,}\b/g) || []
    
    // Filter common words and get unique terms
    const commonWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'was', 'one', 'our', 'has', 'have',
      'this', 'that', 'with', 'they', 'will', 'been', 'said', 'each', 'which', 'their', 'time', 'from'
    ])
    
    const uniqueWords = [...new Set(words)]
      .filter(word => !commonWords.has(word) && word.length >= 3 && word.length <= 20)
      .slice(0, 5)
    
    return uniqueWords
  }

  private detectLanguage(text: string): string {
    // Simple language detection based on character patterns
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const japaneseChars = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length
    const koreanChars = (text.match(/[\uac00-\ud7af]/g) || []).length
    
    const totalChars = text.length
    
    if (chineseChars / totalChars > 0.3) return 'zh'
    if (japaneseChars / totalChars > 0.3) return 'ja'
    if (koreanChars / totalChars > 0.3) return 'ko'
    
    return 'en'
  }

  // Update configuration
  updateUserInstructions(instructions: string): void {
    this.userInstructions = instructions
  }

  updateCategories(categories: string[]): void {
    this.availableCategories = categories
  }

  updateDefaultCategory(category: string): void {
    this.defaultCategory = category
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        messages: [{ role: 'user', content: 'Reply with "OK"' }],
        max_tokens: 128,
        temperature: 0
      })

      const choice = response.choices?.[0]
      if (!choice) return false
      const content = choice.message?.content?.trim()?.toLowerCase() ?? ''
      const reasoning = (choice.message as unknown as Record<string, unknown>)?.reasoning_content
      return content.includes('ok') || (typeof reasoning === 'string' && reasoning.length > 0)
    } catch (error) {
      aiLogger.error('AI connection test failed', {
        baseUrl: this.baseUrl,
        model: this.options.model,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      })
      return false
    }
  }
}

// Export factory function for creating analyzer with settings
export async function createAIAnalyzer(settings: Record<string, any>): Promise<AIAnalyzer> {

  const options: AIAnalyzerOptions = {
    apiKey: settings.openai_api_key || '',
    baseURL: settings.openai_base_url || 'https://api.openai.com/v1',
    model: settings.ai_model || 'gpt-3.5-turbo',
    temperature: parseFloat(settings.ai_temperature || '0.7'),
    maxTokens: parseInt(settings.ai_max_tokens || '1000'),
    timeout: parseInt(settings.ai_timeout || '30000')
  }

  if (!options.apiKey) {
    throw new Error('OpenAI API key is required')
  }

  const userInstructions = settings.ai_user_instructions || ''
  // categories should already be parsed as array from getSettings() when type='json'
  const categories = Array.isArray(settings.categories) ? settings.categories : undefined
  const defaultCategory = settings.default_category

  return new AIAnalyzer(options, userInstructions, categories, defaultCategory)
}
