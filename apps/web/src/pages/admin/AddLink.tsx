import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../utils/api'
import { isSuccessResponse } from '../../utils/api-helpers'
import ProcessingAnimation, { ProcessingStage } from '../../components/ProcessingAnimation'
import CategoryBadge from '../../components/CategoryBadge'
import TagList from '../../components/TagList'
import LinkEditForm from '../../components/LinkEditForm'

interface AddLinkForm {
  url: string
  skipConfirm: boolean
  presetCategory: string
  presetTags: string
}

interface ProcessingStatus {
  id: string
  status: 'pending' | 'processing' | 'success' | 'failed'
  message: string
  url?: string
  title?: string
  error?: string
}

export default function AddLink() {
  const [form, setForm] = useState<AddLinkForm>({
    url: '',
    skipConfirm: false,
    presetCategory: '',
    presetTags: ''
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [_processingItems, setProcessingItems] = useState<ProcessingStatus[]>([])
  const [pendingLinkId, setPendingLinkId] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    category: '',
    tags: [] as string[],
    readingTime: undefined as number | undefined
  })
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | 'info'
    text: string
  } | null>(null)
  const [messageAnimating, setMessageAnimating] = useState(false)
  
  // SSE processing states
  const [currentProcessing, setCurrentProcessing] = useState<{
    stage: ProcessingStage
    message: string
    progress?: number
    data?: any
  } | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const queryClient = useQueryClient()
  
  // Note: pendingLinkData will be extracted after the query

  // Fetch categories
  const { data: categoriesResponse, isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories()
  })

  const categories = categoriesResponse && isSuccessResponse(categoriesResponse) 
    ? categoriesResponse.data 
    : []

  // Auto-clear messages after 5 seconds with animation
  useEffect(() => {
    if (message) {
      // Start animation immediately when message appears
      setMessageAnimating(true)
      
      // Start fade out after 4.5 seconds
      const fadeOutTimer = setTimeout(() => {
        setMessageAnimating(false)
      }, 4500)
      
      // Remove message completely after animation
      const removeTimer = setTimeout(() => {
        setMessage(null)
      }, 5000)
      
      return () => {
        clearTimeout(fadeOutTimer)
        clearTimeout(removeTimer)
      }
    }
  }, [message])

  // Fetch pending link details when we have a pending link ID
  const { data: pendingLinkResponse, isLoading: pendingLinkLoading } = useQuery({
    queryKey: ['pending-link', pendingLinkId],
    queryFn: () => api.getPendingLink(pendingLinkId!),
    enabled: !!pendingLinkId
  })
  
  // Extract pending link data safely
  const pendingLinkData = pendingLinkResponse && isSuccessResponse(pendingLinkResponse)
    ? pendingLinkResponse.data
    : null

  // Add link mutation
  const addLinkMutation = useMutation({
    mutationFn: async (linkData: AddLinkForm) => {
      const processingId = Date.now().toString()
      
      // Add processing item immediately
      setProcessingItems(prev => [...prev, {
        id: processingId,
        status: 'processing',
        message: '正在处理URL...',
        url: linkData.url
      }])

      try {
        // Update processing status
        setProcessingItems(prev => prev.map(item => 
          item.id === processingId 
            ? { ...item, message: '正在获取内容...', status: 'processing' }
            : item
        ))

        // Call real API
        const response = await api.addLinkJson(linkData.url, {
          skipConfirm: linkData.skipConfirm,
          category: linkData.presetCategory || undefined,
          tags: linkData.presetTags || undefined
        })

        if (!isSuccessResponse(response)) {
          throw new Error(response.error?.message || 'Failed to add link')
        }
        
        const result = response.data

        // Update status based on response
        if (linkData.skipConfirm && result.status === 'published') {
          // Link was published immediately
          setProcessingItems(prev => prev.map(item => 
            item.id === processingId 
              ? { 
                  ...item, 
                  status: 'success',
                  message: '发布成功！',
                  title: result.title
                }
              : item
          ))
        } else if (result.id && !linkData.skipConfirm) {
          // Link needs confirmation - set the pending link ID to trigger fetching details
          setPendingLinkId(result.id)
          
          setProcessingItems(prev => prev.map(item => 
            item.id === processingId 
              ? { 
                  ...item, 
                  status: 'success',
                  message: '处理成功，准备确认',
                  title: '待确认'
                }
              : item
          ))
        }

        return result
      } catch (error: any) {
        // Handle API errors
        const errorMessage = error.message || '处理失败'
        
        setProcessingItems(prev => prev.map(item => 
          item.id === processingId 
            ? { 
                ...item, 
                status: 'failed',
                message: '处理失败',
                error: errorMessage
              }
            : item
        ))
        throw error
      }
    },
    onSuccess: (result) => {
      // Check if AI analysis failed
      const aiAnalysisFailed = result.aiAnalysisFailed
      const aiError = result.aiError
      
      // Complete the processing animation with appropriate message
      setCurrentProcessing({
        stage: 'completed',
        message: aiAnalysisFailed ? '链接处理完成（AI分析失败）' : '链接处理完成！',
        progress: 100
      })
      
      queryClient.invalidateQueries({ queryKey: ['pending-links'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats-summary'] })
      // Reset form
      setForm({ url: '', skipConfirm: false, presetCategory: '', presetTags: '' })
      
      // Show success message with AI status
      if (result.status === 'published') {
        setMessage({
          type: aiAnalysisFailed ? 'error' : 'success',
          text: aiAnalysisFailed 
            ? `链接已添加并发布，但AI分析失败：${aiError || '未知错误'}。内容基于原始信息生成。`
            : '链接已成功添加并发布！'
        })
      } else {
        setMessage({
          type: aiAnalysisFailed ? 'error' : 'info',
          text: aiAnalysisFailed 
            ? `链接已添加但AI分析失败：${aiError || '未知错误'}。请在下方手动编辑后发布。`
            : '链接已成功添加，请在下方确认后发布。'
        })
        // Set pending link ID for editing
        if (result.id) {
          setPendingLinkId(result.id)
        }
      }
      
      // Keep completed state visible - don't auto-clear
      // Will be cleared when user starts next analysis
    },
    onError: (error: any) => {
      // Show error in animation
      setCurrentProcessing({
        stage: 'error',
        message: '处理失败',
        progress: 0
      })
      
      console.error('Failed to add link:', error)
      setMessage({
        type: 'error',
        text: error.message || '添加链接失败，请检查URL是否有效或稍后重试。'
      })
      
      // Clear processing after delay
      setTimeout(() => {
        setCurrentProcessing(null)
      }, 5000)
    }
  })

  // Confirm link mutation
  const confirmLinkMutation = useMutation({
    mutationFn: async (confirmData: {
      id: number
      title?: string
      description: string
      category: string
      tags: string[]
      readingTime?: number
      publish?: boolean
    }) => {
      return await api.confirmLink(confirmData.id, {
        title: confirmData.title,
        description: confirmData.description,
        category: confirmData.category,
        tags: confirmData.tags,
        readingTime: confirmData.readingTime,
        publish: confirmData.publish !== false
      })
    },
    onSuccess: () => {
      // Show completion animation
      setCurrentProcessing({
        stage: 'completed',
        message: '链接已成功发布！',
        progress: 100
      })
      
      // Reset all states
      setPendingLinkId(null)
      setIsEditing(false)
      setEditForm({
        title: '',
        description: '',
        category: '',
        tags: [],
        readingTime: undefined
      })
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['pending-links'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats-summary'] })
      
      // Show success message
      setMessage({
        type: 'success',
        text: '链接已成功发布！您可以继续添加新的链接。'
      })
      
      // Keep completed state visible - don't auto-clear
      // Will be cleared when user starts next analysis
    },
    onError: (error: any) => {
      console.error('Failed to confirm link:', error)
      setMessage({
        type: 'error',
        text: error.message || '发布链接失败，请稍后重试。'
      })
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.url.trim()) return
    
    // Use SSE for real-time updates
    handleSubmitWithSSE()
  }
  
  // Temporary demo implementation with simulated stages
  const handleSubmitWithSSE = () => {
    // Clear any existing processing state when starting new analysis
    setCurrentProcessing(null)
    
    // Start processing animation after a brief delay to show the clear
    setTimeout(() => {
      setCurrentProcessing({
        stage: 'idle',
        message: '准备开始处理...',
        progress: 0
      })
    }, 100)
    
    // Simulate processing stages
    setTimeout(() => {
      setCurrentProcessing({
        stage: 'fetching',
        message: '正在连接到目标网站...',
        progress: 20
      })
    }, 500)
    
    setTimeout(() => {
      setCurrentProcessing({
        stage: 'fetching',
        message: '正在获取网页内容...',
        progress: 60
      })
    }, 2000)
    
    setTimeout(() => {
      setCurrentProcessing({
        stage: 'analyzing',
        message: '正在进行AI智能分析...',
        progress: 80
      })
    }, 4000)
    
    // Use real API call
    setTimeout(() => {
      addLinkMutation.mutate(form)
      setCurrentProcessing({
        stage: 'analyzing',
        message: '正在生成智能摘要...',
        progress: 95
      })
    }, 6000)
  }
  
  // Cleanup on unmount
  useEffect(() => {
    const eventSource = eventSourceRef.current

    return () => {
      eventSource?.close()
    }
  }, [])


  // Unused function - commenting out to fix build error
  // const clearProcessing = () => {
  //   setProcessingItems([])
  // }

  // Unused function - commenting out to fix build error  
  // const retryProcessing = (id: string) => {
  //   const item = processingItems.find(p => p.id === id)
  //   if (item && item.url) {
  //     addLinkMutation.mutate({
  //       url: item.url,
  //       skipConfirm: form.skipConfirm,
  //       presetCategory: form.presetCategory,
  //       presetTags: form.presetTags
  //     })
  //   }
  // }

  // Handle edit mode
  const handleStartEdit = () => {
    if (pendingLinkData) {
      setEditForm({
        title: pendingLinkData.title,
        description: pendingLinkData.aiSummary,
        category: pendingLinkData.aiCategory,
        tags: [...pendingLinkData.aiTags],
        readingTime: pendingLinkData.aiReadingTime
      })
      setIsEditing(true)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditForm({
      title: '',
      description: '',
      category: '',
      tags: [],
      readingTime: undefined
    })
  }


  // Handle confirm actions
  const handleConfirmWithEdits = (data?: { title: string; description: string; category: string; tags: string[]; readingTime?: number }) => {
    if (!pendingLinkId || !pendingLinkData) return
    
    // If data is provided (from LinkEditForm), use it; otherwise use the current editForm
    const formData = data || {
      title: editForm.title,
      description: editForm.description,
      category: editForm.category,
      tags: editForm.tags,
      readingTime: editForm.readingTime
    }
    
    // Basic validation
    if (!formData.title?.trim()) {
      setMessage({
        type: 'error',
        text: '请填写标题'
      })
      return
    }
    
    if (!formData.description?.trim()) {
      setMessage({
        type: 'error',
        text: '请填写描述'
      })
      return
    }
    
    confirmLinkMutation.mutate({
      id: pendingLinkId,
      title: formData.title.trim() || pendingLinkData.title,
      description: formData.description.trim() || pendingLinkData.aiSummary,
      category: formData.category || pendingLinkData.aiCategory,
      tags: formData.tags.length > 0 ? formData.tags : pendingLinkData.aiTags,
      readingTime: formData.readingTime || pendingLinkData.aiReadingTime,
      publish: true
    })
  }

  const handleDirectConfirm = () => {
    if (!pendingLinkId || !pendingLinkData) return
    
    confirmLinkMutation.mutate({
      id: pendingLinkId,
      title: pendingLinkData.title,
      description: pendingLinkData.aiSummary,
      category: pendingLinkData.aiCategory,
      tags: pendingLinkData.aiTags,
      readingTime: pendingLinkData.aiReadingTime,
      publish: true
    })
  }

  // Unused function - commenting out to fix build error
  // const getStatusColor = (status: ProcessingStatus['status']) => {
  //   switch (status) {
  //     case 'processing': return 'text-blue-600'
  //     case 'success': return 'text-green-600'
  //     case 'failed': return 'text-red-600'
  //     default: return 'text-gray-600'
  //   }
  // }

  // Unused function - commenting out to fix build error
  // const getStatusIcon = (status: ProcessingStatus['status']) => {
  //   switch (status) {
  //     case 'processing': 
  //       return <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
  //     case 'success': 
  //       return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  //     case 'failed': 
  //       return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  //     default: 
  //       return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  //   }
  // }

  return (
    <>
      {/* Message Alert - Portal-style fixed position toast */}
      {message && (
        <div 
          className="fixed top-4 right-4 z-50 transition-all duration-300 ease-in-out"
          style={{
            transform: messageAnimating ? 'translateY(0)' : 'translateY(-20px)',
            opacity: messageAnimating ? 1 : 0,
          }}
        >
          <div className={`alert ${
            message.type === 'success' ? 'alert-success' : 
            message.type === 'error' ? 'alert-error' : 
            'alert-info'
          } shadow-lg`}>
            <div>
              <span>{message.text}</span>
            </div>
          </div>
        </div>
      )}
      
      <div className="space-y-6">

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-base-content">添加新链接</h1>
          <p className="text-base-content/60 mt-1">添加链接用于开发和测试</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main Column - Takes 2/3 width on XL screens */}
        <div className="xl:col-span-2 space-y-6">
          {/* Add Link Form - No border */}
          <div className="bg-base-100">
            <div className="p-6 pb-0">
              <h2 className="text-xl font-semibold text-base-content flex items-center gap-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                添加新链接
              </h2>
            </div>
            <div className="p-6 pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* URL Input */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">链接地址</span>
                </label>
                <input
                  type="url"
                  className="input input-bordered"
                  placeholder="https://example.com/article"
                  value={form.url}
                  onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                  required
                />
              </div>

              {/* Advanced Options */}
              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-2">
                  <span className="label-text font-medium">高级选项</span>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm"
                    checked={showAdvanced}
                    onChange={(e) => setShowAdvanced(e.target.checked)}
                  />
                </label>
              </div>

              {showAdvanced && (
                <div className="space-y-4 p-4 bg-base-200/30 rounded-lg border border-base-300/20">
                  {/* Skip Confirm */}
                  <div className="form-control">
                    <label className="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary"
                        checked={form.skipConfirm}
                        onChange={(e) => setForm(prev => ({ ...prev, skipConfirm: e.target.checked }))}
                      />
                      <span className="label-text">跳过确认，直接发布</span>
                    </label>
                  </div>

                  {/* Preset Category */}
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text">预设分类（可选）</span>
                    </label>
                    <select
                      className="select select-bordered"
                      value={form.presetCategory}
                      onChange={(e) => setForm(prev => ({ ...prev, presetCategory: e.target.value }))}
                      disabled={categoriesLoading}
                    >
                      <option value="">自动检测</option>
                      {categories.map((category: any) => (
                        <option key={category.id} value={category.name}>{category.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Preset Tags */}
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text">预设标签（可选）</span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered"
                      placeholder="react, 前端, 教程"
                      value={form.presetTags}
                      onChange={(e) => setForm(prev => ({ ...prev, presetTags: e.target.value }))}
                    />
                    <label className="label">
                      <span className="label-text-alt text-base-content/50">
                        多个标签用逗号分隔
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="btn btn-primary w-full"
                  disabled={addLinkMutation.isPending || (currentProcessing !== null && currentProcessing.stage !== 'completed') || !form.url.trim()}
                >
                  {addLinkMutation.isPending || (currentProcessing !== null && currentProcessing.stage !== 'completed') ? (
                    <>
                      <span className="loading loading-spinner loading-xs"></span>
                      <span>正在处理...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <span>添加链接</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Processing Status - Show animation when processing */}
        {currentProcessing ? (
          <ProcessingAnimation 
            stage={currentProcessing.stage}
            message={currentProcessing.message}
            progress={currentProcessing.progress}
            error={currentProcessing.stage === 'error' ? currentProcessing.message : undefined}
          />
        ) : (
          <div className="bg-base-100">
            <div className="p-6 pb-0">
              <h2 className="text-xl font-semibold text-base-content flex items-center gap-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                处理状态
              </h2>
            </div>
            <div className="p-6 pt-4">
              <div className="text-center py-8 text-base-content/50">
                <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 8h6m-6 4h6" />
                </svg>
                <p>还没有处理项</p>
                <p className="text-xs mt-1">添加链接以查看处理状态</p>
              </div>
            </div>
          </div>
        )}
        </div>

        {/* Side Column - Takes 1/3 width on XL screens */}
        <div className="xl:col-span-1 space-y-6">
          {/* Placeholder - will be used for additional info or quick actions */}
        </div>
      </div>

      {/* AI Analysis Results - shown when we have pending link data */}
      {pendingLinkData && (
        <div className="card bg-base-100 shadow-sm">
          <div className="card-header p-6 pb-0">
            <h2 className="text-xl font-semibold text-base-content flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI 分析结果
            </h2>
            <p className="text-sm text-base-content/60 mt-1">
              查看 AI 为您生成的内容建议，您可以进行编辑后确认发布
            </p>
          </div>
          <div className="card-body p-6 pt-4">
            {pendingLinkLoading ? (
              <div className="animate-pulse">
                <div className="h-4 bg-base-300 rounded w-3/4 mb-4"></div>
                <div className="h-4 bg-base-300 rounded w-1/2 mb-4"></div>
                <div className="h-20 bg-base-300 rounded mb-4"></div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Link Info */}
                <div className="border border-base-300/20 rounded-lg p-4 bg-base-200/30">
                  <h3 className="font-semibold text-base-content mb-2">{pendingLinkData.title}</h3>
                  <p className="text-sm text-base-content/60 mb-2">{pendingLinkData.url}</p>
                  <p className="text-sm text-base-content/70">{pendingLinkData.domain}</p>
                  <p className="text-xs text-base-content/50 mt-2">
                    创建时间: {new Date(pendingLinkData.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>

                {/* AI Analysis Status Alert */}
                {pendingLinkData.aiAnalysisFailed && (
                  <div className="alert alert-warning">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <div className="text-xs font-semibold">AI 分析失败</div>
                      <div className="text-xs opacity-75 mt-1">
                        以下内容基于原始信息生成，建议您手动编辑优化内容
                      </div>
                      {pendingLinkData.aiError && (
                        <details className="mt-2">
                          <summary className="text-xs cursor-pointer hover:underline">查看错误详情</summary>
                          <div className="text-xs mt-1 opacity-75 bg-base-100 p-2 rounded">
                            {pendingLinkData.aiError}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                )}

                {/* AI Suggestions */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* AI Summary */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-base-content flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                      </svg>
                      AI 摘要
                    </h4>
                    <div className="p-3 bg-blue-50/50 border border-blue-200/50 rounded-lg">
                      <p className="text-sm text-base-content">{pendingLinkData.aiSummary}</p>
                    </div>
                  </div>

                  {/* AI Category and Tags */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-base-content flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      AI 分类和标签
                    </h4>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-base-content/70">分类：</span>
                        <CategoryBadge category={pendingLinkData.aiCategory} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-base-content/70">标签：</span>
                        <TagList tags={pendingLinkData.aiTags} maxVisible={10} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Original Description (if available) */}
                {pendingLinkData.originalDescription && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-base-content flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      原始描述
                    </h4>
                    <div className="p-3 bg-base-200/30 rounded-lg">
                      <p className="text-sm text-base-content/80">{pendingLinkData.originalDescription}</p>
                    </div>
                  </div>
                )}

                {/* Edit Form - shown when editing */}
                {isEditing && (
                  <LinkEditForm
                    initialData={editForm}
                    categories={categories}
                    onSave={(data) => handleConfirmWithEdits(data)}
                    onCancel={handleCancelEdit}
                    isLoading={confirmLinkMutation.isPending}
                    saveButtonText="确认发布"
                    cancelButtonText="取消编辑"
                  />
                )}

                {/* Action buttons - only shown when not editing */}
                {!isEditing && (
                  <div className="flex gap-2 pt-4 border-t border-base-300/20">
                    <>
                      <button 
                        className="btn btn-primary"
                        onClick={handleStartEdit}
                        disabled={confirmLinkMutation.isPending}
                      >
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                          编辑并确认
                        </span>
                      </button>
                      <button 
                        className={`btn btn-success btn-outline ${confirmLinkMutation.isPending ? 'loading' : ''}`}
                        onClick={handleDirectConfirm}
                        disabled={confirmLinkMutation.isPending}
                      >
                        {confirmLinkMutation.isPending ? (
                          <span className="flex items-center gap-2">
                            <span className="loading loading-spinner loading-sm"></span>
                            发布中...
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            直接确认
                          </span>
                        )}
                      </button>
                      <button 
                        className="btn btn-ghost"
                        onClick={() => {
                          setPendingLinkId(null)
                          setIsEditing(false)
                        }}
                        disabled={confirmLinkMutation.isPending}
                      >
                        取消
                      </button>
                    </>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      </div>
    </>
  )
}
