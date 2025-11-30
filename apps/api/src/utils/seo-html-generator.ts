import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { links } from '../db/schema.js'
import { eq, desc, count, and, type SQL } from 'drizzle-orm'
import { getSettings } from './settings.js'
import * as schema from '../db/schema.js'
import { createLogger } from './logger.js'

const seoLogger = createLogger('seo')

type DatabaseType = BetterSQLite3Database<typeof schema>

/**
 * SEO静态HTML生成器
 * 为搜索引擎爬虫生成包含链接列表的HTML页面
 */

interface LinkData {
  id: number
  url: string
  title: string
  description: string
  category: string
  tags: string[]
  domain: string
  publishedAt: string
}

interface CategoryData {
  name: string
  count: number
}

interface SiteSettings {
  site_title: string
  site_description: string
  about_url?: string
}

interface QueryFilters {
  category?: string
  tags?: string
  search?: string
  linkId?: number
}

/**
 * 获取爬虫页面所需的数据
 */
export async function getBotPageData(database: DatabaseType, filters?: QueryFilters) {
  try {
    // 检查是否有不支持的查询参数
    const unsupportedParams = []
    if (filters?.tags) unsupportedParams.push('tags')
    if (filters?.search) unsupportedParams.push('search')
    
    // 如果有不支持的参数，返回特殊页面
    if (unsupportedParams.length > 0) {
      return {
        links: [],
        categories: [],
        settings: {
          site_title: 'Interactive Feature - Browser Required',
          site_description: `The requested feature (${unsupportedParams.join(', ')}) requires JavaScript and is only available in web browsers. Please visit this page in a browser for the full interactive experience.`,
        },
        unsupportedFeature: unsupportedParams.join(', ')
      }
    }

    // 构建查询条件
    let whereConditions: SQL<unknown> = eq(links.status, 'published')
    let linkLimit = 50
    const orderBy = desc(links.publishedAt)
    
    if (filters?.linkId) {
      // 如果指定了链接ID，只获取该链接
      const linkIdCondition = eq(links.id, filters.linkId)
      const combined = and(whereConditions, linkIdCondition)
      if (combined) whereConditions = combined
      linkLimit = 1
      // 对于单个链接，不需要排序
    } else if (filters?.category) {
      // 如果有分类过滤，添加分类条件
      const categoryCondition = eq(links.userCategory, filters.category)
      const combined = and(whereConditions, categoryCondition)
      if (combined) whereConditions = combined
    }

    // 获取已发布链接
    const linksResult = await database
      .select({
        id: links.id,
        url: links.url,
        title: links.title,
        description: links.userDescription,
        category: links.userCategory,
        tags: links.userTags,
        domain: links.domain,
        publishedAt: links.publishedAt,
      })
      .from(links)
      .where(whereConditions)
      .orderBy(orderBy)
      .limit(linkLimit)

    // 格式化链接数据
    const formattedLinks: LinkData[] = linksResult.map(link => ({
      id: link.id,
      url: link.url,
      title: link.title || '',
      description: link.description || '',
      category: link.category || '',
      tags: link.tags ? JSON.parse(link.tags) : [],
      domain: link.domain,
      publishedAt: link.publishedAt ? new Date(link.publishedAt * 1000).toISOString() : new Date().toISOString(),
    }))

    // 获取分类统计
    const categoryStats = await database
      .select({
        name: links.userCategory,
        count: count(links.id),
      })
      .from(links)
      .where(eq(links.status, 'published'))
      .groupBy(links.userCategory)
      .orderBy(desc(count(links.id)))

    const categories: CategoryData[] = categoryStats
      .filter((cat): cat is { name: string; count: number } => cat.name !== null)
      .map(cat => ({
        name: cat.name,
        count: cat.count,
      }))

    // 获取站点设置
    const settings = await getSettings(database as BetterSQLite3Database<typeof schema>)
    const siteSettings: SiteSettings = {
      site_title: settings.site_title || 'Magpie - 链接收藏',
      site_description: settings.site_description || '收集和分享有趣的链接和内容',
      about_url: settings.about_url,
    }

    return {
      links: formattedLinks,
      categories,
      settings: siteSettings,
    }
  } catch (error) {
    seoLogger.error('Error fetching bot page data', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    })
    // 返回默认数据
    return {
      links: [],
      categories: [],
      settings: {
        site_title: 'Magpie - 链接收藏',
        site_description: '收集和分享有趣的链接和内容',
      },
    }
  }
}

/**
 * 生成JSON-LD结构化数据
 */
