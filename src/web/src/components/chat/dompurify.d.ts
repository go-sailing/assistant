/**
 * dompurify 3.1.x 未随包提供类型声明（仓库也不引入 @types/dompurify 依赖），
 * 这里声明本项目实际使用到的最小接口：`sanitize(dirty, config)`。
 * 若后续依赖版本内置类型，可删除本文件。
 */
declare module 'dompurify' {
  interface DOMPurifyConfig {
    ALLOWED_TAGS?: string[]
    ALLOWED_ATTR?: string[]
    /** 只允许通过的 URI 协议（如 /^(?:https?):/i） */
    ALLOWED_URI_REGEXP?: RegExp
    ALLOW_DATA_ATTR?: boolean
    ADD_ATTR?: string[]
    FORBID_TAGS?: string[]
    FORBID_ATTR?: string[]
  }

  interface DOMPurify {
    sanitize(dirty: string, config?: DOMPurifyConfig): string
    addHook(entryPoint: string, hook: (...args: unknown[]) => void): void
  }

  const instance: DOMPurify
  export default instance
}