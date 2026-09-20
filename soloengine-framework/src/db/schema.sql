-- SoloEngine 业务库 DDL（单一数据库 data/database/soloengine.db）
-- 依据《SoloEngine 持久化存储完整设计》§5、§6 与 PRD-12 FR-STO-004~007。
-- 会话运行时数据（消息正文 / 用量 / 工具调用流）不落本库：由 dsh JSONL 事件流承载。
-- 本库只承载「会话归属 2 表 + 资产 11 表」；dsh storage 机制表（u_<unit>_<table> / units /
-- unit_globals）与 session-query-sqlite 的 FTS 表由 dsh 插件同库创建（表分割）。
-- 建表顺序按外键依赖：users → agentic_flows → run_projects → llm_configs → 其余。

PRAGMA foreign_keys = ON;

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
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

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
  temperature        REAL,
  max_tokens         INTEGER,
  max_input_tokens   INTEGER,
  max_output_tokens  INTEGER,
  top_p              REAL,
  frequency_penalty  REAL,
  presence_penalty   REAL,
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

-- ── 会话归属 2 表（以 dsh SessionHeader/SessionEvent 为基准拆净重叠列）────────

CREATE TABLE IF NOT EXISTS sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key      TEXT    NOT NULL UNIQUE,
  user_id          TEXT    NOT NULL REFERENCES users(id),
  agentic_flow_id  TEXT    NOT NULL REFERENCES agentic_flows(id),
  run_project_id   TEXT    NOT NULL REFERENCES run_projects(id),
  llm_config_id    TEXT    REFERENCES llm_configs(id),
  created_at       INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending',
  error            TEXT,
  duration_ms      INTEGER,
  started_at       INTEGER,
  completed_at     INTEGER,
  updated_at       INTEGER,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agentic_flow_id ON sessions(agentic_flow_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_flow_user ON sessions(agentic_flow_id, user_id);

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
  version        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);

CREATE TABLE IF NOT EXISTS mcp_stdio_configs (
  mcp_server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id),
  command       TEXT,
  args          TEXT,
  env           TEXT,
  folder_path   TEXT,
  working_dir   TEXT
);

CREATE TABLE IF NOT EXISTS mcp_http_configs (
  mcp_server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id),
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
