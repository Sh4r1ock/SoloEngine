# Everything Search MCP Server

A Model Context Protocol (MCP) server for fast file search using Everything (Windows) with cross-platform fallbacks for macOS (Spotlight) and Linux (ripgrep/locate).

## Features

### Search Capabilities

- **Windows**: Everything CLI integration (es.exe)
  - Fast, indexed file search
  - Wildcards, operators (AND, OR, NOT)
  - Regex support
  - Sorting by name, size, date, etc.
  - File metadata retrieval
  - Automatic es.exe download during npm install

- **macOS**: Spotlight integration via mdfind
  - Native macOS search
  - File and folder search
  - Spotlight query syntax

- **Linux**: ripgrep and locate support
  - Fast search with ripgrep (preferred)
  - Fallback to locate
  - Pattern matching and regex

### Security Features

- **Input Validation**: All user inputs are validated and sanitized
- **Command Injection Protection**: Shell metacharacters are removed from queries
- **Path Traversal Protection**: Prevents access outside intended directories
- **Resource Limits**: Built-in timeouts and buffer size limits
- **Error Handling**: Secure error messages without information leakage
- **Type Safety**: Strict TypeScript types prevent runtime errors

## Installation

### Install MCP Server

```bash
npm install -g everything-search-mcp
```

Or for local development:

```bash
npm install
npm run build
npm link
```

### Platform-Specific Setup

#### Windows Users

**Automatic Setup (Recommended)**

The es.exe CLI tool is automatically downloaded during npm install:

- Supports x64, x86, and ARM64 architectures
- Downloads latest stable release from GitHub
- No manual installation required
- es.exe is stored locally in the package directory

The automatic download:
1. Detects your system architecture (x64/x86/ARM64)
2. Downloads the appropriate ES zip file from voidtools/ES releases
3. Extracts es.exe to the local bin directory
4. Cleans up the zip file

**Manual Setup (Optional)**

If you want the full Everything application for additional features:
1. Install Everything from [voidtools.com](https://www.voidtools.com/)
2. Ensure Everything is running
3. Enable "Run as administrator" for best results

**Note**: The MCP server works with just es.exe CLI tool. Installing the full Everything application is optional.

#### macOS Users

No additional installation required - Spotlight is built into macOS.

#### Linux Users

Install ripgrep for best performance:

```bash
sudo apt install ripgrep  # Ubuntu/Debian
sudo dnf install ripgrep  # Fedora
sudo pacman -S ripgrep    # Arch Linux
```

Or use locate (slower):

```bash
sudo apt install mlocate  # Ubuntu/Debian
sudo dnf install mlocate  # Fedora
sudo pacman -S mlocate    # Arch Linux
```

## Configuration

### Claude Desktop Configuration

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "everything-search": {
      "command": "everything-search-mcp",
      "args": []
    }
  }
}
```

### Advanced Configuration

The MCP server uses standard configuration and doesn't require additional environment variables. On Windows, es.exe is automatically downloaded during npm install. On Linux, ensure ripgrep/locate are installed and accessible in your system PATH.

## Usage

### Search Files

Basic search:

```json
{
  "name": "search_files",
  "arguments": {
    "query": "*.txt"
  }
}
```

Advanced search with sorting and options:

```json
{
  "name": "search_files",
  "arguments": {
    "query": "invoice AND (pdf OR docx)",
    "maxResults": 50,
    "sortBy": "date_modified",
    "sortOrder": "descending",
    "matchPath": true,
    "regex": false
  }
}
```

### Get File Info

```json
{
  "name": "get_file_info",
  "arguments": {
    "path": "C:\\Documents\\report.pdf"
  }
}
```

### Check Status

```json
{
  "name": "check_status",
  "arguments": {}
}
```

## Tool Reference

### search_files

Search for files and folders using platform's search engine.

**Parameters:**

| Parameter | Type | Required | Description | Limits |
|-----------|------|----------|-------------|---------|
| query | string | Yes | Search query. Supports wildcards (*, ?), operators (AND, OR, NOT), and regex on Windows | 1-1000 characters |
| maxResults | number | No | Maximum results to return (default: 100) | 1-1000 |
| offset | number | No | Number of results to skip (default: 0) | 0-100000 |
| sortBy | string | No | Sort field: name, path, size, extension, date_modified, date_created, attributes, run_count (Windows only) | - |
| sortOrder | string | No | Sort order: ascending or descending (Windows only) | - |
| matchPath | boolean | No | Match against full path (Windows only) | - |
| matchCase | boolean | No | Enable case-sensitive matching | - |
| matchWholeWord | boolean | No | Match whole words only (Windows only) | - |
| regex | boolean | No | Enable regex mode | - |

**Validation:**
- Empty queries are rejected
- Queries exceeding 1000 characters are rejected
- Shell metacharacters are automatically removed
- Path traversal attempts are blocked

**Response:**

```json
{
  "success": true,
  "count": 5,
  "results": [
    {
      "name": "document.txt",
      "path": "C:\\Documents",
      "fullPath": "C:\\Documents\\document.txt",
      "size": 1024,
      "modified": "2024-01-20T10:30:00.000Z",
      "created": "2024-01-15T08:00:00.000Z",
      "extension": "txt",
      "isFolder": false,
      "isFile": true
    }
  ]
}
```

### get_file_info

Get detailed metadata for a specific file or folder.

**Parameters:**

| Parameter | Type | Required | Description | Limits |
|-----------|------|----------|-------------|---------|
| path | string | Yes | Full path to file or folder | 1-4096 characters |

**Validation:**
- Empty paths are rejected
- Paths exceeding 4096 characters are rejected
- Path traversal attempts are blocked
- Shell metacharacters are rejected

**Response:**

```json
{
  "success": true,
  "info": {
    "name": "document.txt",
    "path": "C:\\Documents",
    "size": 1024,
    "created": "2024-01-15T08:00:00.000Z",
    "modified": "2024-01-20T10:30:00.000Z",
    "accessed": "2024-01-20T10:30:00.000Z",
    "attributes": 32,
    "extension": "txt",
    "isFolder": false,
    "isFile": true
  }
}
```

### check_status

Check status of search engine and platform.

**Parameters:** None

**Response:**

```json
{
  "success": true,
  "status": {
    "platform": "windows",
    "searchEngine": "Everything (es.exe CLI)",
    "available": true,
    "version": "1.1.0.36",
    "message": "Everything command-line interface available"
  }
}
```

## Platform-Specific Features

### Windows (Everything)

**Automatic es.exe Download:**

During `npm install`, the package automatically:
1. Detects system architecture (x64, x86, or ARM64)
2. Downloads the latest ES release from GitHub
3. Extracts es.exe to the local bin directory
4. Stores es.exe alongside the package

This eliminates the need to manually install Everything or configure es.exe.

**Query Operators:**
- `AND` - Both terms must match
- `OR` - Either term can match
- `NOT` - Exclude term
- `""` - Exact phrase
- `*` - Wildcard for multiple characters
- `?` - Wildcard for single character

**Examples:**
- `*.txt` - All .txt files
- `invoice AND pdf` - Files containing both "invoice" and "pdf"
- `report NOT draft` - Files with "report" but not "draft"
- `"my document".pdf` - Exact phrase with .pdf extension

### macOS (Spotlight)

**Query Syntax:**
- Basic text search
- `kind:pdf` - File type filter
- `date:today` - Date filter
- `name:document` - Name search

**Examples:**
- `document` - Search for "document"
- `kind:pdf document` - PDF files with "document"
- `date:today` - Modified today

### Linux (ripgrep/locate)

**Query Syntax:**
- Basic pattern matching
- Regex supported
- Case-insensitive by default

**Examples:**
- `document` - Search for "document"
- `\.txt$` - Regex for .txt files
- `invoice.*pdf` - Regex pattern

## Security

### Overview

This MCP server implements comprehensive security measures to protect against common vulnerabilities:
- **Command Injection Protection**: All user inputs are sanitized to remove shell metacharacters (`;`, `&`, `|`, `$`, `(`, `)`, `` ` ``, `~`)
- **Path Traversal Protection**: Detects and blocks `..` sequences and home directory access (`~`)
- **Input Validation**: Strict validation of query length (max 1000 chars), path length (max 4096 chars), and parameter bounds
- **Resource Limits**: Command timeouts (30 seconds) and buffer size limits (50MB) prevent DoS attacks
- **Error Handling**: Secure error messages that don't leak system information
- **Type Safety**: TypeScript strict mode prevents type-related vulnerabilities

