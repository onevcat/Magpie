// API Client with full type safety
// This file demonstrates how to use the shared types for type-safe API calls

import type {
  // Response types
  ApiResponse,
  LinksResponse,
  SearchResponse,
  StatsResponse,
  PendingLinkResponse,
  AdminLinksResponse,
  TokensResponse,
  SettingsResponse,
  
  // Request types
  LinksQuery,
  SearchQuery,
  AddLinkQuery,
  AddLinkBody,
  ConfirmLinkRequest,
  UpdateLinkRequest,
  AdminLoginRequest,
  CreateTokenRequest,
  BatchOperationRequest,
  
  // Data types
  Link,
  ApiToken,
  StreamStatusMessage,
} from './api'

/**
 * Type-safe API client for Magpie
 * 
 * Usage example:
 * ```typescript
 * const api = new MagpieApiClient('http://localhost:3001')
 * 
 * // Get links with full type safety
 * const response = await api.getLinks({ page: 1, limit: 10 })
 * if (response.success) {
 *   const links: Link[] = response.data.links
 *   const pagination = response.data.pagination
 * }
 * ```
 */
export class MagpieApiClient {
  constructor(
    private baseUrl: string,
    private apiToken?: string
  ) {}

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    })

    return response.json() as Promise<ApiResponse<T>>
  }

  // Public API methods
  async getLinks(query: LinksQuery = {}): Promise<ApiResponse<LinksResponse>> {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, String(value))
      }
    })
    
    return this.request<LinksResponse>(`/api/links?${params}`)
  }

  async getLink(id: number): Promise<ApiResponse<Link>> {
    return this.request<Link>(`/api/links/${id}`)
  }

  async searchLinks(query: SearchQuery): Promise<ApiResponse<SearchResponse>> {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, String(value))
      }
    })
    
    return this.request<SearchResponse>(`/api/search?${params}`)
  }

  async getStats(): Promise<ApiResponse<StatsResponse>> {
    return this.request<StatsResponse>('/api/stats')
  }

  // Auth API methods (require API token)
  async addLink(data: AddLinkBody): Promise<ApiResponse<any>> {
    return this.request('/api/links', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async addLinkWithQuery(query: AddLinkQuery): Promise<Response> {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, String(value))
      }
    })
    
    return fetch(`${this.baseUrl}/api/links/add?${params}`)
  }

  async addLinkStream(
    data: AddLinkBody,
    onMessage: (message: StreamStatusMessage) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/links/add/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify(data),
    })

    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const message: StreamStatusMessage = JSON.parse(line.slice(6))
            onMessage(message)
          } catch (e) {
            console.error('Failed to parse SSE message:', e)
          }
        }
      }
    }
  }

  async getPendingLink(id: number): Promise<ApiResponse<PendingLinkResponse>> {
    return this.request<PendingLinkResponse>(`/api/links/${id}/pending`)
  }

  async confirmLink(id: number, data: ConfirmLinkRequest): Promise<ApiResponse<any>> {
    return this.request(`/api/links/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateLink(id: number, data: UpdateLinkRequest): Promise<ApiResponse<any>> {
    return this.request(`/api/links/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteLink(id: number): Promise<ApiResponse<any>> {
    return this.request(`/api/links/${id}`, {
      method: 'DELETE',
    })
  }

  // Admin API methods (require admin authentication)
  async adminLogin(credentials: AdminLoginRequest): Promise<ApiResponse<any>> {
    return this.request('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    })
  }

  async getAdminLinks(query: any = {}): Promise<ApiResponse<AdminLinksResponse>> {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, String(value))
      }
    })
    
    return this.request<AdminLinksResponse>(`/api/admin/links?${params}`)
  }

  async getTokens(query: any = {}): Promise<ApiResponse<TokensResponse>> {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, String(value))
      }
    })
    
    return this.request<TokensResponse>(`/api/admin/tokens?${params}`)
  }

  async createToken(data: CreateTokenRequest): Promise<ApiResponse<ApiToken>> {
    return this.request<ApiToken>('/api/admin/tokens', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getSettings(): Promise<ApiResponse<SettingsResponse>> {
    return this.request<SettingsResponse>('/api/admin/settings')
  }

  async batchOperation(data: BatchOperationRequest): Promise<ApiResponse<any>> {
    return this.request('/api/admin/pending/batch', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }
}

// Helper function to create a pre-configured client
export function createApiClient(baseUrl: string, apiToken?: string): MagpieApiClient {
  return new MagpieApiClient(baseUrl, apiToken)
}

// Export types for external use
export type {
  // All the types from api.ts are re-exported through the index
  LinksResponse,
  SearchResponse,
  Link,
  PendingLink,
  StreamStatusMessage,
  // Add more as needed
} from './api'