-- SoloEngine 业务库 DDL（PostgreSQL 形态，schema 由连接层设定，默认 mgmt）
-- 与框架包 src/db/schema.sql 同表同列同约束；仅方言差异：
--   INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
--   REAL → DOUBLE PRECISION
--   PRAGMA → 由连接层处理
-- 会话运行时数据不落本库；本库只承载「会话归属 2 表 + 资产 12 表」。

-- 共享版本表：按组件记录版本（不再各自写 user_version）。
CREATE TABLE IF NOT EXISTS schema_versions (
  component TEXT PRIMARY KEY,
  version   INTEGER NOT NULL
);

-- ── 资产：账号与认证根 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              TEXT    PRIMARY KEY,
  username        TEXT    NOT NULL UNIQUE,
  email           TEXT    UNIQUE,
  hashed_password TEXT    NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  is_superuser    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT,
  updated_at      TEXT,
  last_login      TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  -- 令牌版本（W11.1 / R007）：超管重置口令后自增，已签发的访问/刷新令牌因版本不匹配立即失效。
  token_version   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── 资产：用户级默认插件表（需求 §0.1.4）──────────────────────────────────────
-- 每个用户一套默认插件表：新建 agent 节点按它初始化节点插件行，节点未声明插件时编译/打包回落到它。
-- `plugins` 存组合差异 JSON（与画布实例差异同格式）；`version` 是乐观锁（没有行时视作 0）。

CREATE TABLE IF NOT EXISTS user_default_plugins (
  user_id    TEXT    PRIMARY KEY REFERENCES users(id),
  plugins    TEXT    NOT NULL DEFAULT '{}',
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);

-- ── 资产：agenticflow（画布）定义 ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agentic_flows (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id),
  name         TEXT    NOT NULL,
  description  TEXT,
  icon         TEXT,
  tags         TEXT,
  folder_path  TEXT,
  canvas_data  TEXT,
  is_template  INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT,
  updated_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_agentic_flows_user_id ON agentic_flows(user_id);

-- ── 资产：运行项目（cwd 注册表与会话归属集合）─────────────────────────────────