function generateStructuredData(data: { links: LinkData[]; settings: SiteSettings }) {
  const { links, settings } = data

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: settings.site_title,
    description: settings.site_description,
    url: '/',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: links.length,
      itemListElement: links.slice(0, 10).map((link, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'WebPage',
          name: link.title,
          description: link.description,
          url: link.url,
          datePublished: link.publishedAt,
          publisher: {
            '@type': 'Organization',
            name: settings.site_title,
          },
        },
      })),
    },
  }
}

/**
 * 生成分类导航HTML
 */
function generateCategoryNav(categories: CategoryData[]) {
  if (categories.length === 0) return ''

  const categoryItems = categories
    .slice(0, 10) // 限制显示数量
    .map(
      cat => `
    <a href="/?category=${encodeURIComponent(cat.name)}" class="category-link">
      ${escapeHtml(cat.name)} (${cat.count})
    </a>
  `
    )
    .join('')

  return `
    <nav class="categories" role="navigation" aria-label="分类导航">
      <h2>分类</h2>
      <div class="category-list">
        ${categoryItems}
      </div>
    </nav>
  `
}

/**
 * 生成链接列表HTML
 */
function generateLinkList(links: LinkData[]) {
  if (links.length === 0) {
    return '<p>暂无链接内容</p>'
  }

  const linkItems = links
    .map(
      link => `
    <article class="link-item" itemscope itemtype="https://schema.org/WebPage">
      <header>
        <h3 itemprop="name">
          <a href="${escapeHtml(link.url)}" itemprop="url" target="_blank" rel="noopener">
            ${escapeHtml(link.title)}
          </a>
        </h3>
        <div class="link-meta">
          <span class="domain">${escapeHtml(link.domain)}</span>
          <time datetime="${link.publishedAt}" itemprop="datePublished">
            ${new Date(link.publishedAt).toLocaleDateString('zh-CN')}
          </time>
          ${link.category ? `<span class="category">${escapeHtml(link.category)}</span>` : ''}
        </div>
      </header>
      ${
        link.description
          ? `<p class="description" itemprop="description">${escapeHtml(link.description)}</p>`
          : ''
      }
      ${
        link.tags.length > 0
          ? `
        <footer class="tags">
          ${link.tags
            .slice(0, 5)
            .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join('')}
        </footer>
      `
          : ''
      }
    </article>
  `
    )
    .join('')

  return `
    <section class="links-section">
      <h2>最新链接</h2>
      <div class="links-list">
        ${linkItems}
      </div>
    </section>
  `
}

/**
 * HTML转义
 */
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, m => map[m])
}

/**
 * 生成不支持功能的HTML页面
 */
function generateUnsupportedFeatureHTML(data: { settings: SiteSettings; unsupportedFeature: string }): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.settings.site_title)}</title>
  <meta name="description" content="${escapeHtml(data.settings.site_description)}">
  
  <!-- Robots meta tag to prevent indexing of interactive-only content -->
  <meta name="robots" content="noindex, nofollow">
  
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #f8f9fa;
    }
    
    .notice-card {
      background: white;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      text-align: center;
    }
    
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
      color: #6c757d;
    }
    
    h1 {
      color: #2c3e50;
      margin-bottom: 20px;
      font-size: 1.8em;
    }
    
    .description {
      color: #6c757d;
      margin-bottom: 30px;
      font-size: 1.1em;
    }
    
    .feature-list {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      border-left: 4px solid #007bff;
    }
    
    .browser-link {
      display: inline-block;
      background: #007bff;
      color: white;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: 500;
      margin-top: 20px;
      transition: background-color 0.3s;
    }
    
    .browser-link:hover {
      background: #0056b3;
      text-decoration: none;
      color: white;
    }
    
    .alternative {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #dee2e6;
    }
    
    .alternative h2 {
      color: #495057;
      font-size: 1.2em;
      margin-bottom: 15px;
    }
    
    .browse-all {
      color: #007bff;
      text-decoration: none;
    }
    
    .browse-all:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="notice-card">
    <div class="icon">🌐</div>
    <h1>Interactive Feature - Browser Required</h1>
    <p class="description">
      The requested feature requires JavaScript and interactive capabilities that are only available in web browsers.
    </p>
    
    <div class="feature-list">
      <strong>Interactive Features:</strong> ${escapeHtml(data.unsupportedFeature)}
      <br><small>These features require real-time filtering, search, and user interaction.</small>
    </div>
    
    <a href="/" class="browser-link">
      Visit in Browser for Full Experience
    </a>
    
    <div class="alternative">
      <h2>For Search Engines & Crawlers</h2>
      <p>
        Browse our content organized by categories: 
        <a href="/" class="browse-all">View All Content</a>
      </p>
    </div>
  </div>
  
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "${escapeHtml(data.settings.site_title)}",
      "description": "${escapeHtml(data.settings.site_description)}",
      "url": "/",
      "interactionStatistic": {
        "@type": "InteractionCounter",
        "interactionType": "https://schema.org/BrowseAction",
        "description": "This page requires browser interaction"
      }
    }
  </script>
