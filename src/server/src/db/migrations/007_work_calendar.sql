-- v0.4.0 法定工作日历（中国大陆 CN）（对应系统设计文档 6.1 节）
--
-- 数据来源：国务院办公厅年度节假日安排通知
--   2025 年：国办发明电〔2024〕10 号
--   2026 年：国办发明电〔2025〕7 号（2025-11-04 发布，中国政府网）
--
-- 只记录偏离默认周历（周一~周五工作、周六日休息）的日子：
--   holiday = 法定放假日本应上班的日期（工作日放假）
--   makeup  = 因调休而需要上班的周六、周日
-- 本身就是周末的放假日无需录入（默认即休息），故本表数据量很小。
--
-- 幂等：全部 INSERT ... ON CONFLICT DO NOTHING，可重复执行。
-- 后续年份：新增追加迁移（如 010_work_calendar_2027.sql）即可，无需改代码。

CREATE TABLE IF NOT EXISTS work_calendar_days (
  country      CHAR(2)     NOT NULL DEFAULT 'CN',
  day_date     DATE        NOT NULL,
  day_type     VARCHAR(16) NOT NULL,
  holiday_name VARCHAR(30),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pk_work_calendar_days PRIMARY KEY (country, day_date),
  CONSTRAINT ck_work_calendar_type CHECK (day_type IN ('holiday', 'makeup')),
  -- holiday 必须带节假日名称（月历角标与标题条要用），makeup 不需要
  CONSTRAINT ck_work_calendar_name CHECK (day_type = 'makeup' OR holiday_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_work_calendar_date ON work_calendar_days (day_date);

-- ============================ 2025 年 ============================
-- 元旦：1 月 1 日（周三）放假
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2025-01-01', 'holiday', '元旦')
ON CONFLICT DO NOTHING;

-- 春节：1/28（除夕）~2/4 放假调休；工作日放假 1/28~1/31、2/3~2/4；1/26（周日）、2/8（周六）上班
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2025-01-28', 'holiday', '春节'),
  ('CN', '2025-01-29', 'holiday', '春节'),
  ('CN', '2025-01-30', 'holiday', '春节'),
  ('CN', '2025-01-31', 'holiday', '春节'),
  ('CN', '2025-02-03', 'holiday', '春节'),
  ('CN', '2025-02-04', 'holiday', '春节'),
  ('CN', '2025-01-26', 'makeup', NULL),
  ('CN', '2025-02-08', 'makeup', NULL)
ON CONFLICT DO NOTHING;

-- 清明：4/4（周五）~4/6 放假；工作日放假 4/4
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2025-04-04', 'holiday', '清明节')
ON CONFLICT DO NOTHING;

-- 劳动节：5/1~5/5 放假调休；工作日放假 5/1、5/2、5/5；4/27（周日）上班
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2025-05-01', 'holiday', '劳动节'),
  ('CN', '2025-05-02', 'holiday', '劳动节'),
  ('CN', '2025-05-05', 'holiday', '劳动节'),
  ('CN', '2025-04-27', 'makeup', NULL)
ON CONFLICT DO NOTHING;

-- 端午：5/31（周六）~6/2 放假；工作日放假 6/2（周一）
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2025-06-02', 'holiday', '端午节')
ON CONFLICT DO NOTHING;

-- 国庆节·中秋节：10/1~10/8 放假调休；工作日放假 10/1、10/2、10/3、10/6、10/7、10/8；9/28（周日）、10/11（周六）上班
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2025-10-01', 'holiday', '国庆节'),
  ('CN', '2025-10-02', 'holiday', '国庆节'),
  ('CN', '2025-10-03', 'holiday', '国庆节'),
  ('CN', '2025-10-06', 'holiday', '国庆节'),
  ('CN', '2025-10-07', 'holiday', '国庆节'),
  ('CN', '2025-10-08', 'holiday', '国庆节'),
  ('CN', '2025-09-28', 'makeup', NULL),
  ('CN', '2025-10-11', 'makeup', NULL)
ON CONFLICT DO NOTHING;

-- ============================ 2026 年 ============================
-- 元旦：1/1（周四）~1/3 放假调休；工作日放假 1/1、1/2；1/4（周日）上班
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2026-01-01', 'holiday', '元旦'),
  ('CN', '2026-01-02', 'holiday', '元旦'),
  ('CN', '2026-01-04', 'makeup', NULL)
ON CONFLICT DO NOTHING;

-- 春节：2/15（腊月廿八）~2/23（正月初七）放假调休共 9 天；
--       工作日放假 2/16~2/20、2/23；2/14（周六）、2/28（周六）上班
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2026-02-16', 'holiday', '春节'),
  ('CN', '2026-02-17', 'holiday', '春节'),
  ('CN', '2026-02-18', 'holiday', '春节'),
  ('CN', '2026-02-19', 'holiday', '春节'),
  ('CN', '2026-02-20', 'holiday', '春节'),
  ('CN', '2026-02-23', 'holiday', '春节'),
  ('CN', '2026-02-14', 'makeup', NULL),
  ('CN', '2026-02-28', 'makeup', NULL)
ON CONFLICT DO NOTHING;

-- 清明：4/4（周六）~4/6（周一）放假；工作日放假 4/6
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2026-04-06', 'holiday', '清明节')
ON CONFLICT DO NOTHING;

-- 劳动节：5/1（周五）~5/5（周二）放假调休；工作日放假 5/1、5/4、5/5；5/9（周六）上班
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2026-05-01', 'holiday', '劳动节'),
  ('CN', '2026-05-04', 'holiday', '劳动节'),
  ('CN', '2026-05-05', 'holiday', '劳动节'),
  ('CN', '2026-05-09', 'makeup', NULL)
ON CONFLICT DO NOTHING;

-- 端午：6/19（周五）~6/21 放假；工作日放假 6/19
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2026-06-19', 'holiday', '端午节')
ON CONFLICT DO NOTHING;

-- 中秋：9/25（周五）~9/27 放假；工作日放假 9/25
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2026-09-25', 'holiday', '中秋节')
ON CONFLICT DO NOTHING;

-- 国庆节：10/1（周四）~10/7（周三）放假调休；工作日放假 10/1、10/2、10/5、10/6、10/7；
--         9/20（周日）、10/10（周六）上班
INSERT INTO work_calendar_days (country, day_date, day_type, holiday_name) VALUES
  ('CN', '2026-10-01', 'holiday', '国庆节'),
  ('CN', '2026-10-02', 'holiday', '国庆节'),
  ('CN', '2026-10-05', 'holiday', '国庆节'),
  ('CN', '2026-10-06', 'holiday', '国庆节'),
  ('CN', '2026-10-07', 'holiday', '国庆节'),
  ('CN', '2026-09-20', 'makeup', NULL),
  ('CN', '2026-10-10', 'makeup', NULL)
ON CONFLICT DO NOTHING;

-- 行数自检（发布前断言）：
--   2025 年 holiday 18 行 + makeup 5 行 = 23 行
--   2026 年 holiday 19 行 + makeup 6 行 = 25 行