CREATE TABLE IF NOT EXISTS run_projects (
  id               TEXT    PRIMARY KEY,
  user_id          TEXT    NOT NULL REFERENCES users(id),
  agentic_flow_id  TEXT    NOT NULL REFERENCES agentic_flows(id),
  name             TEXT    NOT NULL,
  folder_path      TEXT    NOT NULL,
  description      TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  last_accessed_at TEXT,
  created_at       TEXT,
  updated_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_run_projects_user_active ON run_projects(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_run_projects_user_flow ON run_projects(user_id, agentic_flow_id);

-- ── 资产：模型配置（每行投影为一条 soloengine-<id> 路由）──────────────────────

CREATE TABLE IF NOT EXISTS llm_configs (
  id                 TEXT    PRIMARY KEY,
  user_id            TEXT    NOT NULL REFERENCES users(id),
  name               TEXT    NOT NULL,
  provider           TEXT    NOT NULL,
  model_name         TEXT    NOT NULL,
  api_key            TEXT,
  base_url           TEXT,
  is_full_url        INTEGER NOT NULL DEFAULT 0,
  temperature        DOUBLE PRECISION,
  max_tokens         INTEGER,
  max_input_tokens   INTEGER,
  max_output_tokens  INTEGER,
  top_p              DOUBLE PRECISION,
  frequency_penalty  DOUBLE PRECISION,
  presence_penalty   DOUBLE PRECISION,
  timeout            INTEGER,
  max_tool_calls     INTEGER,
  extra_params       TEXT,
  is_default         INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT,
  updated_at         TEXT,
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_llm_configs_user_id ON llm_configs(user_id);

-- ── 会话归属 2 表 ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id               SERIAL  PRIMARY KEY,
  session_key      TEXT    NOT NULL UNIQUE,
  user_id          TEXT    NOT NULL REFERENCES users(id),
  agentic_flow_id  TEXT    NOT NULL REFERENCES agentic_flows(id),
  run_project_id   TEXT    NOT NULL REFERENCES run_projects(id),
  llm_config_id    TEXT    REFERENCES llm_configs(id),
  -- 毫秒时间戳：SQLite 是 64 位整数，PG 必须用 BIGINT（INTEGER 只有 32 位，Date.now() 越界）。
  created_at       BIGINT  NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending',
  error            TEXT,
  duration_ms      BIGINT,
  started_at       BIGINT,
  completed_at     BIGINT,
  updated_at       BIGINT,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agentic_flow_id ON sessions(agentic_flow_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_flow_user ON sessions(agentic_flow_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_run_project_id ON sessions(run_project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_llm_config_id ON sessions(llm_config_id);

CREATE TABLE IF NOT EXISTS events (
  session_id        INTEGER NOT NULL REFERENCES sessions(id),
  seq               INTEGER NOT NULL,
  agent_id          TEXT    NOT NULL,
  parent_agent_id   TEXT,
  parent_message_id INTEGER,
  is_deleted        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_parent_agent_id ON events(parent_agent_id);

-- ── 资产：技能包（正文在文件系统，本表只存元数据与安装状态）────────────────────

CREATE TABLE IF NOT EXISTS skills_packages (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    REFERENCES users(id),
  name        TEXT    NOT NULL,
  pkg_version TEXT    NOT NULL,
  description TEXT,
  icon        TEXT,
  author      TEXT    NOT NULL,
  tags        TEXT,
  folder_path TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  is_public   INTEGER NOT NULL DEFAULT 0,
  source      TEXT,
  notes       TEXT,
  created_at  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_skills_packages_user_id ON skills_packages(user_id);

-- ── 资产：MCP 服务器与两类传输子表 ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_servers (
  id             TEXT    PRIMARY KEY,
  user_id        TEXT    REFERENCES users(id),
  name           TEXT    NOT NULL,
  transport_type TEXT    NOT NULL,
  source_type    TEXT,
  description    TEXT,
  icon           TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  is_public      INTEGER NOT NULL DEFAULT 0,
  author         TEXT,
  tags           TEXT,
  tools          TEXT,
  source         TEXT,
  created_at     TEXT,
  updated_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  disabled_tools TEXT,
  -- 能力枚举缓存（PRD-05 FR-MCP-003）：resources / prompts 与 tools 同形态。
  resources      TEXT,
  prompts        TEXT,
  -- 最近一次连接测试结论（诊断列；NULL = 从未测试）。
  last_test_ok   INTEGER,
  last_test_kind TEXT,
  last_tested_at TEXT,
  -- 最近一次连接测试耗时（毫秒；NULL = 未记录）。
  last_test_ms   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
-- 服务名是全实例唯一的模型可见工具前缀；并发建行只有数据库能裁决（PRD-05 FR-MCP-002）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_servers_name ON mcp_servers(name);

CREATE TABLE IF NOT EXISTS mcp_stdio_configs (
  mcp_server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  command       TEXT,
  args          TEXT,
  env           TEXT,
  folder_path   TEXT,
  working_dir   TEXT,
  timeout       INTEGER
);

CREATE TABLE IF NOT EXISTS mcp_http_configs (
  mcp_server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  url           TEXT,
  headers       TEXT,
  timeout       INTEGER,
  session_id    TEXT
);

-- ── 资产：文件版本内容寻址存储（撤回的还原源）────────────────────────────────

CREATE TABLE IF NOT EXISTS file_content_blobs (
  content_hash  TEXT PRIMARY KEY,
  content       TEXT,
  is_large_file INTEGER NOT NULL DEFAULT 0,
  file_size     INTEGER,
  created_at    TEXT
);

-- ── 资产：文件变更台账（审阅与撤回的事实源）──────────────────────────────────

CREATE TABLE IF NOT EXISTS file_changes (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT,
  message_id          INTEGER,
  agent_id            TEXT,
  user_id             TEXT REFERENCES users(id),
  file_path           TEXT NOT NULL,
  operation           TEXT NOT NULL,
  origin              TEXT NOT NULL CHECK (origin IN ('agent', 'revert', 'user')),
  tool_call_id        TEXT,
  content_type        TEXT,
  before_content_hash TEXT,
  after_content_hash  TEXT,
  diff_data           TEXT,
  lines_added         INTEGER,
  lines_removed       INTEGER,
  hunks               TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'rejected', 'reverted')),
  created_at          TEXT,
  updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_file_changes_session_message ON file_changes(session_id, message_id);
CREATE INDEX IF NOT EXISTS idx_file_changes_file_path ON file_changes(file_path);
CREATE INDEX IF NOT EXISTS idx_file_changes_tool_call_id ON file_changes(tool_call_id);
CREATE INDEX IF NOT EXISTS idx_file_changes_origin_status ON file_changes(origin, status);
CREATE INDEX IF NOT EXISTS idx_file_changes_user_id ON file_changes(user_id);

-- ── 资产：创造模式审计 ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creator_audit (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  at         TEXT,
  user_id    TEXT REFERENCES users(id),
  ok         INTEGER NOT NULL DEFAULT 0,
  detail     TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_creator_audit_user_id ON creator_audit(user_id);