</body>
</html>`
}

/**
 * 生成单个链接页面的HTML
 */
function generateSingleLinkHTML(link: LinkData, settings: SiteSettings): string {
  const pageTitle = link.title ? `${link.title} - ${settings.site_title}` : settings.site_title
  const pageDescription = link.description || `Check out this link on ${settings.site_title}: ${link.url}`
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDescription)}">
  
  <!-- Open Graph for single link -->
  <meta property="og:title" content="${escapeHtml(link.title)}">
  <meta property="og:description" content="${escapeHtml(pageDescription)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="/link/${link.id}">
  <meta property="article:published_time" content="${link.publishedAt}">
  ${link.category ? `<meta property="article:section" content="${escapeHtml(link.category)}">` : ''}
  
  <!-- Twitter Card for single link -->
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(link.title)}">
  <meta name="twitter:description" content="${escapeHtml(pageDescription)}">
  
  <!-- Canonical URL -->
  <link rel="canonical" href="/link/${link.id}">
  
  <!-- JSON-LD structured data for single link -->
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "${escapeHtml(link.title)}",
      "description": "${escapeHtml(pageDescription)}",
      "url": "/link/${link.id}",
      "datePublished": "${link.publishedAt}",
      "mainEntity": {
        "@type": "Article",
        "headline": "${escapeHtml(link.title)}",
        "description": "${escapeHtml(link.description)}",
        "url": "${escapeHtml(link.url)}",
        "datePublished": "${link.publishedAt}",
        "author": {
          "@type": "Organization",
          "name": "${escapeHtml(settings.site_title)}"
        },
        "publisher": {
          "@type": "Organization",
          "name": "${escapeHtml(settings.site_title)}"
        }${link.category ? `,
        "articleSection": "${escapeHtml(link.category)}"` : ''}${link.tags.length > 0 ? `,
        "keywords": [${link.tags.map(tag => `"${escapeHtml(tag)}"`).join(', ')}]` : ''}
      },
      "breadcrumb": {
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": "/"
          },
          {
            "@type": "ListItem",
            "position": 2,
            "name": "${escapeHtml(link.title)}",
            "item": "/link/${link.id}"
          }
        ]
      }
    }
  </script>
  
  ${generateSingleLinkCSS()}
</head>
<body>
  <header>
    <div class="header-content">
      <h1><a href="/">${escapeHtml(settings.site_title)}</a></h1>
      <p class="subtitle">${escapeHtml(settings.site_description)}</p>
    </div>
  </header>
  
  <main class="single-link-main">
    <nav class="breadcrumb">
      <a href="/">Home</a> / <span>Link #${link.id}</span>
    </nav>
    
    <article class="single-link-article" itemscope itemtype="https://schema.org/Article">
      <header class="article-header">
        <h1 itemprop="headline">${escapeHtml(link.title)}</h1>
        <div class="article-meta">
          <span class="domain">${escapeHtml(link.domain)}</span>
          <time datetime="${link.publishedAt}" itemprop="datePublished">
            ${new Date(link.publishedAt).toLocaleDateString('zh-CN')}
          </time>
          ${link.category ? `<span class="category-badge">${escapeHtml(link.category)}</span>` : ''}
        </div>
      </header>
      
      ${link.description ? `
        <div class="article-description" itemprop="description">
          <p>${escapeHtml(link.description)}</p>
        </div>
      ` : ''}
      
      <div class="article-link">
        <a href="${escapeHtml(link.url)}" 
           itemprop="url" 
           target="_blank" 
           rel="noopener noreferrer"
           class="external-link">
          <span class="link-icon">🔗</span>
          Visit Original Link
          <span class="external-icon">↗</span>
        </a>
      </div>
      
      ${link.tags.length > 0 ? `
        <footer class="article-tags">
          <strong>Tags:</strong>
          ${link.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
        </footer>
      ` : ''}
    </article>
    
    <aside class="related-navigation">
      <h2>More Content</h2>
      <p>Explore more curated links and content:</p>
      <a href="/" class="back-link">← Browse All Links</a>
      ${link.category ? `<a href="/?category=${encodeURIComponent(link.category)}" class="category-link">More ${escapeHtml(link.category)} Links</a>` : ''}
    </aside>
  </main>
  
  <footer class="single-link-footer">
    <p>© ${new Date().getFullYear()} ${escapeHtml(settings.site_title)} - Curated Link Collection</p>
  </footer>
</body>
</html>`
}

