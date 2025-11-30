import { testDb, testDrizzle } from './setup.js';
import { users } from '../db/schema.js';
import { seedDatabase } from '../db/seed.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createLinksRouter } from '../routes/public/links.js';
import { createSearchRouter } from '../routes/public/search.js';
import authAddLinkRoutes from '../routes/auth/add-link.js';

/**
 * Seed test database using the existing seed function
 * This ensures consistency between production and test seeding
 */
export async function seedTestDatabase() {
  // Temporarily disable console output during testing
  const originalLog = console.log;
  console.log = () => {};
  
  try {
    const result = await seedDatabase(testDrizzle);
    return result;
  } finally {
    // Restore console.log
    console.log = originalLog;
  }
}

/**
 * Create test admin user
 */
export async function createTestAdminUser(username = 'admin', password = 'testpassword') {
  const bcrypt = await import('bcrypt');
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  
  const now = Math.floor(Date.now() / 1000);
  
  const result = await testDrizzle.insert(users).values({
    username,
    passwordHash,
    salt,
    role: 'admin',
    status: 'active',
    createdAt: now,
  }).returning();
  
  return result[0];
}

/**
 * Get test database statistics
 */
export function getTestDbStats() {
  const stats = {
    settings: testDb.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number },
    apiTokens: testDb.prepare('SELECT COUNT(*) as count FROM api_tokens').get() as { count: number },
    users: testDb.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number },
    links: testDb.prepare('SELECT COUNT(*) as count FROM links').get() as { count: number },
  };
  
  return {
    settings: stats.settings.count,
    apiTokens: stats.apiTokens.count,
    users: stats.users.count,
    links: stats.links.count,
  };
}

/**
 * Clear all test data
 */
export function clearTestData() {
  const tables = ['operation_logs', 'search_logs', 'links', 'api_tokens', 'users', 'categories', 'settings'];
  
  // 先禁用外键约束
  testDb.exec('PRAGMA foreign_keys = OFF');
  
  for (const table of tables) {
    try {
      testDb.exec(`DELETE FROM ${table}`);
    } catch (error) {
      console.warn(`Failed to clear table ${table}:`, error);
    }
  }
  
  // 重新启用外键约束
  testDb.exec('PRAGMA foreign_keys = ON');
}

/**
 * Create test app for API testing
 */
export async function testApp() {
  clearTestData()
  await seedTestDatabase()
  
  // Create test app with basic routes
  const app = new Hono()
  
  // Add CORS middleware
  app.use('/*', cors())
  
  // Mount public links routes for testing (using test database)
  const linksRouter = createLinksRouter(testDrizzle)
  app.route('/api/links', linksRouter)
  
  // Mount search routes with test database
  const searchRouter = createSearchRouter(testDrizzle)
  app.route('/api/search', searchRouter)
  
  // Mount auth routes
  app.route('/api/auth/add-link', authAddLinkRoutes)
  
  // Mock SEO route for /link/:id
  app.get('/link/:id', async (c) => {
    const id = c.req.param('id')
    const userAgent = c.req.header('User-Agent') || ''
    
    // Validate ID format
    const numericId = parseInt(id)
    if (isNaN(numericId) || numericId <= 0) {
      return c.html('<html><body>Invalid Link ID</body></html>', 400)
    }
    
    // Check if it's a bot
    const isBotUA = /bot|crawler|spider|crawling|facebook|twitter|linkedin/i.test(userAgent)
    
    if (isBotUA) {
      // Return SEO-optimized HTML for bots
      return c.html(`
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Link ${id} - Magpie</title>
          <meta name="description" content="Link description for SEO">
          <meta property="og:title" content="Link ${id} - Magpie">
          <meta property="og:description" content="Link description for SEO">
          <meta property="og:type" content="article">
          <meta property="og:url" content="/link/${id}">
          <meta name="twitter:card" content="summary">
          <meta name="twitter:title" content="Link ${id} - Magpie">
          <meta name="twitter:description" content="Link description for SEO">
          <link rel="canonical" href="/link/${id}">
          <meta property="article:published_time" content="2024-01-01T00:00:00Z">
          <meta property="article:section" content="技术">
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": "Link ${id} - Magpie",
            "description": "Link description for SEO",
            "url": "/link/${id}",
            "mainEntity": {
              "@type": "Article",
              "headline": "Link ${id}",
              "description": "Link description for SEO",
              "datePublished": "2024-01-01T00:00:00Z",
              "author": {
                "@type": "Organization",
                "name": "Magpie"
              },
              "publisher": {
                "@type": "Organization",
                "name": "Magpie"
              }
            },
            "breadcrumb": {
              "@type": "BreadcrumbList",
              "itemListElement": [
                {
                  "@type": "ListItem",
                  "position": 1,
                  "name": "Home",
                  "item": "/"
                }
              ]
            }
          }
          </script>
        </head>
        <body>
          <h1>Link ${id}</h1>
          <p>Link description for SEO</p>
          <a href="https://example.com" target="_blank" rel="noopener noreferrer">Visit Original Link</a>
          <a href="/">Browse All Links</a>
        </body>
        </html>
      `)
    }
    
    // Return regular app for non-bots
    return c.html('<html><head><title>App</title></head><body><div id="root"></div></body></html>')
  })
  
  return app
}

/**
 * Get authentication headers for testing
 */
export async function getAuthHeaders(_app?: any) {
  // Mock auth headers for testing
  return {
    'Authorization': 'Bearer test-token',
    'Content-Type': 'application/json'
  }
}

/**
 * Mock data for testing
 */
export const mockLinks = [
  {
    id: 1,
    url: 'https://example.com/test',
    title: 'Test Link',
    description: 'Test Description',
    category: '技术',
    tags: ['test', 'link'],
    domain: 'example.com',
    publishedAt: '2024-01-01T00:00:00Z',
    createdAt: '2024-01-01T00:00:00Z'
  }
]

export const mockSettings = {
  site_title: 'Magpie',
  site_description: 'Link collection system'
}
