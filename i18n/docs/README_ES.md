<div align="center">

<img src="../../icon/SoloEngine.png" alt="SoloEngine" width="300"/>

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](./LICENSE)

**Idiomas**: [English](../../README.md) | [简体中文](./README_CN.md) | Español | [Deutsch](./README_DE.md) | [Français](./README_FR.md)

</div>

***

## Tabla de Contenidos

- [¿Qué es SoloEngine?](#qué-es-soloengine)
- [Filosofía de Diseño](#filosofía-de-diseño)
- [Funcionalidades Principales](#funcionalidades-principales)
- [Inicio Rápido](#inicio-rápido)
- [Arquitectura del Sistema](#arquitectura-del-sistema)
- [Conceptos Fundamentales](#conceptos-fundamentales)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Stack Tecnológico](#stack-tecnológico)
- [Hoja de Ruta](#hoja-de-ruta)
- [Guía de Contribución](#guía-de-contribución)
- [Licencia](#licencia)

***

## ¿Qué es SoloEngine?

SoloEngine es un **framework de desarrollo Agentic AI de código abierto low-code**, diseñado para permitir a los desarrolladores construir, desplegar y gestionar flujos de trabajo complejos de Agentes de IA con facilidad. Adopta un diseño de lienzo visual, con soporte nativo para la colaboración multi-Agente, invocación de herramientas, integración del protocolo MCP y un mecanismo de revelación progresiva de Skills.

El núcleo de SoloEngine es un motor de ejecución de agentes inteligentes basado en el paradigma **ReAct (Reasoning + Acting)**, que logra una alta extensibilidad a través de una arquitectura de plugins, soportando múltiples proveedores de LLM (Large Language Model) e integración de herramientas.

***

## Filosofía de Diseño

### Principios de Diseño Fundamentales

| Principio | Descripción |
| --------- | ----------- |
| **Orquestación Visual** | Lienzo de arrastrar y soltar basado en React Flow, para diseñar intuitivamente flujos de colaboración multi-Agente |
| **Arquitectura de Plugins** | Extensión modular mediante interfaces abstractas (IMemory, IToolExecutor, IMCPClient, etc.) |
| **Paradigma ReAct** | Ciclo Reasoning + Acting que permite al Agente pensar, actuar, observar e iterar |
| **Unificación Multi-Modelo** | Capa de adaptación de modelos unificada que oculta las diferencias de API entre diferentes proveedores de LLM |
| **Revelación Progresiva** | Los Skills y herramientas utilizan metadatos ligeros para su presentación, con detalles cargados bajo demanda, optimizando el consumo de tokens |
| **Sandbox Seguro** | Aislamiento de proyectos, control de permisos de herramientas, verificación de seguridad de comandos |

***

## Funcionalidades Principales

### 🤖 Orquestación Multi-Agente

- **Lienzo Visual**: Diseño de flujos de trabajo de arrastrar y soltar basado en React Flow
- **Configuración Flexible de Agentes**: Diferentes roles de Agente mediante la configuración de diferentes prompts, herramientas y Skills
  - **Cuatro Tipos de Agentes Predefinidos**:
    - **Custom (Personalizado)**: Agente configurado libremente por el usuario, utilizado como plantilla en blanco
    - **Orchestrator (Coordinador)**: Coordina múltiples SubAgentes, asigna tareas y agrega resultados
    - **Planner (Planificador)**: Analiza problemas y formula planes de ejecución
    - **Executor (Ejecutor)**: Ejecuta tareas específicas, invoca herramientas y Skills
- **Compilación con Ordenamiento Topológico**: Compilación de abajo hacia arriba, resolviendo automáticamente las dependencias entre Agentes
- **Ejecución Concurrente**: Soporte para ejecución paralela multi-Agente y agregación de resultados
- **Delegación de SubAgentes**: Delegación de subtareas a SubAgentes especializados mediante la herramienta Task

### 🔧 Rico Ecosistema de Herramientas

SoloEngine incluye un conjunto completo de herramientas, cubriendo escenarios de operación de archivos, ejecución de comandos, acceso a redes, etc.:

| Categoría de Herramienta | Nombre de Herramienta | Descripción de Función |
| ------------------------ | --------------------- | ---------------------- |
| **Operaciones de Archivo** | Read | Leer contenido de archivos, soporta rango de números de línea |
| <br /> | Write | Escribir archivos |
| <br /> | DeleteFile | Eliminar archivos |
| <br /> | LS | Listar contenido de directorios |
| <br /> | SearchReplace | Buscar y reemplazar contenido de archivos |
| **Búsqueda** | Grep | Búsqueda de expresiones regulares en contenido de archivos |
| <br /> | Glob | Búsqueda de archivos por patrón |
| <br /> | SearchCodebase | Búsqueda semántica de código |
| **Comandos** | RunCommand | Ejecutar comandos Shell, soporta modo bloqueante/no bloqueante |
| <br /> | CheckCommandStatus | Verificar estado de ejecución de comandos |
| <br /> | StopCommand | Detener comandos en ejecución |
| <br /> | GetDiagnostics | Obtener información de diagnóstico de código |
| **Red** | WebSearch | Búsqueda en red |
| <br /> | WebFetch | Capturar contenido de páginas web |
| **Agente** | Skill | Invocar Skill |
| <br /> | Task | Iniciar SubAgente |
| <br /> | MCP | Invocar herramienta MCP |
| **Ask** | AskUserQuestion | Hacer preguntas al usuario |
| <br /> | TodoWrite | Crear elementos de tareas pendientes |

**Mecanismo de Cuatro Eventos de Salida en Streaming de Invocación de Herramientas**:

SoloEngine implementa una gestión completa del ciclo de vida de cuatro eventos de invocación de herramientas, asegurando que el frontend muestre el estado de invocación de herramientas en tiempo real:

| Evento | Momento de Disparo | Contenido de Datos |
| ------ | ------------------ | ------------------ |
| `TOOL_CALL_START` | Cuando se detecta un nuevo ID de invocación de herramienta | `{id, name, status: "start"}` |
| `TOOL_CALL_ARGS` | Transmisión incremental de parámetros (posiblemente múltiples veces) | `{id, arguments: "..."}` |
| `TOOL_CALL_END` | Transmisión de parámetros completada | `{id, status: "end"}` |
| `TOOL_CALL_RESULT` | Retorno del resultado de ejecución de la herramienta | `{id, result, error?}` |

**Formato Unificado Frontend**: Todos los eventos se convierten al formato `{type: "tool_calls", tool_calls: [...]}`, enviados en tiempo real a través de WebSocket.

### 🎯 Sistema de Skills

Los Skills son módulos de capacidad de IA reutilizables, con un diseño de **revelación progresiva**:

```
skill-name/
├── SKILL.md          # Requerido: Definición e instrucciones del Skill
├── references/       # Opcional: Documentación de referencia
├── scripts/          # Opcional: Scripts auxiliares
├── templates/        # Opcional: Archivos de plantilla
└── assets/           # Opcional: Archivos de recursos
```

**Mecanismo de Revelación Progresiva**:

| Nivel | Momento | Contenido | Consumo de tokens |
| ----- | ------- | --------- | ----------------- |
| Primer Nivel | Tool Spec | name + description | ~100 tokens |
| Segundo Nivel | Invocación de Skill | Contenido completo de SKILL.md + folder_path | Bajo demanda |
| Tercer Nivel | Autonomía del modelo | Recursos anidados (references/, templates/) | Bajo demanda |

**Sistema de Edición y Creación de Skills**:

SoloEngine proporciona funcionalidades completas de gestión de Skills:

- **Crear Skill**: Crear nuevos paquetes de Skill a través de API o interfaz
- **Editar SKILL.md**: Edición en línea de definiciones e instrucciones de Skill
- **Gestión de Archivos**: Gestión de directorios references/, scripts/, templates/, assets/
- **Importar/Exportar**: Soporte para importar/exportar paquetes de Skill en formato ZIP
- **System Skills**: Skills predefinidos a nivel de sistema para referencia y aprendizaje

### 🔌 Soporte de Protocolo MCP

Soporte completo para **Model Context Protocol** (protocolo de contexto de modelo propuesto por Anthropic), adoptando una **arquitectura en capas Host-Cliente** y un **modo de descubrimiento progresivo**:

**Diseño de Arquitectura**:

```
┌─────────────────────────────────────────────────────────────┐
│                     CompiledFlow (Capa Host)                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           MCPHostClientManager (Gestión Unificada)  │   │
│  │  - Recopilar la unión de mcp_servers configurados   │   │
│  │    por todos los Agentes en tiempo de compilación   │   │
│  │  - Crear y registrar MCPClient de forma unificada   │   │
│  │  - Gestionar el ciclo de vida del Client            │   │
│  │    (conexión, desconexión)                          │   │
│  │  - Múltiples Agentes comparten el mismo Client      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        MCPTool (Capa de Herramientas)       │
│  - Punto de entrada unificado para invocar herramientas     │
│    del servidor MCP                                         │
│  - Modo de descubrimiento progresivo:                       │
│    Discovery → Schema → Execution                           │
│  - Solo inyectar lista de servidores en System Prompt,      │
│    no herramientas específicas                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       MCPClient (Capa Cliente)              │
│  - stdio: Comunicación con servidores MCP locales           │
│    mediante entrada/salida estándar                         │
│  - SSE: Comunicación con servidores remotos                 │
│    mediante Server-Sent Events                              │
│  - HTTP: Comunicación bidireccional mediante                │
│    Streamable HTTP                                          │
└─────────────────────────────────────────────────────────────┘
```

**Modo de Descubrimiento Progresivo (Tres Niveles)**:

| Nivel | Método de Invocación | Contenido Retornado | Ahorro de Tokens |
| ----- | -------------------- | ------------------- | ---------------- |
| **Nivel 1 - Discovery** | `MCP(server_name="github")` | Lista de todas las herramientas del servidor (nombre + descripción) | Evita inyectar todas las herramientas |
| **Nivel 2 - Schema** | `MCP(server_name="github", tool_name="create_issue")` | Detalles de herramienta individual/por lotes (incluye schema de parámetros) | Carga bajo demanda |
| **Nivel 3 - Execution** | `MCP(server_name="github", tool_name="create_issue", arguments={...})` | Resultado de ejecución de la herramienta | Ejecución precisa |

**Servicios MCP en Python**:

SoloEngine permite a los usuarios escribir servidores MCP personalizados en Python:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-custom-server")

@mcp.tool()
def my_tool(param: str) -> str:
    """Descripción de herramienta personalizada"""
    return f"Resultado del procesamiento: {param}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

**Gestión de Servicios MCP**:

- Soporte para protocolos de transporte HTTP/SSE/Stdio
- Importar configuraciones de servidores MCP de código abierto (GitHub, Filesystem, PostgreSQL, etc.)
- Crear y gestionar servidores MCP personalizados
- Editar código Python Function en línea, compilar automáticamente como servidor MCP
- Probar conexiones de servidor MCP
- Obtener listas de servidores MCP y recursos

### 💬 Panel de Ejecución

- **Salida Streaming en Tiempo Real**: WebSocket transmite en tiempo real el estado de ejecución y respuestas LLM
- **Gestión de Sesiones**: Soporte para cambio entre múltiples sesiones e historial
- **Explorador de Archivos**: Gestión de archivos de proyecto integrada
- **Editor de Código**: Experiencia de edición de código basada en Monaco Editor
- **Registros de Invocación**: Muestra en tiempo real el estado de invocación de herramientas, Skills y MCP

### 🔌 Arquitectura de Plugins

Alta extensibilidad mediante interfaces abstractas:

```python
class IToolExecutor(ABC):
    """Interfaz de ejecutor de herramientas"""
    async def execute(self, tool_call: dict) -> dict: ...
    def get_available_tools(self) -> List[dict]: ...

class IMCPClient(ABC):
    """Interfaz de cliente MCP"""
    async def connect(self) -> None: ...
    async def call_tool(self, tool_name: str, arguments: dict) -> dict: ...
```

***

## Inicio Rápido

### Requisitos del Entorno

- Python 3.11+
- Node.js 18+
- npm o yarn

### Pasos de Instalación

1. **Clonar el Repositorio**

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine
```

2. **Instalar Dependencias del Backend**

```bash
cd backend
pip install -r requirements.txt
```

3. **Instalar Dependencias del Frontend**

```bash
cd frontend
npm install
```

4. **Iniciar Servicios**

```bash
# Iniciar backend (puerto 8990)
cd backend
python main.py

# Iniciar frontend (puerto 8991)
cd frontend
npm run dev
```

5. **Acceder a la Aplicación**

Abrir el navegador y visitar `http://localhost:8991`

### Configuración de Puertos

| Servicio | Puerto | Descripción |
| -------- | ------ | ----------- |
| Backend Principal | 8990 | Servicio FastAPI |
| Página Frontend | 8991 | Servidor de desarrollo React |

***

## Conceptos Fundamentales

### AgenticFlow

AgenticFlow es el concepto central de SoloEngine, representando un flujo de trabajo completo de IA. Está definido por JSON de lienzo, conteniendo nodos (Agentes) y aristas (relaciones de invocación).

```json
{
  "nodes": [
    {
      "id": "agent_1",
      "type": "agent",
      "data": {
        "name": "Asistente de Código",
        "agentType": "executor",
        "system_prompt": "Eres un asistente de programación profesional...",
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

### Configuración de Agente

Los Agentes en SoloEngine no tienen diferencias esenciales, **todos los Agentes son unidades de ejecución idénticas**. Los llamados "tipos" son solo diferentes configuraciones predefinidas:

| Elemento de Configuración | Descripción |
| ------------------------- | ----------- |
| **system_prompt** | Prompt de sistema, define el rol y comportamiento del Agente |
| **tools** | Lista de herramientas disponibles, determina qué operaciones puede realizar el Agente |
| **skills** | Lista de Skills, proporciona capacidades en dominios específicos |
| **mcp_servers** | Lista de servidores MCP, extiende capacidades de herramientas externas |
| **subagents** | Lista de sub-Agentes, implementa delegación de tareas |

Mediante la combinación de diferentes configuraciones, se puede lograr:

- **Rol de Coordinador**: Configurar herramientas Task y prompts de coordinación
- **Rol de Planificador**: Configurar prompts relacionados con la planificación
- **Rol de Ejecutor**: Configurar herramientas y Skills abundantes

***

## Arquitectura del Sistema

### Arquitectura SoloAgent — Arquitectura de Ejecución Agentic

```
┌─────────────────────────────────────────────────────────────────┐
│                        Capa de Instancia AgenticFlow            │
│                         (run.py)                                │
│         Lectura/Almacenamiento de memoria de modelo,            │
│         Creación de sesión y gestión de aislamiento             │
├─────────────────────────────────────────────────────────────────┤
│                          Capa Compiler                          │
│                     (flow_compiler.py)                          │
│              Compilar y ejecutar Flow,                          │
│              coordinar la colaboración multi-Agente             │
├─────────────────────────────────────────────────────────────────┤
│                         Capa SoloAgent                          │
│                        (agent.py)                               │
│        Basado en ReActCore, responsable de ensamblar            │
│        varios Plugins, compilado en Agente completo             │
├─────────────────────────────────────────────────────────────────┤
│                         Capa ReActCore                          │
│                      (react_core.py)                            │
│          Solo responsable de recibir datos y ejecutar,          │
│          motor de ejecución ReAct central                       │
├─────────────────────────────────────────────────────────────────┤
│                          Interfaz Externa                       │
│              LLM API (OpenAI / Anthropic / Ollama / Qwen)       │
└─────────────────────────────────────────────────────────────────┘
```

### Persistencia de Datos

SoloEngine utiliza una base de datos SQLite para lograr una persistencia completa de sesiones:

**Gestión de Sesiones**:

- `AgenticFlowSessionModel`: Metadatos de sesión (estado, uso de tokens, duración de ejecución)
- `SessionMessageModel`: Registros de mensajes (agrupados por agent_id, soporte para parent_agent_id para registrar relaciones jerárquicas de SubAgentes)

**Mecanismo de Distribución de Memoria**:

```python
# Leer memoria desde la base de datos y distribuir por agent_id
agent_memories = await load_and_distribute_memories(db, session_id, user_id)
# Establecer en CompiledFlow
compiled_flow.set_agent_memories(agent_memories)
```

### Mecanismo de Caché de Compilación (Capa Compiler)

`CompiledFlowFactory` implementa una caché LRU para evitar recompilaciones:

| Configuración | Valor Predeterminado | Descripción |
| ------------- | -------------------- | ----------- |
| `MAX_INSTANCES` | 100 | Número máximo de instancias en caché |
| `CACHE_TIMEOUT` | 1800s | Tiempo de expiración de caché |

**Formato de Clave de Caché**: `{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}`

**Características de Caché**:

- Limpieza automática de instancias expiradas
- Bloqueo de ejecución concurrente (asyncio.Lock independiente para cada Flow)
- Seguimiento de registro de usuarios

### Responsabilidades de los Componentes Principales

| Componente | Archivo | Responsabilidad |
| ---------- | ------- | --------------- |
| **ReActCore** | `core/react_core.py` | Motor central ReAct, maneja el ciclo de llamadas LLM, invocación de herramientas, formateo de mensajes |
| **SoloAgent** | `solo_agent/agent.py` | Clase base de Agente, ensambla plugins de Memory, Tools, MCP, Skills |
| **AgenticFlowCompiler** | `solo_agent/compiler/flow_compiler.py` | Compilador, compila JSON de lienzo en árbol de instancias de Agente ejecutable |
| **ToolkitExecutor** | `plugins/tools/toolkit_executor.py` | Ejecutor de herramientas, gestiona y ejecuta herramientas disponibles para el Agente |
| **MCPHostClientManager** | `solo_agent/compiler/mcp_host_client_manager.py` | Gestor de capa Host MCP, gestiona unificadamente todas las conexiones de Client MCP |
| **MCPClient** | `plugins/mcp/mcp_client.py` | Cliente MCP, se comunica con servidores MCP |
| **MCPTool** | `plugins/tools/agent/mcp.py` | Herramienta MCP, implementa modo de descubrimiento progresivo (Discovery→Schema→Execution) |
| **SkillTool** | `plugins/tools/agent/skill.py` | Herramienta Skill, implementa divulgación progresiva de Skill |

### Capa de Adaptación de Modelos

SoloEngine soporta múltiples proveedores de LLM mediante una capa de adaptación de modelos unificada:

```
┌─────────────────────────────────────────────────────────────┐
│                    ReActCore (Llamada Unificada)            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Capa de Adaptación de Modelos           │
│  OpenAIModel | AnthropicModel | OllamaModel | QwenModel     │
│  DeepSeekModel | ZhipuModel                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     API LLM                                 │
│  OpenAI | Claude | Ollama Llama | Tongyi Qwen               │
│  DeepSeek | Zhipu GLM                                       │
└─────────────────────────────────────────────────────────────┘
```

Cada adaptador de modelo es responsable de:

- Conversión unificada de formato de mensajes
- Procesamiento de respuestas en flujo/no flujo
- Adaptación de invocación de herramientas (Function Calling)
- Soporte de funciones especiales (como Claude Extended Thinking)

***

## Estructura del Proyecto

```
SoloEngine/
├── backend/                    # Código del backend
│   ├── app/                    # Aplicación FastAPI
│   │   ├── core/               # Módulos principales
│   │   │   ├── database.py     # Modelos de base de datos
│   │   │   ├── config.py       # Gestión de configuración
│   │   │   └── data_paths.py   # Gestión de rutas
│   │   └── routers/            # Rutas API
│   ├── SoloAgent/              # Núcleo del Agente
│   │   ├── core/               # Motor principal
│   │   │   ├── react_core.py   # Implementación central ReAct
│   │   │   └── interfaces.py   # Definiciones de interfaces de plugins
│   │   ├── model/              # Adaptación de modelos LLM
│   │   │   ├── openai_model.py # Adaptación OpenAI
│   │   │   ├── anthropic_model.py # Adaptación Anthropic
│   │   │   ├── ollama_model.py # Adaptación Ollama
│   │   │   └── qwen_model.py   # Adaptación Tongyi Qwen
│   │   ├── plugins/            # Sistema de plugins
│   │   │   ├── tools/          # Plugins de herramientas
│   │   │   │   ├── agent/      # Herramientas de Agente (Skill, MCP, Task)
│   │   │   │   ├── file/       # Herramientas de archivo (Read, Write, Delete)
│   │   │   │   ├── command/    # Herramientas de comando (RunCommand)
│   │   │   │   ├── network/    # Herramientas de red (WebSearch, WebFetch)
│   │   │   │   └── search/     # Herramientas de búsqueda (Grep, Glob, SearchCodebase)
│   │   │   ├── mcp/            # Cliente MCP
│   │   │   │   └── mcp_client.py
│   │   │   └── memory/         # Plugin de memoria
│   │   └── solo_agent/         # Configuración y compilación de SoloAgent
│   │       ├── agent.py        # Implementación de Agente
│   │       ├── config.py       # Definiciones de configuración
│   │       └── compiler/       # Compilador
│   │           └── flow_compiler.py
│   └── main.py                 # Punto de entrada de ejecución
├── frontend/                   # Código del frontend
│   ├── src/
│   │   ├── components/         # Componentes React
│   │   │   ├── Canvas/         # Componentes de lienzo
│   │   │   ├── RunPanel/       # Panel de ejecución
│   │   │   ├── Settings/       # Componentes de configuración
│   │   │   ├── SkillsManager/  # Gestión de Skills
│   │   │   └── MCPManager/     # Gestión de MCP
│   │   ├── pages/              # Componentes de página
│   │   ├── services/           # Servicios API
│   │   ├── store/              # Estado Zustand
│   │   └── hooks/              # React Hooks
│   └── package.json
├── data/                       # Directorio de datos
│   ├── database/               # Base de datos SQLite
│   └── system/                 # Recursos del sistema
│       ├── mcp_servers/        # MCP del sistema
│       └── skills/             # Skills del sistema
└── i18n/                       # Documentación internacional
    └── docs/                   # Documentación
```

***

## Stack Tecnológico

### Backend

| Tecnología | Versión | Uso |
| ---------- | ------- | --- |
| [Python](https://www.python.org/) | 3.11+ | Runtime principal |
| [FastAPI](https://fastapi.tiangolo.com/) | 0.115+ | Framework web, API REST |
| [SQLAlchemy](https://www.sqlalchemy.org/) | 2.0+ | ORM para operaciones de base de datos |
| [SQLite](https://www.sqlite.org/) | 3.x | Base de datos embebida |
| [Pydantic](https://pydantic-docs.helpmanual.io/) | 2.0+ | Validación de datos |
| [WebSockets](https://websockets.readthedocs.io/) | 12.0+ | Comunicación en tiempo real |
| [MCP Python SDK](https://modelcontextprotocol.io/) | latest | Model Context Protocol |

### Frontend

| Tecnología | Versión | Uso |
| ---------- | ------- | --- |
| [React](https://reactjs.org/) | 18.2 | Framework UI |
| [TypeScript](https://www.typescriptlang.org/) | 5.3 | Seguridad de tipos |
| [Vite](https://vitejs.dev/) | 5.0+ | Herramienta de construcción |
| [React Flow](https://reactflow.dev/) | 11.x | Visualización de lienzo |
| [Zustand](https://zustand-demo.pmnd.rs/) | 4.x | Gestión de estado |
| [Ant Design](https://ant.design/) | 5.x | Biblioteca de componentes UI |
| [Tailwind CSS](https://tailwindcss.com/) | 3.x | Framework de estilos |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | 0.45+ | Editor de código |

### Paradigmas de Proveedores de LLM Soportados

SoloEngine adopta una capa de adaptación de modelos unificada, soportando los siguientes proveedores:

| Proveedor | Modo de Adaptación | Soporte de Características |
| --------- | ------------------ | -------------------------- |
| [OpenAI](https://openai.com/) | SDK Nativo | Function Calling, salida streaming |
| [Anthropic](https://www.anthropic.com/) | SDK Nativo | Extended Thinking, uso de herramientas |
| [Ollama](https://ollama.ai/) | API Compatible con OpenAI | Despliegue local, sin API Key |
| [Alibaba Qwen](https://tongyi.aliyun.com/) | API Compatible con OpenAI | Optimización en chino, contexto largo |
| [DeepSeek](https://www.deepseek.com/) | API Compatible con OpenAI | Mejora de razonamiento, generación de código |
| [Zhipu GLM](https://open.bigmodel.cn/) | API Compatible con OpenAI | Optimización en chino, multimodal |

***

## Hoja de Ruta

- Mecanismo de exportación y empaquetado one-click
- Integración con APIs externas como Feishu, Telegram
- Mecanismo de Agente Igualitario
- Adaptación i18n multiidioma
- Modo nocturno
- Seguimiento de operaciones de Agentic AI

***

## 🤝 Cooperación e Inversión

SoloEngine se encuentra en una etapa de rápido desarrollo, nos dedicamos a crear una plataforma de desarrollo Agentic AI low-code, de código abierto, abierta y potente. Creemos que la tecnología de Agentic AI cambiará profundamente la forma de trabajar en el futuro, y SoloEngine se convertirá en un importante impulsor de este cambio.

### Lo que Buscamos

| Dirección de Cooperación | Descripción |
| ------------------------ | ----------- |
| **Socios Tecnológicos** | Desarrollar conjuntamente funciones principales, explorar los límites de la tecnología de Agentes |
| **Cooperación de Producto** | Integrar SoloEngine en su producto, crear conjuntamente soluciones sectoriales |
| **Construcción de Ecosistema** | Desarrollar plugins, Skills, servicios MCP, enriquecer el ecosistema |

### Contáctanos

Si estás interesado en SoloEngine, bienvenido a contactarnos:

- 📧 **Email**: sh4r1ock@qq.com
- 🐙 **GitHub Issues**: [Crear Issue](https://github.com/Sh4r1ock/SoloEngine/issues)

> **¡Esperamos trabajar contigo para impulsar conjuntamente el perfeccionamiento y desarrollo de SoloEngine!**

***

## Guía de Contribución

¡Damos la bienvenida a contribuciones de todas las formas!

### Configuración del Entorno de Desarrollo

1. Hacer Fork de este repositorio
2. Crear rama de funcionalidad: `git checkout -b feature/your-feature`
3. Instalar dependencias: `pip install -r backend/requirements.txt`

### Estándares de Código

- Python: Seguir especificación PEP 8, usar Black para formatear
- TypeScript: Usar ESLint + Prettier
- Mensajes de commit: Seguir Conventional Commits

### Enviar PR

1. Asegurar que todas las pruebas pasen
2. Actualizar documentación relevante
3. Enviar Pull Request

***

## Licencia

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

Ver archivo [LICENSE](../../LICENSE) para más detalles.

***

## Agradecimientos

El desarrollo de SoloEngine se ha beneficiado de los siguientes proyectos de código abierto:

- [FastAPI](https://fastapi.tiangolo.com/) - Framework web Python moderno y de alto rendimiento
- [React](https://reactjs.org/) - Biblioteca JavaScript para construir interfaces de usuario
- [React Flow](https://reactflow.dev/) - Para construir diagramas y flujos interactivos
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Editor de código de VS Code
- [Model Context Protocol](https://modelcontextprotocol.io/) - Protocolo de contexto de modelo de Anthropic
- [Tailwind CSS](https://tailwindcss.com/) - Framework CSS utility-first

***

<div align="center">

**Hecho con ❤️ por el Equipo SoloEngine**

</div>
