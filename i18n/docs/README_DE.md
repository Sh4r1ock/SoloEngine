<div align="center">

<img src="../../icon/SoloEngine.png" alt="SoloEngine" width="300"/>

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white null)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white null)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white null)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white null)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square null)](./LICENSE)

**Sprachen**: [English](../../README.md) | [简体中文](./README_CN.md) | [Español](./README_ES.md) | Deutsch | [Français](./README_FR.md)

</div>

***

## Inhaltsverzeichnis

- [Was ist SoloEngine?](#was-ist-soloengine)
- [Designphilosophie](#designphilosophie)
- [Kernfunktionen](#kernfunktionen)
- [Schnellstart](#schnellstart)
- [Systemarchitektur](#systemarchitektur)
- [Kernkonzepte](#kernkonzepte)
- [Projektstruktur](#projektstruktur)
- [Technologie-Stack](#technologie-stack)
- [Roadmap](#roadmap)
- [Mitwirkungsrichtlinien](#mitwirkungsrichtlinien)
- [Lizenz](#lizenz)

***

## Was ist SoloEngine?

SoloEngine ist ein **Open-Source Low-Code-Framework für Agentic AI**, das Entwicklern ermöglicht, komplexe KI-Agent-Workflows einfach zu erstellen, bereitzustellen und zu verwalten. Es nutzt ein visuelles Canvas-Design, unterstützt nativ die Zusammenarbeit mehrerer Agenten, Tool-Aufrufe, MCP-Protokoll-Integration sowie einen Progressive Disclosure Mechanismus für Skills.

Der Kern von SoloEngine ist eine auf dem **ReAct (Reasoning + Acting)**-Paradigma basierende intelligente Ausführungsengine, die durch eine Plugin-Architektur eine hohe Erweiterbarkeit bietet und die Integration verschiedener LLM-Anbieter und Tools unterstützt.

***

## Designphilosophie

### Kernprinzipien des Designs

| Prinzip | Beschreibung |
|------------|-----------------------------------------------------|
| **Visuelle Orchestrierung** | Drag-and-Drop-Canvas basierend auf React Flow für die intuitive Gestaltung von Multi-Agent-Kooperationsprozessen |
| **Plugin-Architektur** | Modulare Erweiterung durch abstrakte Schnittstellendefinitionen (IMemory, IToolExecutor, IMCPClient usw.) |
| **ReAct-Paradigma** | Verwendung von Reasoning + Acting-Zyklen, damit Agenten denken, handeln, beobachten und iterieren können |
| **Modell-Adapter-Schicht** | Einheitliche Adapter-Schicht, die API-Differenzen verschiedener LLM-Anbieter abstrahiert |
| **Progressive Disclosure** | Skills und Tools werden mit leichten Metadaten angezeigt, Details werden bei Bedarf geladen, um Token-Verbrauch zu optimieren |
| **Sicherheits-Sandbox** | Projektisolation, Tool-Berechtigungskontrolle, Befehlssicherheitsprüfung zur Gewährleistung der Ausführungssicherheit |

***

## Kernfunktionen

### 🤖 Multi-Agent-Orchestrierung

- **Visuelles Canvas**: Drag-and-Drop-Workflow-Design basierend auf React Flow
- **Flexible Agent-Konfiguration**: Unterschiedliche Agentenrollen durch verschiedene Prompts, Tools und Skills
  - **Vier voreingestellte Agententypen**:
    - **Custom (Benutzerdefiniert)**: Frei konfigurierbarer Agent als leere Vorlage
    - **Orchestrator (Koordinator)**: Koordiniert mehrere SubAgents, weist Aufgaben zu und aggregiert Ergebnisse
    - **Planner (Planer)**: Analysiert Probleme und erstellt Ausführungspläne
    - **Executor (Ausführer)**: Führt konkrete Aufgaben aus, ruft Tools und Skills auf
- **Topologische Sortierungskompilierung**: Kompilierung von unten nach oben, automatische Auflösung von Agent-Abhängigkeiten
- **Parallele Ausführung**: Unterstützung für parallele Multi-Agent-Ausführung und Ergebnisaggregation
- **SubAgent-Delegierung**: Delegierung von Unteraufgaben an spezialisierte SubAgents über das Task-Tool

### 🔧 Reiches Tool-Ökosystem

SoloEngine verfügt über einen vollständigen Satz integrierter Tools, der Dateioperationen, Befehlsausführung, Netzwerkzugriff und mehr abdeckt:

| Tool-Kategorie | Tool-Name | Funktionsbeschreibung |
|---------|------------------|----------------------|
| **Dateioperationen** | Read | Dateiinhalt lesen, unterstützt Zeilennummernbereiche |
| <br /> | Write | Datei schreiben |
| <br /> | DeleteFile | Datei löschen |
| <br /> | LS | Verzeichnisinhalt auflisten |
| <br /> | SearchReplace | Dateiinhalt suchen und ersetzen |
| **Suche** | Grep | Reguläre Suche in Dateiinhalten |
| <br /> | Glob | Mustervergleichssuche für Dateien |
| <br /> | SearchCodebase | Semantische Code-Suche |
| **Befehle** | RunCommand | Shell-Befehle ausführen, unterstützt blockierende/nicht-blockierende Modi |
| <br /> | CheckCommandStatus | Befehlsausführungsstatus prüfen |
| <br /> | StopCommand | Laufende Befehle stoppen |
| <br /> | GetDiagnostics | Code-Diagnoseinformationen abrufen |
| **Netzwerk** | WebSearch | Websuche |
| <br /> | WebFetch | Webseiteninhalt abrufen |
| **Agent** | Skill | Skill aufrufen |
| <br /> | Task | SubAgent starten |
| <br /> | MCP | MCP-Tool aufrufen |
| **Ask** | AskUserQuestion | Benutzer fragen |
| <br /> | TodoWrite | To-Do-Elemente erstellen |

**Vier-Event-Mechanismus für Tool-Aufruf-Streaming-Ausgabe**:

SoloEngine implementiert ein vollständiges Vier-Event-Lebenszyklusmanagement für Tool-Aufrufe, um eine Echtzeitanzeige des Tool-Aufrufstatus im Frontend zu gewährleisten:

| Event | Auslösezeitpunkt | Datengehalt |
|------------------|------------|-----------------------------|
| `TOOL_CALL_START` | Wenn eine neue Tool-Aufruf-ID erkannt wird | `{id, name, status: "start"}` |
| `TOOL_CALL_ARGS` | Inkrementelle Parameterübertragung (möglicherweise mehrfach) | `{id, arguments: "..."}` |
| `TOOL_CALL_END` | Parameterübertragung abgeschlossen | `{id, status: "end"}` |
| `TOOL_CALL_RESULT` | Tool-Ausführungsergebnis zurückgegeben | `{id, result, error?}` |

**Einheitliches Frontend-Format**: Alle Ereignisse werden in das Format `{type: "tool_calls", tool_calls: [...]}` konvertiert und über WebSocket in Echtzeit übertragen.

### 🎯 Skill-System (Skills)

Skills sind wiederverwendbare KI-Fähigkeitsmodule mit einem **progressiven Offenlegungsdesign**:

```
skill-name/
├── SKILL.md          # Erforderlich: Skill-Definition und Anweisungen
├── references/       # Optional: Referenzdokumente
├── scripts/          # Optional: Hilfsskripte
├── templates/        # Optional: Vorlagendateien
└── assets/           # Optional: Ressourcendateien
```

**Progressiver Offenlegungsmechanismus**:

| Ebene | Zeitpunkt | Inhalt | Token-Verbrauch |
|-----|---------|----------------------------|------------|
| Erste Ebene | Tool Spec | name + description | ~100 Tokens |
| Zweite Ebene | Skill-Aufruf | Vollständiger SKILL.md-Inhalt + folder_path | Bei Bedarf |
| Dritte Ebene | Modellautonomie | Verschachtelte Ressourcen (references/, templates/) | Bei Bedarf |

**Skill-Bearbeitungs- und Erstellungssystem**:

SoloEngine bietet vollständige Skill-Management-Funktionen:

- **Skill erstellen**: Erstellen neuer Skill-Pakete über API oder Interface
- **SKILL.md bearbeiten**: Online-Bearbeitung von Skill-Definitionen und Anweisungen
- **Dateiverwaltung**: Verwaltung von references/-, scripts/-, templates/-, assets/-Verzeichnissen
- **Import/Export**: Unterstützung für ZIP-Format-Import/Export von Skill-Paketen
- **System-Skills**: Voreingestellte System-Skills als Referenz für Benutzer

### 🔌 MCP-Protokoll-Unterstützung

Vollständige Unterstützung des **Model Context Protocol** (von Anthropic vorgeschlagenes Modell-Kontext-Protokoll) mit einer **Host-Client-Schichtenarchitektur** und einem **progressiven Entdeckungsmodus**:

**Architekturdesign**:

```
┌─────────────────────────────────────────────────────────────┐
│                     CompiledFlow (Host-Ebene)                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           MCPHostClientManager (einheitliche Verwaltung) │   │
│  │  - Sammelt die Vereinigung aller Agent-konfigurierten mcp_servers zur Kompilierzeit │
│  │  - Einheitliche Erstellung und Registrierung von MCPClient │
│  │  - Verwaltung des Client-Lebenszyklus (Verbinden, Trennen) │
│  │  - Mehrere Agents teilen denselben Client │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        MCPTool (Tool-Ebene)                  │
│  - Einheitlicher Einstieg zum Aufrufen von MCP-Server-Tools │
│  - Progressiver Entdeckungsmodus: Discovery → Schema → Execution │
│  - Nur Server-Liste in System Prompt injizieren, keine spezifischen Tools │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       MCPClient (Client-Ebene)               │
│  - stdio: Kommunikation mit lokalem MCP-Server über Standard-Ein-/Ausgabe │
│  - SSE: Kommunikation mit Remote-Server über Server-Sent Events │
│  - HTTP: Bidirektionale Kommunikation über Streamable HTTP │
└─────────────────────────────────────────────────────────────┘
```

**Progressiver Entdeckungsmodus (drei Ebenen)**:

| Ebene | Aufrufmethode | Rückgabeinhalt | Token-Einsparung |
|----------------------|-----------------------------------------------------------------------|--------------------|----------|
| **Tier 1 - Discovery** | `MCP(server_name="github")` | Liste aller Tools des Servers (Name + Beschreibung) | Vermeidet Injektion aller Tools |
| **Tier 2 - Schema** | `MCP(server_name="github", tool_name="create_issue")` | Einzelne/批量 Tool-Details (mit Parameter-Schema) | Bei Bedarf laden |
| **Tier 3 - Execution** | `MCP(server_name="github", tool_name="create_issue", arguments={...})` | Tool-Ausführungsergebnis | Präzise Ausführung |

**MCP-Services in Python schreiben**:

SoloEngine unterstützt Benutzer beim Schreiben benutzerdefinierter MCP-Server in Python:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-custom-server")

@mcp.tool()
def my_tool(param: str) -> str:
    """Benutzerdefinierte Tool-Beschreibung"""
    return f"Verarbeitungsergebnis: {param}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

**MCP-Service-Verwaltung**:

- Unterstützung für HTTP/SSE/Stdio-Transportprotokolle
- Import von Open-Source-MCP-Server-Konfigurationen (GitHub, Filesystem, PostgreSQL usw.)
- Erstellung und Verwaltung benutzerdefinierter MCP-Server
- Online-Bearbeitung von Python-Funktionscode, automatische Kompilierung zu MCP-Server
- Testen der MCP-Server-Verbindung
- Abrufen von MCP-Server-Listen und -Ressourcen

### 💬 Ausführungspanel

- **Echtzeit-Streaming-Ausgabe**: WebSocket-Echtzeit-Übertragung von Ausführungsstatus und LLM-Antworten
- **Sitzungsverwaltung**: Unterstützung für Sitzungswechsel und Verlaufsaufzeichnungen
- **Dateibrowser**: Integrierte Projektdateiverwaltung
- **Code-Editor**: Code-Bearbeitungserfahrung basierend auf Monaco Editor
- **Aufrufaufzeichnungen**: Echtzeitanzeige von Tool-Aufrufen, Skill-Aufrufen, MCP-Aufrufstatus

### 🔌 Plugin-Architektur

Hohe Erweiterbarkeit durch abstrakte Schnittstellen:

```python
class IToolExecutor(ABC):
    """Tool-Executor-Schnittstelle"""
    async def execute(self, tool_call: dict) -> dict: ...
    def get_available_tools(self) -> List[dict]: ...

class IMCPClient(ABC):
    """MCP-Client-Schnittstelle"""
    async def connect(self) -> None: ...
    async def call_tool(self, tool_name: str, arguments: dict) -> dict: ...
```

***

## Schnellstart

### Systemanforderungen

- Python 3.11+
- Node.js 18+
- npm oder yarn

### Installationsanleitung

1. **Repository klonen**

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine
```

2. **Backend-Abhängigkeiten installieren**

```bash
cd backend
pip install -r requirements.txt
```

3. **Frontend-Abhängigkeiten installieren**

```bash
cd frontend
npm install
```

4. **Services starten**

```bash
# Backend starten (Port 8990)
cd backend
python main.py

# Frontend starten (Port 8991)
cd frontend
npm run dev
```

5. **Anwendung aufrufen**

Öffnen Sie den Browser und besuchen Sie `http://localhost:8991`

### Port-Konfiguration

| Service | Port | Beschreibung |
|------|------|-----------|
| Haupt-Backend | 8990 | FastAPI-Service |
| Frontend-Seite | 8991 | React-Entwicklungsserver |

***

## Kernkonzepte

### AgenticFlow

AgenticFlow ist das Kernkonzept von SoloEngine und repräsentiert einen vollständigen KI-Workflow. Es wird durch Canvas-JSON definiert und enthält Knoten (Agents) und Kanten (Aufrufbeziehungen).

```json
{
  "nodes": [
    {
      "id": "agent_1",
      "type": "agent",
      "data": {
        "name": "Code-Assistent",
        "agentType": "executor",
        "system_prompt": "Sie sind ein professioneller Programmierassistent...",
        "tools": ["Read", "Write", "RunCommand", "Skill", "MCP"],
        "skills": ["algorithmic-art"],
        "mcp_tools": ["github"]
      }
    }
  ],
  "edges": [
    { "source": "agent_1", "target": "agent_2" }
  ]
}
```

### Agent-Konfiguration

Die Agents in SoloEngine haben keinen wesentlichen Unterschied, **alle Agents sind identische Ausführungseinheiten**. Die sogenannten "Typen" sind nur voreingestellte unterschiedliche Konfigurationen:

| Konfigurationselement | Beschreibung |
|------------------|-----------------------|
| **system_prompt** | System-Prompt, definiert die Rolle und das Verhalten des Agents |
| **tools** | Liste verfügbarer Tools, bestimmt welche Aktionen der Agent ausführen kann |
| **skills** | Skill-Liste, bietet Fachbereichs-Kompetenzen |
| **mcp_servers** | MCP-Server-Liste, erweitert externe Tool-Fähigkeiten |
| **subagents** | Sub-Agent-Liste, ermöglicht Aufgabendelegierung |

Durch die Kombination verschiedener Konfigurationen können folgende Rollen realisiert werden:

- **Koordinator-Rolle**: Konfiguration von Task-Tools und koordinierenden Prompts
- **Planer-Rolle**: Konfiguration von planungsbezogenen Prompts
- **Ausführer-Rolle**: Konfiguration von umfangreichen Tools und Skills

***

## Systemarchitektur

### SoloAgent-Architektur – Agentic-Ausführungsarchitektur

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgenticFlow-Instanzebene                  │
│                         (run.py)                                │
│         Modell-Speicher lesen/schreiben, Session-Erstellung und Isolationsverwaltung │
├─────────────────────────────────────────────────────────────────┤
│                          Compiler-Ebene                          │
│                     (flow_compiler.py)                          │
│              Flow kompilieren und ausführen, Multi-Agent-Koordination │
├─────────────────────────────────────────────────────────────────┤
│                         SoloAgent-Ebene                          │
│                        (agent.py)                               │
│        Basierend auf ReActCore, verantwortlich für die Assemblierung verschiedener Plugins, Kompilierung zum vollständigen Agent │
├─────────────────────────────────────────────────────────────────┤
│                         ReActCore-Ebene                          │
│                      (react_core.py)                            │
│          Nur für Datenempfang und -ausführung, Kern-ReAct-Ausführungsengine │
├─────────────────────────────────────────────────────────────────┤
│                          Externe Schnittstelle                   │
│              LLM API (OpenAI / Anthropic / Ollama / Qwen)       │
└─────────────────────────────────────────────────────────────────┘
```

### Datenpersistenz

SoloEngine verwendet SQLite-Datenbank für vollständige Sitzungspersistenz:

**Sitzungsverwaltung**:

- `AgenticFlowSessionModel`: Sitzungs-Metadaten (Status, Token-Verbrauch, Ausführungsdauer)
- `SessionMessageModel`: Nachrichtenaufzeichnungen (gruppiert nach agent_id, Unterstützung für parent_agent_id zur Aufzeichnung von SubAgent-Hierarchien)

**Speicherverteilungsmechanismus**:

```python
# Speicher aus Datenbank lesen und nach agent_id verteilen
agent_memories = await load_and_distribute_memories(db, session_id, user_id)
# In CompiledFlow setzen
compiled_flow.set_agent_memories(agent_memories)
```

### Kompilierungs-Cache-Mechanismus (Compiler-Ebene)

`CompiledFlowFactory` implementiert LRU-Cache, um wiederholte Kompilierung zu vermeiden:

| Konfiguration | Standardwert | Beschreibung |
|---------------|-------|-------|
| `MAX_INSTANCES` | 100 | Maximale Cache-Instanzen |
| `CACHE_TIMEOUT` | 1800s | Cache-Timeout |

**Cache-Key-Format**: `{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}`

**Cache-Eigenschaften**:

- Automatische Bereinigung abgelaufener Instanzen
- Parallel-Ausführungssperre (jeder Flow hat eine unabhängige asyncio.Lock)
- Benutzerregistrierungsverfolgung

### Kernkomponenten-Verantwortlichkeiten

| Komponente | Datei | Verantwortung |
|------------------------|------------------------------------------------|--------------------------------------------|
| **ReActCore** | `core/react_core.py` | ReAct-Kern-Engine, verarbeitet LLM-Aufruf-Zyklen, Tool-Aufrufe, Nachrichtenformatierung |
| **SoloAgent** | `solo_agent/agent.py` | Agent-Basisklasse, assembliert Memory, Tools, MCP, Skills und andere Plugins |
| **AgenticFlowCompiler** | `solo_agent/compiler/flow_compiler.py` | Compiler, kompiliert Canvas-JSON zu ausführbaren Agent-Instanz-Bäumen |
| **ToolkitExecutor** | `plugins/tools/toolkit_executor.py` | Tool-Executor, verwaltet und führt verfügbare Tools des Agents aus |
| **MCPHostClientManager** | `solo_agent/compiler/mcp_host_client_manager.py` | MCP Host-Ebenen-Manager, einheitliche Verwaltung aller MCP-Client-Verbindungen |
| **MCPClient** | `plugins/mcp/mcp_client.py` | MCP-Client, kommuniziert mit MCP-Servern |
| **MCPTool** | `plugins/tools/agent/mcp.py` | MCP-Tool, implementiert progressiven Entdeckungsmodus (Discovery→Schema→Execution) |
| **SkillTool** | `plugins/tools/agent/skill.py` | Skill-Tool, implementiert progressive Skill-Offenlegung |

### Modelladaptionsschicht

SoloEngine unterstützt mehrere LLM-Anbieter durch eine einheitliche Modelladaptionsschicht:

```
┌─────────────────────────────────────────────────────────────┐
│                    ReActCore (einheitlicher Aufruf)          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Modelladaptionsschicht                   │
│  OpenAIModel | AnthropicModel | OllamaModel | QwenModel    │
│  DeepSeekModel | ZhipuModel                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     LLM API                                 │
│  OpenAI | Claude | Ollama Llama | Tongyi Qianwen            │
│  DeepSeek | Zhipu GLM                                       │
└─────────────────────────────────────────────────────────────┘
```

Jeder Modelladapter ist verantwortlich für:

- Einheitliche Nachrichtenformatkonvertierung
- Streaming/nicht-Streaming-Antwortverarbeitung
- Tool-Aufruf (Function Calling) Adaption
- Unterstützung spezieller Funktionen (z.B. Claude Extended Thinking)

***

## Projektstruktur

```
SoloEngine/
├── backend/                    # Backend-Code
│   ├── app/                    # FastAPI-Anwendung
│   │   ├── core/               # Kernmodule
│   │   │   ├── database.py     # Datenbankmodelle
│   │   │   ├── config.py       # Konfigurationsverwaltung
│   │   │   └── data_paths.py   # Pfadverwaltung
│   │   └── routers/            # API-Routen
│   ├── SoloAgent/              # Agent-Kern
│   │   ├── core/               # Kern-Engine
│   │   │   ├── react_core.py   # ReAct-Kernimplementierung
│   │   │   └── interfaces.py   # Plugin-Schnittstellendefinitionen
│   │   ├── model/              # LLM-Modelladaption
│   │   │   ├── openai_model.py # OpenAI-Adaption
│   │   │   ├── anthropic_model.py # Anthropic-Adaption
│   │   │   ├── ollama_model.py # Ollama-Adaption
│   │   │   └── qwen_model.py   # Tongyi Qianwen-Adaption
│   │   ├── plugins/            # Plugin-System
│   │   │   ├── tools/          # Tool-Plugins
│   │   │   │   ├── agent/      # Agent-Tools (Skill, MCP, Task)
│   │   │   │   ├── file/       # Datei-Tools (Read, Write, Delete)
│   │   │   │   ├── command/    # Befehls-Tools (RunCommand)
│   │   │   │   ├── network/    # Netzwerk-Tools (WebSearch, WebFetch)
│   │   │   │   └── search/     # Such-Tools (Grep, Glob, SearchCodebase)
│   │   │   ├── mcp/            # MCP-Client
│   │   │   │   └── mcp_client.py
│   │   │   └── memory/         # Speicher-Plugins
│   │   └── solo_agent/         # SoloAgent-Konfiguration und -Kompilierung
│   │       ├── agent.py        # Agent-Implementierung
│   │       ├── config.py       # Konfigurationsdefinition
│   │       └── compiler/       # Compiler
│   │           └── flow_compiler.py
│   └── main.py                 # Einstiegspunkt
├── frontend/                   # Frontend-Code
│   ├── src/
│   │   ├── components/         # React-Komponenten
│   │   │   ├── Canvas/         # Canvas-Komponenten
│   │   │   ├── RunPanel/       # Ausführungspanel
│   │   │   ├── Settings/       # Einstellungskomponenten
│   │   │   ├── SkillsManager/  # Skill-Verwaltung
│   │   │   └── MCPManager/     # MCP-Verwaltung
│   │   ├── pages/              # Seitenkomponenten
│   │   ├── services/           # API-Services
│   │   ├── store/              # Zustand-Status
│   │   └── hooks/              # React Hooks
│   └── package.json
├── data/                       # Datenverzeichnis
│   ├── database/               # SQLite-Datenbank
│   └── system/                 # Systemressourcen
│       ├── mcp_servers/        # System-MCP
│       └── skills/             # System-Skill
└── i18n/                       # Internationalisierungsdokumente
    └── docs/                   # Dokumentation
```

***

## Technologie-Stack

### Backend

| Technologie | Version | Verwendung |
|--------------------------------------------------|--------|----------------------|
| [Python](https://www.python.org/) | 3.11+ | Kern-Laufzeit |
| [FastAPI](https://fastapi.tiangolo.com/) | 0.115+ | Web-Framework, REST API |
| [SQLAlchemy](https://www.sqlalchemy.org/) | 2.0+ | ORM-Datenbankoperationen |
| [SQLite](https://www.sqlite.org/) | 3.x | Eingebettete Datenbank |
| [Pydantic](https://pydantic-docs.helpmanual.io/) | 2.0+ | Datenvalidierung |
| [WebSockets](https://websockets.readthedocs.io/) | 12.0+ | Echtzeitkommunikation |
| [MCP Python SDK](https://modelcontextprotocol.io/) | latest | Model Context Protocol |

### Frontend

| Technologie | Version | Verwendung |
|-----------------------------------------------------------|-------|--------|
| [React](https://reactjs.org/) | 18.2 | UI-Framework |
| [TypeScript](https://www.typescriptlang.org/) | 5.3 | Typsicherheit |
| [Vite](https://vitejs.dev/) | 5.0+ | Build-Tool |
| [React Flow](https://reactflow.dev/) | 11.x | Canvas-Visualisierung |
| [Zustand](https://zustand-demo.pmnd.rs/) | 4.x | Statusverwaltung |
| [Ant Design](https://ant.design/) | 5.x | UI-Komponentenbibliothek |
| [Tailwind CSS](https://tailwindcss.com/) | 3.x | Styling-Framework |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | 0.45+ | Code-Editor |

### Unterstützte LLM-Anbieter-Paradigmen

SoloEngine verwendet eine einheitliche Modelladaptionsschicht und unterstützt folgende Anbieter:

| Anbieter | Adaptionsmodus | Funktionsunterstützung |
|------------------------------------------|---------------|------------------------|
| [OpenAI](https://openai.com/) | Nativer SDK | Function Calling, Streaming-Ausgabe |
| [Anthropic](https://www.anthropic.com/) | Nativer SDK | Extended Thinking, Tool-Verwendung |
| [Ollama](https://ollama.ai/) | OpenAI-kompatible API | Lokale Bereitstellung, kein API Key erforderlich |
| [Alibaba Qwen](https://tongyi.aliyun.com/) | OpenAI-kompatible API | Chinesische Optimierung, langer Kontext |
| [DeepSeek](https://www.deepseek.com/) | OpenAI-kompatible API | Reasoning-Verbesserung, Code-Generierung |
| [Zhipu GLM](https://open.bigmodel.cn/) | OpenAI-kompatible API | Chinesische Optimierung, Multimodal |

***

## Roadmap

- Export-Mechanismus und One-Click-Packaging
- Integration externer APIs wie Feishu, Telegram usw.
- Gleichberechtigter Agent-Mechanismus
- i18n-Multilingual-Anpassung
- Dunkelmodus
- Agentic AI-Operations-Follow-up

***

## 🤝 Kooperation & Investition

SoloEngine befindet sich in einer Phase der schnellen Entwicklung. Wir sind bestrebt, eine Open-Source, offene und leistungsstarke Low-Code-Agentic AI-Entwicklungsplattform zu schaffen. Wir glauben, dass KI-Agent-Technologie die zukünftige Arbeitsweise tiefgreifend verändern wird, und SoloEngine wird ein wichtiger Treiber dieser Transformation sein.

### Wonach wir suchen

| Kooperationsrichtung | Beschreibung |
|--------------|--------------------------------|
| **Technologiepartner** | Gemeinsame Entwicklung von Kernfunktionen, Erkundung der Grenzen der Agent-Technologie |
| **Produktkooperation** | Integration von SoloEngine in Ihr Produkt, gemeinsame Entwicklung branchenspezifischer Lösungen |
| **Ökosystem-Aufbau** | Entwicklung von Plugins, Skills, MCP-Services zur Bereicherung des Ökosystems |

### Kontakt

Wenn Sie an SoloEngine interessiert sind, kontaktieren Sie uns gerne auf folgende Weise:

- 📧 **E-Mail**: <sh4r1ock@qq.com>
- 🐙 **GitHub Issues**: [Issue einreichen](https://github.com/Sh4r1ock/SoloEngine/issues)

> **Wir freuen uns darauf, mit Ihnen zusammenzuarbeiten, um die Verbesserung und Entwicklung von SoloEngine gemeinsam voranzutreiben!**

***

## Mitwirkungsrichtlinien

Wir begrüßen alle Formen der Mitarbeit!

### Entwicklungsumgebung einrichten

1. Dieses Repository forken
2. Feature-Branch erstellen: `git checkout -b feature/your-feature`
3. Abhängigkeiten installieren: `pip install -r backend/requirements.txt`

### Code-Standards

- Python: Befolgen Sie PEP 8, verwenden Sie Black zur Formatierung
- TypeScript: Verwenden Sie ESLint + Prettier
- Commit-Nachrichten: Befolgen Sie Conventional Commits

### PR einreichen

1. Stellen Sie sicher, dass alle Tests bestanden sind
2. Aktualisieren Sie die relevante Dokumentation
3. Pull Request einreichen

***

## Lizenz

Copyright 2026 Sh4rlock

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Siehe [LICENSE](../../LICENSE) Datei.

***

## Danksagung

Die Entwicklung von SoloEngine profitiert von folgenden Open-Source-Projekten:

- [FastAPI](https://fastapi.tiangolo.com/) - Modernes, leistungsstarkes Python-Web-Framework
- [React](https://reactjs.org/) - JavaScript-Bibliothek zum Erstellen von Benutzeroberflächen
- [React Flow](https://reactflow.dev/) - Für den Aufbau interaktiver Diagramme und Flussdiagramme
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Code-Editor von VS Code
- [Model Context Protocol](https://modelcontextprotocol.io/) - Anthropics Modell-Kontext-Protokoll
- [Tailwind CSS](https://tailwindcss.com/) - Utility-First CSS-Framework

***

<div align="center">

**Made with ❤️ by SoloEngine Team**

</div>