### Security Testing

All security measures are validated by 44 automated tests:
- **22 Security Tests**: Input validation, sanitization, and protection mechanisms
- **22 Integration Tests**: Real-world attack scenarios and edge cases

For detailed test results, see [TEST_RESULTS.md](TEST_RESULTS.md).

### Best Practices

When using this MCP server:

1. **Use Specific Queries**: Narrow searches to specific file patterns instead of wildcards
2. **Set Reasonable Limits**: Keep `maxResults` under 100 for typical use cases
3. **Validate Results**: Always verify file paths before accessing files
4. **Monitor Logs**: Check server logs for validation errors and security warnings

## Troubleshooting

### Windows

**Error: "es.exe not found"**

The es.exe CLI tool should be automatically downloaded during npm install. If you see this error:

1. Run the download script manually:
   ```bash
   node node_modules/everything-search-mcp/scripts/download-es.js
   ```
2. Check that you have internet connectivity to download from GitHub
3. Verify npm install completed successfully
4. Try reinstalling the package:
   ```bash
   npm uninstall everything-search-mcp
   npm install -g everything-search-mcp
   ```

**Download Fails During npm install**

If the automatic download fails:
1. Check your internet connection
2. Ensure GitHub is accessible from your network
3. Manually download es.exe from https://github.com/voidtools/ES/releases
4. Place es.exe in the package's `bin/` directory

**Search Returns No Results**

1. Ensure Everything (full application) is running and has indexed files
2. Run Everything and let it complete indexing
3. Check file paths are accessible
4. Try a broader search query

### macOS

**Error: "mdfind command not found"**
- This should not happen as mdfind is built into macOS
- Check that Spotlight is enabled in System Settings

### Linux

**Error: "Neither ripgrep nor locate found"**
- Install ripgrep for best performance:
  ```bash
  sudo apt install ripgrep
  ```
- Or install locate as a fallback:
  ```bash
  sudo apt install mlocate
  sudo updatedb
  ```

## Development

### Building

```bash
npm run build
```

### Running in Development

```bash
npm run dev
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- tests/security.test.ts
npm test -- tests/integration.test.ts
```

**Test Coverage:**
- 44 automated tests covering security, validation, and edge cases
- See [TEST_RESULTS.md](TEST_RESULTS.md) for detailed test results
- See [MANUAL_TESTING_GUIDE.md](MANUAL_TESTING_GUIDE.md) for manual testing procedures

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Acknowledgments

- Everything search by voidtools.com
- Model Context Protocol by Anthropic
