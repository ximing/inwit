export const ERROR_MESSAGES = {
  VALIDATION_ERROR: '请求参数不合法',
  NOT_FOUND: '资源不存在',
  INVALID_CREDENTIALS: '邮箱或密码错误',
  INVALID_TOKEN: '登录已过期',
  INTERNAL_ERROR: '服务器内部错误',
  EMAIL_ALREADY_REGISTERED: '邮箱已注册',
  LLM_NOT_CONFIGURED: '还没有配置大模型',
  LLM_PROVIDER_NOT_FOUND: '模型配置不存在',
  LLM_OUTPUT_TRUNCATED: '模型输出被截断',
  LLM_TIMEOUT: '模型响应超时',
  LLM_UNAVAILABLE: '大模型暂时不可用，请检查 API Base、密钥和模型名称',
  LLM_AUTH_FAILED: '模型身份验证失败，请检查密钥',
  LLM_REQUEST_INVALID: '模型配置或请求参数无效',
  DOCUMENT_NOT_FOUND: '文档不存在',
  CARD_LINK_NOT_FOUND: '卡片关联不存在',
  TOPIC_NOT_FOUND: '主题不存在',
  TOPIC_ARCHIVED: '主题已归档，无法写入',
  MAP_NODE_NOT_FOUND: '知识地图节点不存在',
  MAP_NODE_INVALID_PARENT: '不能挂到这个父节点（超过三级、会成环，或不在同一主题）',
  MAP_NODE_TOPIC_MISMATCH: '卡片或资料不属于该节点所在主题',
  MAP_ORGANIZE_DROPPED: '整理地图不能丢掉已挂载的卡片或资料',
  MAP_ORGANIZE_INVALID: '整理后的大纲不合法',
  TOPIC_JOB_IN_PROGRESS: '该主题已有进行中的地图任务',
  SUGGESTION_NOT_FOUND: '这条主题建议不存在',
  SUGGESTION_NOT_PENDING: '这条建议已经处理过了',
  SUGGESTION_ALREADY_PENDING: '已经有一条待处理的开主题建议',
  SUGGEST_SCAN_TOO_FEW: '未归属资料还不够聚成一类',
  JOB_NOT_FOUND: '任务不存在',
  JOB_NOT_RETRYABLE: '只有失败的任务可以重试',
  JOB_NOT_CANCELABLE: '只有等待中的任务可以取消',
  CARD_NOT_FOUND: '卡片不存在',
  EXECUTION_NOT_FOUND: '执行记录不存在',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static of(status: number, code: ErrorCode, details?: unknown): AppError {
    if (details !== undefined) {
      return new AppError(status, code, ERROR_MESSAGES[code], details);
    }
    return new AppError(status, code, ERROR_MESSAGES[code]);
  }
}
