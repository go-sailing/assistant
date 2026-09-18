-- v0.4.0 用户资料与偏好设置（对应系统设计文档 6.3 节）
--
-- nickname：昵称（≤20 字符，可空 —— 空时展示邮箱）；头像为文字首字母，不上传图片。
-- user_settings：单行/用户，jsonb 承载偏好，读时与默认值合并（老用户无行也能取默认）。
--   缺省等价于 {"lunar_enabled": true, "solar_terms_enabled": true, "home_route": "/calendar"}
--
-- 幂等：ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS。

ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(20);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);