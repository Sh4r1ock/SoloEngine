# SQLite MCP Server

A comprehensive Model Context Protocol (MCP) server implementation for SQLite databases, providing secure and controlled access to SQLite operations through a standardized interface.

[![npm version](https://badge.fury.io/js/%40berthojoris%2Fmcp-sqlite-server.svg)](https://www.npmjs.com/package/@berthojoris/mcp-sqlite-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 📋 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Installation](#-installation)
- [Integration Guide](#-integration-guide)
  - [Claude Desktop](#claude-desktop)
  - [Cursor IDE](#cursor-ide)
  - [Continue.dev](#continuedev)
  - [Other MCP Clients](#other-mcp-clients)
- [Available Tools (28 Tools)](#-available-tools)
- [Tool Documentation](DOCUMENTATIONS.md)
- [Permission System](#permission-system)
- [Configuration](#-configuration)
- [Security Guidelines](#-security-guidelines)

## ⚡ Quick Start

Get up and running in 30 seconds:

```bash
# Run directly with npx (no installation required)
npx @berthojoris/mcp-sqlite-server sqlite:////path/to/database.sqlite list,read,create,update,delete
```

Or add to your MCP client configuration:

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@berthojoris/mcp-sqlite-server", "sqlite:////path/to/db.sqlite", "list,read,create,update,delete"]
    }
  }
}
```

## 🚀 Features

### Core Functionality
- **MCP Protocol Compliance**: Full implementation of the Model Context Protocol for seamless integration with MCP clients
- **SQLite Integration**: Native SQLite support using `better-sqlite3` for optimal performance
- **Granular Permissions**: Fine-grained permission system with 10 distinct permission types
- **Security First**: Comprehensive SQL injection protection and query validation
- **Schema Introspection**: Complete database schema analysis and reporting
- **Connection Pooling**: Efficient database connection management
- **Audit Logging**: Detailed operation logging for security and compliance

### Permission System
The server implements a granular permission system with the following types:

- `list` - List tables and schemas
- `read` - SELECT queries and data retrieval
- `create` - INSERT operations
- `update` - UPDATE operations  
- `delete` - DELETE operations
- `execute` - Execute stored procedures/functions
- `ddl` - Data Definition Language (CREATE, ALTER, DROP)
- `procedure` - Stored procedures (N/A for SQLite - reserved for compatibility)
- `transaction` - Transaction control (BEGIN, COMMIT, ROLLBACK)
- `utility` - Utility operations (VACUUM, ANALYZE, PRAGMA, etc.)

### Security Features
- **SQL Injection Prevention**: Parameterized queries and pattern detection
- **Query Validation**: Comprehensive query analysis and sanitization
- **Permission Enforcement**: Operation-level permission checking
- **Rate Limiting**: Configurable request rate limiting
- **Audit Trail**: Complete operation logging with client tracking
- **Input Sanitization**: Parameter validation and sanitization

### Auto-Creation Features
- **Database Auto-Creation**: Automatically creates database files if they don't exist
- **Directory Auto-Creation**: Creates parent directories recursively as needed
- **Intelligent Initialization**: Detects new vs existing databases and logs appropriately
- **Zero-Configuration Setup**: Works out-of-the-box with any valid SQLite path

## 📦 Installation

### NPX Usage (Recommended)
```bash
npx @berthojoris/mcp-sqlite-server sqlite:////path/to/your/database.sqlite list,read,utility
```

### Global Installation
```bash
npm install -g @berthojoris/mcp-sqlite-server
mcp-sqlite-server sqlite:////path/to/your/database.sqlite list,read,create,update
```

### Local Installation
```bash
npm install @berthojoris/mcp-sqlite-server
```

## 🔗 Integration Guide

### Standard MCP Configuration

Add this configuration to your MCP client's config file:

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": [
        "-y",
        "@berthojoris/mcp-sqlite-server",
        "sqlite:////path/to/database.sqlite",
        "list,read,create,update,delete,utility"
      ]
    }
  }
}
```

**Arguments Explained:**
| # | Argument | Description |
|---|----------|-------------|
| 1 | `-y` | Auto-confirm npx installation |
| 2 | `@berthojoris/mcp-sqlite-server` | Package name |
| 3 | `sqlite:////path/to/database.sqlite` | Database connection string |
| 4 | `list,read,create,update,delete,utility` | Comma-separated permissions |

### Config File Locations by Client

| Client | Config File Location |
|--------|---------------------|
| **Claude Desktop (macOS)** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop (Windows)** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Desktop (Linux)** | `~/.config/Claude/claude_desktop_config.json` |
| **Cursor IDE (macOS/Linux)** | `~/.cursor/mcp.json` |
| **Cursor IDE (Windows)** | `%USERPROFILE%\.cursor\mcp.json` |
| **Windsurf IDE** | `~/.windsurf/mcp.json` |
| **Cline (VS Code)** | VS Code `settings.json` under `cline.mcpServers` |

### Platform-Specific Path Examples

```bash
# macOS/Linux
"sqlite:////Users/yourname/databases/app.sqlite"
"sqlite:////home/user/projects/data.sqlite"

# Windows
"sqlite:///C:/Users/yourname/databases/app.sqlite"

# Relative path (from working directory)
"sqlite://./data/app.sqlite"

# In-memory database
"sqlite://:memory:"
```

### Multiple Databases

```json
{
  "mcpServers": {
    "main-db": {
      "command": "npx",
      "args": ["-y", "@berthojoris/mcp-sqlite-server", "sqlite:////path/to/main.sqlite", "list,read,create,update,delete"]
    },
    "analytics-db": {
      "command": "npx",
      "args": ["-y", "@berthojoris/mcp-sqlite-server", "sqlite:////path/to/analytics.sqlite", "list,read"]
    }
  }
}
```

## 🔧 Configuration

### Connection String Formats
The server supports multiple SQLite connection string formats:

```bash
# Absolute path
sqlite:////absolute/path/to/database.sqlite

# Relative path  
sqlite://./relative/path/to/database.sqlite

# In-memory database
sqlite://:memory:

# Direct file path
/path/to/database.sqlite
```

### Permission Combinations

#### Detailed Permission Descriptions

<table>
<thead>
<tr>
<th>Permission</th>
<th>Description</th>
<th>Allowed Operations</th>
<th>Example Use Cases</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>list</code></td>
<td>View database structure and metadata</td>
<td>
• List all tables<br>
• View table schemas<br>
• Check column information<br>
• View indexes and constraints<br>
• Access database metadata
</td>
<td>
• Database exploration<br>
• Schema documentation<br>
• Development planning<br>
• Data modeling
</td>
</tr>
<tr>
<td><code>read</code></td>
<td>Execute SELECT queries and retrieve data</td>
<td>
• SELECT statements<br>
• JOIN operations<br>
• Aggregate functions (COUNT, SUM, etc.)<br>
• Subqueries<br>
• View data content
</td>
<td>
• Data analysis<br>
• Reporting<br>
• Business intelligence<br>
• Read-only applications
</td>
</tr>
<tr>
<td><code>create</code></td>
<td>Insert new records into tables</td>
<td>
• INSERT statements<br>
• Bulk insert operations<br>
• Add new rows<br>
• Populate tables with data
</td>
<td>
• Data entry applications<br>
• ETL processes<br>
• User registration<br>
• Content creation
</td>
</tr>
<tr>
<td><code>update</code></td>
<td>Modify existing records</td>
<td>
• UPDATE statements<br>
• Bulk update operations<br>
• Modify existing data<br>
• Change field values
</td>
<td>
• Profile updates<br>
• Status changes<br>
• Data corrections<br>
• Content editing
</td>
</tr>
<tr>
<td><code>delete</code></td>
<td>Remove records from tables</td>
<td>
• DELETE statements<br>
• Bulk delete operations<br>
• Remove rows<br>
• Data cleanup
</td>
<td>
• User account deletion<br>
• Data archiving<br>
• Content removal<br>
• Cleanup operations
</td>
</tr>
<tr>
<td><code>execute</code></td>
<td>Run stored procedures and functions</td>
<td>
• Execute stored procedures<br>
• Call database functions<br>
• Run custom database logic<br>
• Execute complex operations
</td>
<td>
• Business logic execution<br>
• Complex calculations<br>
• Batch processing<br>
• Custom workflows
</td>
</tr>
<tr>
<td><code>ddl</code></td>
<td>Modify database structure</td>
<td>
• CREATE TABLE/INDEX<br>
• ALTER TABLE structure<br>
• DROP tables/indexes<br>
• Modify schema<br>
• Create/drop views
</td>
<td>
• Database migrations<br>
• Schema updates<br>
• Development setup<br>
• Structure modifications
</td>
</tr>
<tr>
<td><code>transaction</code></td>
<td>Control transaction boundaries</td>
<td>
• BEGIN transactions<br>
• COMMIT changes<br>
• ROLLBACK operations<br>
• Manage data consistency<br>
• Atomic operations
</td>
<td>
• Financial operations<br>
• Data integrity<br>
• Batch processing<br>
• Critical updates
</td>
</tr>
<tr>
<td><code>utility</code></td>
<td>Perform maintenance and optimization</td>
<td>
• VACUUM database<br>
• ANALYZE statistics<br>
• PRAGMA commands<br>
• Database backup<br>
• Performance optimization
</td>
<td>
• Database maintenance<br>
• Performance tuning<br>
• Backup operations<br>
• System administration
</td>
</tr>
</tbody>
</table>

#### Common permission combinations for different use cases:

```bash
# Read-only access
list,read

# Basic CRUD operations
list,read,create,update,delete

# Full database access
list,read,create,update,delete,execute,ddl,transaction,utility

# Analytics/reporting
list,read,utility

# Development/testing
list,read,create,update,delete,ddl,transaction,utility
```

## 🔌 Available Tools

The MCP server provides **28 powerful tools** for comprehensive SQLite database management:

### Tools Summary

| # | Tool | Description | Permission |
|---|------|-------------|------------|
| 1 | [`sqlite_query`](#sqlite_query) | Execute SELECT queries with parameterized support | `read` |
| 2 | [`sqlite_insert`](#sqlite_insert) | Insert single records into tables | `create` |
| 3 | [`sqlite_update`](#sqlite_update) | Update existing records | `update` |
| 4 | [`sqlite_delete`](#sqlite_delete) | Delete records from tables | `delete` |
| 5 | [`sqlite_schema`](#sqlite_schema) | Get comprehensive schema information | `list` |
| 6 | [`sqlite_tables`](#sqlite_tables) | List all tables in database | `list` |
| 7 | [`sqlite_relations`](#sqlite_relations) | Analyze table relationships and foreign keys | `list` |
| 8 | [`sqlite_transaction`](#sqlite_transaction) | Execute multiple queries atomically | `transaction` |
| 9 | [`sqlite_backup`](#sqlite_backup) | Create database backup | `utility` |
| 10 | [`sqlite_bulk_insert`](#sqlite_bulk_insert) | Bulk insert with relational support | `create` |
| 11 | [`sqlite_bulk_update`](#sqlite_bulk_update) | Bulk update with progress tracking | `update` |
| 12 | [`sqlite_bulk_delete`](#sqlite_bulk_delete) | Bulk delete with cascade support | `delete` |
| 13 | [`sqlite_ddl`](#sqlite_ddl) | Schema management (CREATE/ALTER/DROP) | `ddl` |
| 14 | [`sqlite_views`](#sqlite_views) | Create and manage database views | `ddl` |
| 15 | [`sqlite_indexes`](#sqlite_indexes) | Index management and optimization | `list`, `ddl` |
| 16 | [`sqlite_constraints`](#sqlite_constraints) | View constraints and foreign keys | `list` |
| 17 | [`sqlite_migrate`](#sqlite_migrate) | Data migration between tables | `read`, `create`, `update` |
| 18 | [`sqlite_backup_restore`](#sqlite_backup_restore) | Backup tables and restore from SQL | `utility`, `read`, `ddl` |
| 19 | [`sqlite_column_statistics`](#sqlite_column_statistics) | Column statistics and data profiling | `read` |
| 20 | [`sqlite_database_summary`](#sqlite_database_summary) | Database summary and metadata | `read` |
| 21 | [`sqlite_schema_erd`](#sqlite_schema_erd) | Entity relationship diagram data | `read` |
| 22 | [`sqlite_schema_rag_context`](#sqlite_schema_rag_context) | RAG context for AI models | `read` |
| 23 | [`sqlite_analyze_query`](#sqlite_analyze_query) | Query analysis and execution plans | `read` |
| 24 | [`sqlite_optimization_hints`](#sqlite_optimization_hints) | Query optimization suggestions | `read` |
| 25 | [`sqlite_database_health_check`](#sqlite_database_health_check) | Database health and integrity checks | `read` |
| 26 | [`sqlite_unused_indexes`](#sqlite_unused_indexes) | Find unused or redundant indexes | `read` |
| 27 | [`sqlite_connection_pool_stats`](#sqlite_connection_pool_stats) | Connection pool statistics | `read` |

### Tool Categories

**Data Query & Retrieval:**
- `sqlite_query` - Run SELECT statements
- `sqlite_schema` - Inspect database structure
- `sqlite_tables` - List available tables
- `sqlite_relations` - Analyze table relationships and foreign keys

**Data Manipulation (CRUD):**
- `sqlite_insert` - Create new records
- `sqlite_update` - Modify existing records
- `sqlite_delete` - Remove records

**Bulk Operations:**
- `sqlite_bulk_insert` - Insert many records efficiently
- `sqlite_bulk_update` - Update many records at once
- `sqlite_bulk_delete` - Delete many records with cascade support

**Schema Management:**
- `sqlite_ddl` - CREATE/ALTER/DROP tables and indexes
- `sqlite_views` - Create, drop, and manage database views
- `sqlite_indexes` - Index management and optimization

**Constraints & Relationships:**
- `sqlite_constraints` - View and analyze constraints and foreign keys

**Data Migration:**
- `sqlite_migrate` - Clone tables, compare structures, and copy data

**Database Operations:**
- `sqlite_transaction` - Atomic multi-query execution
- `sqlite_backup` - Database backup utility
- `sqlite_backup_restore` - Backup tables and restore from SQL files

> 📖 **Full Documentation:** See [DOCUMENTATIONS.md](DOCUMENTATIONS.md) for detailed parameters, examples, and response formats for each tool.

## 🔒 Security Guidelines

### Best Practices
1. **Principle of Least Privilege**: Only grant necessary permissions
2. **Use Parameterized Queries**: Always use parameters for dynamic values
3. **Regular Backups**: Implement automated backup strategies
4. **Monitor Audit Logs**: Review operation logs regularly
5. **Connection Limits**: Set appropriate connection pool limits
6. **Read-Only When Possible**: Use read-only mode for reporting/analytics

### Security Features
- **SQL Injection Protection**: Automatic detection of dangerous patterns
- **Query Validation**: Comprehensive query analysis before execution
- **Permission Enforcement**: Operation-level access control
- **Rate Limiting**: Configurable request throttling
- **Audit Logging**: Complete operation tracking
- **Input Sanitization**: Parameter validation and cleaning

### Dangerous Operations
The server automatically blocks or restricts:
- Multiple statement execution
- Dangerous SQL patterns (UNION-based injections, etc.)
- Unauthorized schema modifications
- Excessive query complexity
- Operations without proper permissions

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues, questions, or contributions:
- GitHub Issues: [Repository Issues](https://github.com/berthojoris/mcp-sqlite-server/issues)
- Documentation: [Full Documentation](https://github.com/berthojoris/mcp-sqlite-server/wiki)

**Note**: This server is designed for secure, controlled access to SQLite databases through the Model Context Protocol. Always follow security best practices and regularly review audit logs in production environments.

---

**Last Updated**: 2025-12-20 20:00:00