/**
 * 生成单个链接页面的CSS样式
 */
function generateSingleLinkCSS(): string {
  return `
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        color: #333;
        margin: 0;
        padding: 0;
        background: #f8f9fa;
      }
      
      header {
        background: white;
        border-bottom: 1px solid #dee2e6;
        padding: 20px 0;
        margin-bottom: 30px;
      }
      
      .header-content {
        max-width: 800px;
        margin: 0 auto;
        padding: 0 20px;
        text-align: center;
      }
      
      header h1 a {
        color: #2c3e50;
        text-decoration: none;
        font-size: 1.8em;
        font-weight: 600;
      }
      
      .subtitle {
        color: #6c757d;
        margin-top: 5px;
        font-size: 1.1em;
      }
      
      .single-link-main {
        max-width: 800px;
        margin: 0 auto;
        padding: 0 20px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }
      
      .breadcrumb {
        padding: 20px 20px 10px;
        color: #6c757d;
        font-size: 0.9em;
      }
      
      .breadcrumb a {
        color: #007bff;
        text-decoration: none;
      }
      
      .single-link-article {
        padding: 20px;
      }
      
      .article-header h1 {
        color: #2c3e50;
        margin-bottom: 15px;
        font-size: 2em;
        line-height: 1.3;
      }
      
      .article-meta {
        display: flex;
        gap: 15px;
        margin-bottom: 20px;
        flex-wrap: wrap;
        font-size: 0.9em;
        color: #6c757d;
      }
      
      .domain {
        font-weight: 500;
        color: #495057;
      }
      
      .category-badge {
        background: #007bff;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 0.8em;
        font-weight: 500;
      }
      
      .article-description {
        margin: 25px 0;
        padding: 20px;
        background: #f8f9fa;
        border-left: 4px solid #007bff;
        border-radius: 4px;
      }
      
      .article-description p {
        margin: 0;
        font-size: 1.1em;
        line-height: 1.6;
        color: #495057;
      }
      
      .article-link {
        margin: 30px 0;
        text-align: center;
      }
      
      .external-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: #28a745;
        color: white;
        text-decoration: none;
        padding: 12px 24px;
        border-radius: 6px;
        font-weight: 500;
        font-size: 1.1em;
        transition: background-color 0.3s;
      }
      
      .external-link:hover {
        background: #218838;
        text-decoration: none;
        color: white;
      }
      
      .link-icon, .external-icon {
        font-size: 1.2em;
      }
      
      .article-tags {
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid #dee2e6;
      }
      
      .tag {
        display: inline-block;
        background: #e9ecef;
        color: #495057;
        padding: 4px 8px;
        margin: 2px 4px 2px 0;
        border-radius: 3px;
        font-size: 0.8em;
      }
      
      .related-navigation {
        margin-top: 40px;
        padding: 20px;
        background: #f8f9fa;
        border-radius: 8px;
      }
      
      .related-navigation h2 {
        color: #495057;
        margin-bottom: 10px;
        font-size: 1.3em;
      }
      
      .back-link, .category-link {
        display: inline-block;
        color: #007bff;
        text-decoration: none;
        margin: 5px 10px 5px 0;
        padding: 8px 12px;
        border: 1px solid #007bff;
        border-radius: 4px;
        font-size: 0.9em;
        transition: all 0.3s;
      }
      
      .back-link:hover, .category-link:hover {
        background: #007bff;
        color: white;
        text-decoration: none;
      }
      
      .single-link-footer {
        text-align: center;
        padding: 30px 20px;
        color: #6c757d;
        font-size: 0.9em;
      }
      
      @media (max-width: 768px) {
        .header-content, .single-link-main {
          padding: 0 15px;
        }
        
        .article-header h1 {
          font-size: 1.6em;
        }
        
        .article-meta {
          flex-direction: column;
          gap: 8px;
        }
        
        .external-link {
          font-size: 1em;
          padding: 10px 20px;
        }
      }
    </style>
  `
}

/**
 * 生成基础CSS样式
 */
