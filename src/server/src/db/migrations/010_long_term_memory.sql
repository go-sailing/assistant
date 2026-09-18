-- v0.5.0 长期记忆与上下文压缩（对应系统设计文档 4.1 / 5.1）
--
-- long_term_memories：归档聊天记录时提炼的长期记忆，用户可查看/单条删除/全部删除。
--   content：一句自包含陈述（4~500 字）；category：六类受控枚举；
--   last_used_at：注入节流（每天最多 touch 一次），删除即物理 DELETE，注销随外键级联。
-- conversations.context_summary：滚动摘要全文（Markdown 分节纯文本），NULL 表示从未压缩；
-- conversations.compacted_until_id：已压缩段的最大消息 id（水位指针），
--   该 id 及以前的消息不再以原文进模型；摘要正文不下发端上，会话接口只返回水位。
--
-- 幂等：CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS；纯新增，零回填。

CREATE TABLE IF NOT EXISTS long_term_memories (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      VARCHAR(500) NOT NULL,
  category     VARCHAR(32)  NOT NULL DEFAULT 'other',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT ck_ltm_category CHECK (
    category IN ('profile','preference','routine','objects','context','other')
  ),
  CONSTRAINT ck_ltm_len CHECK (char_length(content) BETWEEN 4 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_ltm_user_updated
  ON long_term_memories (user_id, updated_at DESC);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_summary TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS compacted_until_id BIGINT;