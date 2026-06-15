# -*- coding: utf-8 -*-
import os
import hashlib
import difflib
import fnmatch
from typing import Dict, List, Tuple

TEXT_EXTENSIONS = frozenset({
    '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.scss',
    '.json', '.yaml', '.yml', '.md', '.txt', '.sh', '.bat', '.xml',
    '.sql', '.env', '.toml', '.ini', '.cfg', '.conf', '.csv', '.log',
    '.rs', '.go', '.java', '.c', '.cpp', '.h', '.rb', '.php',
    '.swift', '.kt', '.svg', '.vue', '.svelte', '.astro',
})

IGNORE_PATTERNS = [
    '__pycache__', '.git', '.svn', '.hg', 'node_modules',
    '.venv', 'venv', '.env', '.tox', '.mypy_cache',
    '.pytest_cache', '.ruff_cache', 'dist', 'build',
    '.next', '.nuxt', '.cache', '*.pyc', '*.pyo',
    '.DS_Store', 'Thumbs.db', '*.egg-info',
    '.idea', '.vscode', 'target', 'vendor', 'Pods',
    '.gradle', '.dart_tool', '*.lock', 'uv.lock',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]

_file_hash_cache: Dict[str, Tuple[str, float, int]] = {}


def normalize_file_path(file_path: str, working_dir: str) -> str:
    if os.path.isabs(file_path):
        return os.path.relpath(file_path, working_dir).replace('\\', '/')
    return os.path.normpath(file_path).replace('\\', '/')


def get_content_type(file_path: str) -> str:
    _, ext = os.path.splitext(file_path)
    return "text" if ext.lower() in TEXT_EXTENSIONS else "binary"


def compute_file_hash(file_path: str, algorithm: str = 'md5') -> str:
    h = hashlib.new(algorithm)
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def compute_file_hash_cached(file_path: str, algorithm: str = 'md5') -> str:
    stat = os.stat(file_path)
    mtime = stat.st_mtime
    size = stat.st_size
    cached = _file_hash_cache.get(file_path)
    if cached and cached[1] == mtime and cached[2] == size:
        return cached[0]
    file_hash = compute_file_hash(file_path, algorithm)
    _file_hash_cache[file_path] = (file_hash, mtime, size)
    return file_hash


def compute_content_hash(content: bytes, algorithm: str = 'md5') -> str:
    return hashlib.new(algorithm, content).hexdigest()


def compute_text_diff(old_content: str, new_content: str, file_path: str = "") -> Dict:
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)

    if old_lines and not old_lines[-1].endswith(('\n', '\r')):
        old_lines[-1] = old_lines[-1] + '\n'
    if new_lines and not new_lines[-1].endswith(('\n', '\r')):
        new_lines[-1] = new_lines[-1] + '\n'

    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    hunks = []
    lines_added = 0
    lines_removed = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            continue
        old_chunk = old_lines[i1:i2]
        new_chunk = new_lines[j1:j2]
        if tag in ('replace', 'delete'):
            lines_removed += len(old_chunk)
        if tag in ('replace', 'insert'):
            lines_added += len(new_chunk)
        hunks.append({
            "type": tag,
            "old_start": i1 + 1,
            "old_lines": [l.rstrip('\r\n') for l in old_chunk],
            "new_start": j1 + 1,
            "new_lines": [l.rstrip('\r\n') for l in new_chunk],
        })

    return {
        "lines_added": lines_added,
        "lines_removed": lines_removed,
        "hunks": hunks,
        "is_binary": False,
        "truncated": False,
    }


def _load_gitignore_patterns(working_dir: str) -> List[str]:
    gitignore_path = os.path.join(working_dir, '.gitignore')
    patterns = []
    if os.path.isfile(gitignore_path):
        with open(gitignore_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    patterns.append(line.lstrip('/'))
    return patterns


def _should_ignore(name: str, patterns: List[str]) -> bool:
    for pattern in patterns:
        if fnmatch.fnmatch(name, pattern):
            return True
        if name == pattern:
            return True
    return False
