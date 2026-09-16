/** 邮箱格式校验 */
export function validateEmail(email: string): string {
  if (!email.trim()) return '请输入邮箱'
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!re.test(email.trim())) return '邮箱格式不正确'
  return ''
}

/** 密码强度：需 ≥8 位且包含字母与数字 */
export type PasswordStrength = 'weak' | 'medium' | 'strong' | 'empty'

export function passwordStrength(pwd: string): PasswordStrength {
  if (!pwd) return 'empty'
  let score = 0
  if (pwd.length >= 8) score++
  if (/[a-zA-Z]/.test(pwd)) score++
  if (/\d/.test(pwd)) score++
  if (/[^a-zA-Z0-9]/.test(pwd)) score++
  if (pwd.length < 8) return 'weak'
  if (score <= 2) return 'weak'
  if (score === 3) return 'medium'
  return 'strong'
}

export const strengthText: Record<PasswordStrength, string> = {
  empty: '',
  weak: '弱',
  medium: '中',
  strong: '强',
}

export function validatePassword(pwd: string): string {
  if (!pwd) return '请输入密码'
  if (pwd.length < 8) return '密码至少 8 位'
  if (!/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) return '密码需同时包含字母和数字'
  return ''
}

export function validateConfirmPassword(pwd: string, confirm: string): string {
  if (!confirm) return '请再次输入密码'
  if (pwd !== confirm) return '两次输入的密码不一致'
  return ''
}