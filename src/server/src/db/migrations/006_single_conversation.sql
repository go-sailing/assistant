-- v0.3.0 单会话：每用户收敛为唯一会话（对应系统设计文档 6.1 节）
--
-- 目标：把「一用户多会话」的数据形态收敛为「一用户一行」，并加唯一索引兜底。
-- 幂等：以唯一索引是否存在为闸门，整体重复执行安全（迁移 runner 本身也在单事务内执行）。
-- 无损：其他会话的 messages 按原 id 顺序改挂到保留会话（历史全可读）；
--       tool_invocations 改挂保持审计链；pending_actions 为临时对象，随旧会话物理删除。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'uniq_conversations_user'
  ) THEN

    -- 1) 每用户保留最新会话（updated_at 最新，并列取 id 最大）
    CREATE TEMP TABLE _v030_keep_conv ON COMMIT DROP AS
      SELECT DISTINCT ON (user_id) user_id, id AS keep_id
      FROM conversations
      ORDER BY user_id, updated_at DESC, id DESC;

    -- 2) 先解除待合并消息的幂等键：
    --    uniq_msg_client_id 是 (conversation_id, client_msg_id) 部分唯一索引，
    --    多个会话各自的重试键并入同一会话后会互相冲突。该键只服务于近期发送重试，
    --    历史合并消息不会再重放，置空不影响业务。
    UPDATE messages SET client_msg_id = NULL
    WHERE conversation_id IN (
      SELECT c.id
      FROM conversations c
      JOIN _v030_keep_conv k ON k.user_id = c.user_id AND c.id <> k.keep_id
    );

    -- 3) 工具审计改挂保留会话（tool_invocations.conversation_id 无外键、可空）
    --    注意：被更新表不能出现在 FROM 子句的 JOIN ON 中，故用逗号 FROM + WHERE 关联
    UPDATE tool_invocations t SET conversation_id = k.keep_id
    FROM _v030_keep_conv k, conversations c
    WHERE c.user_id = k.user_id AND c.id = t.conversation_id AND c.id <> k.keep_id;

    -- 4) 待确认动作随旧会话删除（临时对象，无保留价值）
    DELETE FROM pending_actions
    WHERE conversation_id IN (
      SELECT c.id
      FROM conversations c
      JOIN _v030_keep_conv k ON k.user_id = c.user_id AND c.id <> k.keep_id
    );

    -- 5) 消息改挂保留会话（SERIAL id 顺序即全局创建顺序，时间线天然有序）
    UPDATE messages m SET conversation_id = k.keep_id
    FROM _v030_keep_conv k, conversations c
    WHERE c.user_id = k.user_id AND c.id = m.conversation_id AND c.id <> k.keep_id;

    -- 6) 删除已腾空的非保留会话（此时 messages/pending_actions 均无引用）
    DELETE FROM conversations c
    USING _v030_keep_conv k
    WHERE c.user_id = k.user_id AND c.id <> k.keep_id;

    -- 7) 单会话唯一约束：get-or-create 的 ON CONFLICT 目标
    CREATE UNIQUE INDEX uniq_conversations_user ON conversations(user_id);

  END IF;
END $$;