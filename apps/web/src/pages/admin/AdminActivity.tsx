import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../utils/api'
import { isSuccessResponse } from '../../utils/api-helpers'
import type { ApiResponse, AdminActivityResponse, OperationStatus } from '@magpie/shared'

type StatusFilter = OperationStatus | 'all'

const statusLabels: Record<OperationStatus, { label: string; className: string }> = {
  success: { label: '成功', className: 'badge badge-success badge-sm text-white' },
  failed: { label: '失败', className: 'badge badge-error badge-sm text-white' },
  pending: { label: '进行中', className: 'badge badge-warning badge-sm text-white' }
}

const actionLabels: Record<string, { label: string; description?: string; icon: ReactElement }> = {
  link_add: {
    label: '新增链接',
    description: '通过 API 或管理界面添加链接',
    icon: (
      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    )
  },
  link_publish: {
    label: '发布链接',
    description: '将待审核链接发布到站点',
    icon: (
      <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    )
  },
  link_delete: {
    label: '删除链接',
    description: '删除已存在的链接',
    icon: (
      <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  },
  token_create: {
    label: '创建 Token',
    description: '生成新的 API Token',
    icon: (
      <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    )
  },
  token_revoke: {
    label: '撤销 Token',
    description: '停用已有的 API Token',
    icon: (
      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    )
  },
  settings_update: {
    label: '更新设置',
    description: '修改系统配置或 AI 参数',
    icon: (
      <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )
  },
  login_success: {
    label: '登录成功',
    description: '管理员登录成功',
    icon: (
      <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    )
  },
  login_failed: {
    label: '登录失败',
    description: '管理员登录失败',
    icon: (
      <svg className="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
}

const pageSizeOptions = [20, 50, 100]

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatRelativeTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} 天前`
}

function getActionMeta(action: string) {
  return actionLabels[action] ?? {
    label: action,
    icon: (
      <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      </svg>
    )
  }
}

export default function AdminActivity() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(pageSizeOptions[0])
  const [actionFilter, setActionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [resourceFilter, setResourceFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
      setPage(1)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    setPage(1)
  }, [actionFilter, statusFilter, resourceFilter, pageSize])

  const { data, isLoading, isFetching, error } = useQuery<ApiResponse<AdminActivityResponse>>({
    queryKey: ['admin-activity', page, pageSize, actionFilter, statusFilter, resourceFilter, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        page,
        limit: pageSize
      }

      if (actionFilter !== 'all') {
        params.action = actionFilter
      }

      if (statusFilter !== 'all') {
        params.status = statusFilter
      }

      if (resourceFilter !== 'all') {
        params.resource = resourceFilter
      }

      if (debouncedSearch) {
        params.search = debouncedSearch
      }

      return api.getAdminActivity(params)
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false
  })

  const activityData = data && isSuccessResponse(data) ? data.data : null
  const logs = useMemo<AdminActivityResponse['logs']>(() => {
    return activityData?.logs ?? []
  }, [activityData])
  const pagination = activityData?.pagination
  const availableFilters: AdminActivityResponse['availableFilters'] = activityData?.availableFilters ?? {
    actions: [],
    resources: [],
    statuses: [] as OperationStatus[]
  }

  const averageDuration = useMemo(() => {
    if (!logs.length) return null
    const total = logs.reduce((sum: number, log) => sum + (log.duration ?? 0), 0)
    return Math.round(total / logs.length)
  }, [logs])

  const total = pagination?.total ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-base-content">所有活动</h1>
          <p className="text-base-content/60 mt-1">审计系统中的所有操作记录，支持搜索、筛选和分页。</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-base-content/70">
          <span className="badge badge-outline">{total} 条记录</span>
          {averageDuration !== null && (
            <span className="badge badge-outline">
              平均耗时 {averageDuration} ms
            </span>
          )}
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex-1">
              <label className="input input-bordered flex items-center gap-2">
                <svg className="w-4 h-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 103.5 10.5a7.5 7.5 0 0013.15 6.15z" />
                </svg>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="grow"
                  placeholder="搜索操作、资源、IP 或错误信息"
                />
              </label>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <select
                className="select select-bordered select-sm"
                value={actionFilter}
                onChange={(event) => setActionFilter(event.target.value)}
              >
                <option value="all">全部操作</option>
                {availableFilters.actions.map((actionValue: string) => (
                  <option key={actionValue} value={actionValue}>
                    {getActionMeta(actionValue).label}
                  </option>
                ))}
              </select>
              <select
                className="select select-bordered select-sm"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="all">全部状态</option>
                {availableFilters.statuses.map((statusValue: OperationStatus) => (
                  <option key={statusValue} value={statusValue}>
                    {statusLabels[statusValue]?.label ?? statusValue}
                  </option>
                ))}
              </select>
              <select
                className="select select-bordered select-sm"
                value={resourceFilter}
                onChange={(event) => setResourceFilter(event.target.value)}
              >
                <option value="all">全部资源</option>
                {availableFilters.resources.map((resourceValue: string) => (
                  <option key={resourceValue} value={resourceValue}>
                    {resourceValue}
                  </option>
                ))}
              </select>
              <select
                className="select select-bordered select-sm"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>{size} / 页</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[...Array(5)].map((_, index) => (
                <div key={index} className="animate-pulse h-16 bg-base-200/60" />
              ))}
            </div>
          ) : error ? (
            <div className="alert alert-error m-6">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-bold">加载失败</h3>
                <div className="text-xs">请稍后重试，或检查网络连接。</div>
              </div>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-10 text-center text-base-content/60">
              <div className="flex justify-center mb-4">
                <svg className="w-12 h-12 text-base-content/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M9 8h6m2-5H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2z" />
                </svg>
              </div>
              <p>暂时没有满足条件的活动记录。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="bg-base-200/50 text-sm uppercase tracking-wide">
                    <th className="w-[220px]">操作</th>
                    <th>资源</th>
                    <th>执行者</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th className="w-[210px]">时间</th>
                    <th>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const statusMeta = log.status && statusLabels[log.status]
                    const actionMeta = getActionMeta(log.action)
                    const detailsString = log.details ? JSON.stringify(log.details, null, 2) : null

                    return (
                      <tr key={log.id} className="align-top">
                        <td>
                          <div className="flex items-start gap-3">
                            <div className="mt-1">{actionMeta.icon}</div>
                            <div>
                              <div className="font-medium text-base-content">
                                {actionMeta.label}
                              </div>
                              {actionMeta.description && (
                                <div className="text-xs text-base-content/60">
                                  {actionMeta.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-base-content">
                              {log.resource ?? '—'}
                            </span>
                            {log.resourceId !== null && log.resourceId !== undefined && (
                              <span className="text-xs text-base-content/60">ID: {log.resourceId}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          {log.actor ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-sm font-medium text-base-content">
                                {log.actor.name ?? (log.actor.type === 'user' ? '管理员' : 'Token')}
                              </span>
                              {log.actor.identifier && (
                                <span className="text-xs text-base-content/60">{log.actor.identifier}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-base-content/60">系统</span>
                          )}
                        </td>
                        <td>
                          {statusMeta ? (
                            <span className={statusMeta.className}>{statusMeta.label}</span>
                          ) : (
                            <span className="badge badge-ghost badge-sm">{log.status}</span>
                          )}
                        </td>
                        <td>
                          <span className="text-sm text-base-content/80">
                            {log.duration != null ? `${log.duration} ms` : '—'}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-base-content">
                              {formatDateTime(log.createdAt)}
                            </span>
                            <span className="text-xs text-base-content/60">
                              {formatRelativeTime(log.createdAt)}
                            </span>
                            {log.ip && (
                              <span className="text-xs text-base-content/60">IP: {log.ip}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          {detailsString ? (
                            <details className="text-sm text-base-content/80">
                              <summary className="cursor-pointer select-none text-sm text-magpie-200">
                                查看详情
                              </summary>
                              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-base-200/60 p-3 text-xs">
                                {detailsString}
                              </pre>
                              {log.errorMessage && (
                                <div className="mt-2 text-xs text-error">
                                  错误: {log.errorMessage}
                                </div>
                              )}
                            </details>
                          ) : log.errorMessage ? (
                            <div className="text-xs text-error">{log.errorMessage}</div>
                          ) : (
                            <span className="text-xs text-base-content/50">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {pagination && pagination.pages > 0 && (
          <div className="card-footer flex flex-col gap-4 border-t border-base-200/80 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-base-content/60">
              第 {pagination.page} 页，共 {Math.max(pagination.pages, 1)} 页
            </div>
            <div className="join">
              <button
                className="join-item btn btn-sm"
                disabled={!pagination.hasPrev || isFetching}
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              >
                上一页
              </button>
              <button
                className="join-item btn btn-sm"
                disabled={!pagination.hasNext || isFetching}
                onClick={() => setPage((prev) => prev + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
