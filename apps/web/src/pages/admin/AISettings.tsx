import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import api from '../../utils/api'
import { isSuccessResponse } from '../../utils/api-helpers'
import type { UpdateSettingsRequest } from '@magpie/shared'

interface AISettings {
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  userInstructions: string
}

export default function AISettings() {
  const [settings, setSettings] = useState<AISettings>({
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    userInstructions: ''
  })
  const [lastTestResult, setLastTestResult] = useState<any>(null)
  const [apiKeyTouched, setApiKeyTouched] = useState(false)
  const [originalApiKey, setOriginalApiKey] = useState('')

  // Check if API key is configured (but hidden)
  const isApiKeyConfigured = (apiKey: string): boolean => {
    return apiKey === '***HIDDEN***'
  }

  // Fetch system settings
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const response = await api.getSettings()
      return isSuccessResponse(response) ? response.data : null
    }
  })

  // Update local settings when data is loaded
  useEffect(() => {
    if (settingsData?.ai) {
      setSettings({
        apiKey: settingsData.ai.apiKey || '',
        baseUrl: settingsData.ai.baseUrl || 'https://api.openai.com/v1',
        model: settingsData.ai.model || 'gpt-3.5-turbo',
        temperature: settingsData.ai.temperature || 0.7,
        userInstructions: settingsData.ai.userInstructions || ''
      })
      // Don't set the hidden token as originalApiKey
      if (isApiKeyConfigured(settingsData.ai.apiKey)) {
        setOriginalApiKey('***CONFIGURED***') // Internal flag
        setApiKeyTouched(false)
      } else {
        setOriginalApiKey(settingsData.ai.apiKey || '')
        setApiKeyTouched(false)
      }
    }
  }, [settingsData])

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: UpdateSettingsRequest) => {
      const response = await api.updateSettings(newSettings)
      if (!isSuccessResponse(response)) {
        throw new Error(response.error.message)
      }
      return response.data
    },
    onSuccess: () => {
      // If user entered a new API key, mark it as configured
      if (apiKeyTouched && settings.apiKey.trim()) {
        setOriginalApiKey('***CONFIGURED***')
      }
      setApiKeyTouched(false)
      showToast('AI设置保存成功！', 'success')
    }
  })

  // Test AI connection mutation  
  const testAIMutation = useMutation({
    mutationFn: async () => {
      // If user hasn't touched API key and it's configured, require them to enter it
      if (!apiKeyTouched && originalApiKey === '***CONFIGURED***') {
        throw new Error('请重新输入API Key以进行测试')
      }
      
      const apiKeyToUse = apiKeyTouched ? settings.apiKey : originalApiKey
      
      if (!apiKeyToUse || apiKeyToUse === '***CONFIGURED***') {
        throw new Error('API Key未配置')
      }
      
      const testConfig = {
        apiKey: apiKeyToUse,
        baseUrl: settings.baseUrl,
        model: settings.model,
        temperature: settings.temperature,
        userInstructions: settings.userInstructions
      }
      const response = await api.testAiConnection(testConfig)
      return response
    },
    onSuccess: (data) => {
      setLastTestResult(data)
      if (data.success) {
        showToast('AI连接测试成功！', 'success')
      } else {
        showToast('AI连接测试失败', 'error')
      }
    },
    onError: (error) => {
      setLastTestResult({ success: false, message: error.message })
      showToast('AI连接测试失败', 'error')
    }
  })

  // Helper function for showing toasts
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const toast = document.createElement('div')
    toast.className = 'fixed top-24 left-1/2 transform -translate-x-1/2 z-[9999] animate-in fade-in slide-in-from-top-4 duration-300'
    
    const iconSvg = type === 'success' 
      ? '<svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'
      : '<svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>'
    
    const bgColor = type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
    
    toast.innerHTML = `
      <div class="flex items-center gap-3 px-4 py-3 ${bgColor} border rounded-xl shadow-lg backdrop-blur-sm max-w-md">
        <div class="flex-shrink-0">
          ${iconSvg}
        </div>
        <span class="font-medium text-sm">${message}</span>
      </div>
    `
    document.body.appendChild(toast)
    
    // Auto remove after 3 seconds with fade out
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.className += ' animate-out fade-out slide-out-to-top-4 duration-300'
        setTimeout(() => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast)
          }
        }, 300)
      }
    }, 3000)
  }, [])

  const handleSave = useCallback(() => {
    // Prepare settings to save - use the proper UpdateSettingsRequest type
    const aiSettings: UpdateSettingsRequest['ai'] = {
      baseUrl: settings.baseUrl,
      model: settings.model,
      temperature: settings.temperature,
      userInstructions: settings.userInstructions,
    }
    
    // Only include API key if user has actually entered one
    if (apiKeyTouched && settings.apiKey && !settings.apiKey.includes('***')) {
      aiSettings.apiKey = settings.apiKey
    }
    // If not touched, don't include apiKey field at all (let backend keep existing value)
    
    updateSettingsMutation.mutate({ ai: aiSettings })
  }, [updateSettingsMutation, settings, apiKeyTouched])

  const handleTestAI = useCallback(() => {
    testAIMutation.mutate()
  }, [testAIMutation])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-base-300 rounded animate-pulse"></div>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card bg-base-100 shadow-sm">
            <div className="card-body p-6 animate-pulse">
              <div className="h-6 bg-base-300 rounded w-1/3 mb-4"></div>
              <div className="space-y-3">
                <div className="h-10 bg-base-300 rounded"></div>
                <div className="h-10 bg-base-300 rounded"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-base-content">AI 服务设置</h1>
          <p className="text-base-content/60 mt-1">配置 AI 分析服务和用户补充指令</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            className={`btn btn-primary ${updateSettingsMutation.isPending ? 'loading' : ''}`}
            onClick={handleSave}
            disabled={updateSettingsMutation.isPending}
          >
            {updateSettingsMutation.isPending ? (
              <span className="flex items-center gap-2">
                <span className="loading loading-spinner loading-sm"></span>
                正在保存...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                保存配置
              </span>
            )}
          </button>
        </div>
      </div>

      {/* OpenAI API Configuration */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-header p-6 pb-0">
          <h2 className="text-xl font-semibold text-base-content flex items-center gap-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            OpenAI API 配置
          </h2>
        </div>
        <div className="card-body p-6 pt-4 space-y-4">
          {/* API Base URL */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">API Base URL</span>
              <span className="label-text-alt text-base-content/60">AI服务的基础URL地址</span>
            </label>
            <input
              type="url"
              className="input input-bordered"
              value={settings.baseUrl}
              onChange={(e) => setSettings(prev => ({
                ...prev,
                baseUrl: e.target.value
              }))}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          {/* API Key */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">API Key</span>
              <span className="label-text-alt text-base-content/60">用于访问AI服务的密钥</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={apiKeyTouched ? settings.apiKey : (originalApiKey === '***CONFIGURED***' ? '' : originalApiKey)}
                  onChange={(e) => {
                    setApiKeyTouched(true)
                    setSettings(prev => ({
                      ...prev,
                      apiKey: e.target.value
                    }))
                  }}
                  placeholder={originalApiKey === '***CONFIGURED***' ? "API Key已配置，重新输入以修改" : (originalApiKey ? "点击编辑已保存的API Key" : "sk-...")}
                />
              </div>
              <button 
                className="btn btn-outline"
                onClick={handleTestAI}
                disabled={testAIMutation.isPending || !(apiKeyTouched ? settings.apiKey.trim() : (originalApiKey !== '***CONFIGURED***' && originalApiKey.trim()))}
              >
                {testAIMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="loading loading-spinner loading-sm"></span>
                    测试中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    测试连接
                  </span>
                )}
              </button>
            </div>
            
            {/* API Key Status */}
            {originalApiKey === '***CONFIGURED***' && !apiKeyTouched && (
              <div className="flex items-center gap-2 text-sm mt-2 text-info">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>API Key已配置。要进行测试或修改，请重新输入。</span>
              </div>
            )}

            {/* Test Result */}
            {lastTestResult && (
              <div className={`flex items-center gap-2 text-sm mt-2 ${lastTestResult.success ? 'text-success' : 'text-error'}`}>
                <svg className={`w-4 h-4 ${lastTestResult.success ? 'text-success' : 'text-error'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {lastTestResult.success ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  )}
                </svg>
                <span>
                  {lastTestResult.success 
                    ? `连接成功 (${lastTestResult.data.responseTime}ms)` 
                    : `连接失败: ${lastTestResult.message}`
                  }
                </span>
              </div>
            )}
          </div>

          {/* Model Selection */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">AI 模型</span>
              <span className="label-text-alt text-base-content/60">输入要使用的模型ID</span>
            </label>
            <input
              type="text"
              className="input input-bordered"
              value={settings.model}
              onChange={(e) => setSettings(prev => ({
                ...prev,
                model: e.target.value
              }))}
              placeholder="gpt-3.5-turbo"
            />
            <div className="label">
              <span className="label-text-alt text-base-content/50">
                常用模型: gpt-3.5-turbo, gpt-4, claude-3-sonnet, gemini-pro 等
              </span>
            </div>
          </div>

          {/* Temperature Parameter */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">温度参数 (0.0 - 2.0)</span>
              <span className="label-text-alt text-base-content/60">当前: {settings.temperature}</span>
            </label>
            <div className="flex items-center gap-4">
              <span className="text-sm text-base-content/60">0.0</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                className="range range-primary flex-1"
                value={settings.temperature}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  temperature: parseFloat(e.target.value)
                }))}
              />
              <span className="text-sm text-base-content/60">2.0</span>
            </div>
            <div className="text-xs text-base-content/50 mt-1">
              较低值使输出更确定性，较高值使输出更有创造性
            </div>
          </div>
        </div>
      </div>

      {/* AI User Instructions Configuration */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-header p-6 pb-0">
          <h2 className="text-xl font-semibold text-base-content flex items-center gap-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            AI 用户补充指令
          </h2>
        </div>
        <div className="card-body p-6 pt-4 space-y-4">
          <div className="alert alert-info">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm">
              <p><strong>重要说明：</strong> 系统使用内置的优化提示词模板来确保稳定性和准确性。</p>
              <p>你只能添加补充指令来定制 AI 的行为，而不能修改完整的提示词。</p>
            </div>
          </div>

          {/* User Instructions */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">用户补充指令</span>
              <span className="label-text-alt text-base-content/60">这些指令将注入到默认模板中指导AI行为</span>
            </label>
            <textarea
              className="textarea textarea-bordered h-32"
              value={settings.userInstructions}
              onChange={(e) => setSettings(prev => ({
                ...prev,
                userInstructions: e.target.value
              }))}
              placeholder={`在这里添加你的补充指令，例如：

- 请使用英文生成摘要
- 对技术内容添加更多技术标签
- 摘要风格要更加正式/轻松
- 特别关注某些类型的内容

（留空表示只使用默认行为）`}
            />
            <div className="label">
              <span className="label-text-alt text-base-content/50">
                这些指令会被添加到系统提示词的末尾，用来补充或微调AI的分析行为
              </span>
            </div>
          </div>

          {/* Default Template Info */}
          <div className="collapse collapse-arrow bg-base-200">
            <input type="checkbox" />
            <div className="collapse-title text-sm font-medium">
              查看默认模板结构（点击展开）
            </div>
            <div className="collapse-content">
              <div className="text-xs text-base-content/70 space-y-2">
                <p><strong>默认模板包含以下要素：</strong></p>
                <ul className="list-disc list-inside ml-4 space-y-1">
                  <li>专业的内容分析指导</li>
                  <li>结构化的JSON输出格式</li>
                  <li>摘要生成规则（3-4句话，信息丰富）</li>
                  <li>动态分类选择（基于可用分类列表）</li>
                  <li>标签生成逻辑（3-5个相关标签）</li>
                  <li>语言检测和情感分析</li>
                  <li>阅读时间估算</li>
                </ul>
                <p className="mt-2"><strong>你的补充指令将在模板末尾生效</strong>，可以覆盖或补充上述行为。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Test Result Details */}
      {lastTestResult?.success && lastTestResult.data.testAnalysis && (
        <div className="card bg-base-100 shadow-sm">
          <div className="card-header p-6 pb-0">
            <h2 className="text-xl font-semibold text-base-content flex items-center gap-2">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              测试结果示例
            </h2>
          </div>
          <div className="card-body p-6 pt-4">
            <div className="bg-base-200 p-4 rounded-lg space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="font-medium text-base-content/80">模型:</span>
                  <span className="ml-2">{lastTestResult.data.model}</span>
                </div>
                <div>
                  <span className="font-medium text-base-content/80">响应时间:</span>
                  <span className="ml-2">{lastTestResult.data.responseTime}ms</span>
                </div>
              </div>
              <div>
                <span className="font-medium text-base-content/80">摘要:</span>
                <p className="mt-1 text-base-content/90">{lastTestResult.data.testAnalysis.summary}</p>
              </div>
              <div>
                <span className="font-medium text-base-content/80">分类:</span>
                <span className="ml-2 badge badge-outline">{lastTestResult.data.testAnalysis.category}</span>
              </div>
              <div>
                <span className="font-medium text-base-content/80">标签:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {lastTestResult.data.testAnalysis.tags.map((tag: string, index: number) => (
                    <span key={index} className="badge badge-outline badge-sm">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save reminder */}
      <div className="alert alert-info">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <h3 className="font-bold">别忘记保存！</h3>
          <div className="text-xs">点击上方的 &quot;保存配置&quot; 按钮后更改将生效。</div>
        </div>
      </div>
    </div>
  )
}