function generateCSS() {
  return `
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        color: #333;
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
        background: #f5f5f5;
      }
      
      header {
        text-align: center;
        margin-bottom: 40px;
        padding: 30px 0;
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }
      
      h1 {
        color: #2c3e50;
        margin-bottom: 10px;
        font-size: 2.5em;
      }
      
      .subtitle {
        color: #7f8c8d;
        font-size: 1.2em;
      }
      
      .categories {
        background: white;
        padding: 20px;
        border-radius: 8px;
        margin-bottom: 30px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }
      
      .category-list {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 15px;
      }
      
      .category-link {
        display: inline-block;
        padding: 8px 16px;
        background: #3498db;
        color: white;
        text-decoration: none;
        border-radius: 20px;
        font-size: 0.9em;
        transition: background-color 0.3s;
      }
      
      .category-link:hover {
        background: #2980b9;
      }
      
      .links-section {
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }
      
      .link-item {
        padding: 25px 0;
        border-bottom: 1px solid #ecf0f1;
      }
      
      .link-item:last-child {
        border-bottom: none;
      }
      
      .link-item h3 {
        margin: 0 0 10px 0;
        font-size: 1.3em;
      }
      
      .link-item h3 a {
        color: #2c3e50;
        text-decoration: none;
      }
      
      .link-item h3 a:hover {
        color: #3498db;
      }
      
      .link-meta {
        display: flex;
        gap: 15px;
        font-size: 0.9em;
        color: #7f8c8d;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      
      .domain {
        font-weight: 500;
      }
      
      .category {
        background: #e74c3c;
        color: white;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 0.8em;
      }
      
      .description {
        color: #34495e;
        margin: 15px 0;
        line-height: 1.7;
      }
      
      .tags {
        margin-top: 15px;
      }
      
      .tag {
        display: inline-block;
        background: #ecf0f1;
        color: #2c3e50;
        padding: 4px 8px;
        margin-right: 8px;
        margin-bottom: 5px;
        border-radius: 3px;
        font-size: 0.8em;
      }
      
      @media (max-width: 768px) {
        body {
          padding: 10px;
        }
        
        h1 {
          font-size: 2em;
        }
        
        .links-section, .categories {
          padding: 20px;
        }
        
        .link-meta {
          flex-direction: column;
          gap: 5px;
        }
      }
    </style>
  `
}

/**
 * 生成完整的SEO HTML页面
 */
export async function generateBotHTML(database: DatabaseType, searchParams?: URLSearchParams, linkId?: number): Promise<string> {
  // 解析查询参数
  const filters: QueryFilters = {
    category: searchParams?.get('category') || undefined,
    tags: searchParams?.get('tags') || undefined,
    search: searchParams?.get('search') || undefined,
    linkId: linkId,
  }
  
  const data = await getBotPageData(database, filters)
  
  // 检查是否是不支持的功能页面
  if ('unsupportedFeature' in data) {
    return generateUnsupportedFeatureHTML(data as any)
  }
  
  // 如果是单个链接页面，生成专门的HTML
  if (linkId && data.links.length === 1) {
    return generateSingleLinkHTML(data.links[0], data.settings)
  }
  
  const structuredData = generateStructuredData(data)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.settings.site_title)}</title>
  <meta name="description" content="${escapeHtml(data.settings.site_description)}">
  
  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(data.settings.site_title)}">
  <meta property="og:description" content="${escapeHtml(data.settings.site_description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="/">
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(data.settings.site_title)}">
  <meta name="twitter:description" content="${escapeHtml(data.settings.site_description)}">
  
  <!-- 结构化数据 -->
  <script type="application/ld+json">
    ${JSON.stringify(structuredData, null, 2)}
  </script>
  
  ${generateCSS()}
</head>
<body>
  <header>
    <h1>${escapeHtml(data.settings.site_title)}</h1>
    <p class="subtitle">${escapeHtml(data.settings.site_description)}</p>
    ${data.settings.about_url ? `<a href="${escapeHtml(data.settings.about_url)}" target="_blank" rel="noopener">关于我们</a>` : ''}
  </header>
  
  <main>
    ${generateCategoryNav(data.categories)}
    ${generateLinkList(data.links)}
  </main>
  
  <footer style="text-align: center; margin-top: 50px; padding: 20px; color: #7f8c8d;">
    <p>© ${new Date().getFullYear()} ${escapeHtml(data.settings.site_title)} - 由 Magpie 强力驱动</p>
  </footer>
</body>
</html>`
}
