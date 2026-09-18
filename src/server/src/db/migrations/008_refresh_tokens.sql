-- v0.4.0 刷新令牌（对应系统设计文档 6.2 节）
--
-- 背景：access（JWT）有效期 2h 且无续期机制，过期后首个请求即 401，
--       用户在连续使用或微信 WebView 页面回收返回时会被突兀踢回登录页。
-- 方案：access 保持 2h + refresh 不透明令牌 30 天滑动有效、每次使用轮转。
--
-- 安全：只存 SHA-256 哈希（token_hash），不存明文；
--       revoked_at/replaced_by 构成轮转链，旧串重放可被识别（失窃信号）；
--       随用户删除级联清理。
-- 幂等：CREATE TABLE/INDEX IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64)     NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by BIGINT       REFERENCES refresh_tokens(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

-- 到期行清理：本期不内置定时任务，由后续运维按 idx_refresh_tokens_expires 删除。