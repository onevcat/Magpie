import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../utils/api'
import { isSuccessResponse } from '../utils/api-helpers'
import type { ApiResponse, LinksResponse } from '@magpie/shared'

interface SidebarData {
  categories: { id: number; name: string; slug: string; icon: string; description?: string; displayOrder: number; count: number }[]
  tags: { name: string; count: number }[]
}

// 将sidebar数据处理逻辑提取到自定义Hook  
export function useSidebarData(
  _selectedCategory: string | null,
  linksData: ApiResponse<LinksResponse> | undefined
) {
  const [sidebarData, setSidebarData] = useState<SidebarData>({ 
    categories: [], 
    tags: [] 
  })

  // Fetch categories data
  const { data: categoriesResponse } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
    staleTime: 5 * 60 * 1000,
  })
  
  const categoriesData = useMemo(() => {
    if (categoriesResponse && isSuccessResponse(categoriesResponse)) {
      return categoriesResponse.data
    }
    return []
  }, [categoriesResponse])

  // 简化的sidebar数据更新逻辑
  useEffect(() => {
    if (!Array.isArray(categoriesData) || categoriesData.length === 0) return

    if (linksData && isSuccessResponse(linksData) && linksData.data.filters) {
      // 有links数据时，合并计数信息
      const categoriesWithCounts = categoriesData.map(category => {
        const categoryFilter = linksData.data.filters.categories.find(
          f => f.name === category.name
        )
        return {
          ...category,
          count: categoryFilter?.count || 0
        }
      })

      setSidebarData({
        categories: categoriesWithCounts,
        tags: linksData.data.filters.tags || []
      })
    } else if (sidebarData.categories.length === 0) {
      // 初始化时设置零计数
      const categoriesWithZeroCounts = categoriesData.map(category => ({ 
        ...category, 
        count: 0 
      }))
      
      setSidebarData({
        categories: categoriesWithZeroCounts,
        tags: []
      })
    }
  }, [categoriesData, linksData, sidebarData.categories.length])

  return { sidebarData }
}
