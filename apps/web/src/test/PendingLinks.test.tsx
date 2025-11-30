import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PendingLinks from '../pages/admin/PendingLinks'

// Mock the API module
vi.mock('../utils/api', () => ({
  default: {
    getPendingLinks: vi.fn(),
    getCategories: vi.fn(),
    batchPendingLinks: vi.fn(),
    confirmLink: vi.fn(),
  }
}))

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  useLocation: vi.fn(() => ({ pathname: '/admin/pending' })),
}))

import api from '../utils/api'

describe('PendingLinks', () => {
  let queryClient: QueryClient

  const mockPendingLinksData = {
    links: [
      {
        id: 1,
        url: 'https://example.com/article',
        title: 'Test Article',
        domain: 'example.com',
        originalDescription: 'Original description',
        aiSummary: 'AI generated summary',
        aiCategory: '技术',
        aiTags: ['javascript', 'react'],
        createdAt: 1640995200, // Unix timestamp
        status: 'pending',
        aiAnalysisFailed: false
      },
      {
        id: 2,
        url: 'https://example.com/another',
        title: 'Another Article',
        domain: 'example.com',
        originalDescription: 'Another description',
        aiSummary: 'Another AI summary',
        aiCategory: '设计',
        aiTags: ['design', 'ui'],
        createdAt: 1640995800,
        status: 'pending',
        aiAnalysisFailed: true,
        aiError: 'API timeout'
      }
    ],
    pagination: {
      page: 1,
      limit: 10,
      total: 2,
      pages: 1,
      hasNext: false,
      hasPrev: false
    }
  }

  const mockCategories = [
    { id: 1, name: '技术' },
    { id: 2, name: '设计' },
    { id: 3, name: '产品' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })

    // Setup default API mocks
    vi.mocked(api.getPendingLinks).mockResolvedValue({
      success: true,
      data: { ...mockPendingLinksData, filters: { categories: [], tags: [], yearMonths: [] } }
    } as any)

    vi.mocked(api.getCategories).mockResolvedValue({
      success: true,
      data: mockCategories.map(cat => ({ ...cat, slug: cat.name, icon: 'folder', displayOrder: 1, linkCount: 0 }))
    } as any)
  })

  const renderWithQueryClient = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    )
  }

  describe('Basic Rendering', () => {
    it('should render page title and description', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        expect(screen.getByText('待处理链接')).toBeInTheDocument()
        expect(screen.getByText('2 个链接待审核')).toBeInTheDocument()
      })
    })

    it('should show loading state initially', () => {
      // Create a query client that never resolves to test loading state
      const slowQueryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { retry: false }
        }
      })
      
      vi.mocked(api.getPendingLinks).mockImplementation(() => new Promise(() => {}))
      
      render(
        <QueryClientProvider client={slowQueryClient}>
          <PendingLinks />
        </QueryClientProvider>
      )
      
      // During loading state, only loading skeletons are shown (no page title)
      // Should show skeleton loading elements
      const skeletons = document.querySelectorAll('.animate-pulse')
      expect(skeletons.length).toBeGreaterThan(0)
      
      // Loading state shows space-y-4 container
      expect(document.querySelector('.space-y-4')).toBeInTheDocument()
    })

    it('should display pending links after loading', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        expect(screen.getByText('Test Article')).toBeInTheDocument()
        expect(screen.getByText('Another Article')).toBeInTheDocument()
      })
    })

    it('should show empty state when no pending links', async () => {
      vi.mocked(api.getPendingLinks).mockResolvedValue({
        success: true,
        data: { ...mockPendingLinksData, links: [], filters: { categories: [], tags: [], yearMonths: [] } }
      } as any)

      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        expect(screen.getByText('全部处理完毕！')).toBeInTheDocument()
        expect(screen.getByText('暂时没有待审核的链接。')).toBeInTheDocument()
      })
    })
  })

  describe('Link Display', () => {
    it('should display link information correctly', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        expect(screen.getByText('Test Article')).toBeInTheDocument()
        expect(screen.getAllByText('example.com')).toHaveLength(2) // Two links with same domain
        expect(screen.getByText('AI generated summary')).toBeInTheDocument()
        expect(screen.getByText('技术')).toBeInTheDocument()
        expect(screen.getByText('#javascript')).toBeInTheDocument()
        expect(screen.getByText('#react')).toBeInTheDocument()
      })
    })

    it('should show AI analysis failure warning', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        expect(screen.getByText('AI分析失败')).toBeInTheDocument()
        expect(screen.getByText('错误: API timeout')).toBeInTheDocument()
      })
    })
  })

  describe('Selection Functionality', () => {
    it('should allow selecting individual links', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const checkboxes = screen.getAllByRole('checkbox')
        expect(checkboxes).toHaveLength(3) // 2 individual + 1 select all
        
        fireEvent.click(checkboxes[1]) // Click first link checkbox
        expect(checkboxes[1]).toBeChecked()
      })
    })

    it('should allow select all functionality', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const selectAllCheckbox = screen.getByLabelText('全选')
        fireEvent.click(selectAllCheckbox)
        
        const individualCheckboxes = screen.getAllByRole('checkbox').slice(1)
        individualCheckboxes.forEach(checkbox => {
          expect(checkbox).toBeChecked()
        })
      })
    })

    it('should show batch action buttons when links are selected', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const checkbox = screen.getAllByRole('checkbox')[1]
        fireEvent.click(checkbox)
        
        expect(screen.getByText('已选择 1 个链接')).toBeInTheDocument()
        expect(screen.getByText('全部确认')).toBeInTheDocument()
        expect(screen.getByText('全部删除')).toBeInTheDocument()
      })
    })
  })

  describe('Edit Functionality', () => {
    it('should show edit button for each link', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const editButtons = screen.getAllByText('编辑')
        expect(editButtons).toHaveLength(2)
      })
    })

    it('should show edit form when edit button is clicked', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const editButtons = screen.getAllByText('编辑')
        fireEvent.click(editButtons[0])
        
        expect(screen.getByText('编辑链接信息')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Test Article')).toBeInTheDocument()
        expect(screen.getByDisplayValue('AI generated summary')).toBeInTheDocument()
        expect(screen.getByDisplayValue('技术')).toBeInTheDocument()
        expect(screen.getByDisplayValue('javascript, react')).toBeInTheDocument()
      })
    })

    it('should hide regular actions when editing', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const editButtons = screen.getAllByText('编辑')
        fireEvent.click(editButtons[0])
        
        // Regular actions should be hidden for the editing link
        expect(screen.getByText('保存并发布')).toBeInTheDocument()
        expect(screen.getByText('取消')).toBeInTheDocument()
        
        // But still visible for the other link
        const confirmButtons = screen.getAllByText('确认')
        expect(confirmButtons).toHaveLength(1) // Only one confirm button should remain
      })
    })

    it('should allow canceling edit', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const editButtons = screen.getAllByText('编辑')
        fireEvent.click(editButtons[0])
        
        const cancelButton = screen.getByText('取消')
        fireEvent.click(cancelButton)
        
        expect(screen.queryByText('编辑链接信息')).not.toBeInTheDocument()
        expect(screen.getAllByText('编辑')).toHaveLength(2)
      })
    })
  })

  describe('Actions', () => {
    it('should have confirm buttons for each link', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const confirmButtons = screen.getAllByText('确认')
        expect(confirmButtons).toHaveLength(2)
      })
    })

    it('should have delete buttons for each link', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const deleteButtons = screen.getAllByText('删除')
        expect(deleteButtons).toHaveLength(2)
      })
    })

    it('should have visit link buttons', async () => {
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        const visitButtons = screen.getAllByText('访问')
        expect(visitButtons).toHaveLength(2)
        
        // Check that they are links with correct href
        visitButtons.forEach((button, index) => {
          const link = button.closest('a')
          expect(link).toHaveAttribute('href', mockPendingLinksData.links[index].url)
          expect(link).toHaveAttribute('target', '_blank')
        })
      })
    })
  })

  describe('Error Handling', () => {
    it('should show error state when API fails', async () => {
      vi.mocked(api.getPendingLinks).mockRejectedValue(new Error('API Error'))
      
      renderWithQueryClient(<PendingLinks />)
      
      await waitFor(() => {
        expect(screen.getByText('加载待处理链接失败')).toBeInTheDocument()
        expect(screen.getByText('请尝试刷新页面')).toBeInTheDocument()
      })
    })
  })

  describe('Date Formatting', () => {
    it('should format timestamps correctly', async () => {
      renderWithQueryClient(<PendingLinks />)
      const expectedDate = new Date(1640995200 * 1000).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
      
      await waitFor(() => {
        // Should show formatted date (1640995200 = 2022-01-01 00:00:00 UTC)
        // The formatDate function uses toLocaleString('zh-CN'), matching the locally formatted timestamp
        expect(screen.getByText(expectedDate)).toBeInTheDocument()
      })
    })
  })
})
