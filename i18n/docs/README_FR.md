<div align="center">

<img src="../../icon/SoloEngine.png" alt="SoloEngine" width="300"/>

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](./LICENSE)

**Langues** : [English](../../README.md) | [简体中文](./README_CN.md) | [Español](./README_ES.md) | [Deutsch](./README_DE.md) | Français

</div>

***

## Table des matières

- [Qu'est-ce que SoloEngine ?](#quest-ce-que-soloengine)
- [Philosophie de conception](#philosophie-de-conception)
- [Fonctionnalités principales](#fonctionnalités-principales)
- [Démarrage rapide](#démarrage-rapide)
- [Architecture du système](#architecture-du-système)
- [Concepts fondamentaux](#concepts-fondamentaux)
- [Structure du projet](#structure-du-projet)
- [Stack technique](#stack-technique)
- [Feuille de route](#feuille-de-route)
- [Guide de contribution](#guide-de-contribution)
- [Licence](#licence)

***

## Qu'est-ce que SoloEngine ?

SoloEngine est un **framework open source de développement Agentic AI low-code**, conçu pour permettre aux développeurs de construire, déployer et gérer facilement des flux de travail (workflows) complexes d'agents IA. Il adopte une conception de canevas visuel, prend en charge nativement la collaboration multi-agents, l'appel d'outils, l'intégration du protocole MCP, ainsi qu'un mécanisme de divulgation progressive des Skills.

Le cœur de SoloEngine est un moteur d'exécution d'agents intelligents basé sur le paradigme **ReAct (Reasoning + Acting)**, qui réalise une extensibilité élevée grâce à une architecture à plugins, prenant en charge divers fournisseurs de LLM et intégrations d'outils.

***

## Philosophie de conception

### Principes fondamentaux de conception

| Principe | Description |
|----------|-------------|
| **Orchestration visuelle** | Canevas glisser-déposer basé sur React Flow, pour concevoir intuitivement des flux de collaboration multi-agents |
| **Architecture à plugins** | Extension modulaire via des interfaces abstraites (IMemory, IToolExecutor, IMCPClient, etc.) |
| **Paradigme ReAct** | Adopte la boucle Reasoning + Acting, permettant à l'agent de penser, agir, observer et itérer |
| **Unification multi-modèles** | Couche d'adaptation de modèles unifiée, masquant les différences d'API entre différents fournisseurs de LLM |
| **Divulgation progressive** | Les Skills et outils adoptent une présentation de métadonnées légères, les détails étant chargés à la demande, optimisant la consommation de tokens |
| **Sandbox sécurisé** | Isolation de projet, contrôle des permissions d'outils, vérification de sécurité des commandes, assurant une exécution sécurisée |

***

## Fonctionnalités principales

### 🤖 Orchestration multi-agents

- **Canevas visuel** : Conception de flux de travail glisser-déposer basée sur React Flow
- **Configuration flexible des agents** : Réalisation de différents rôles d'agents via différentes configurations de prompts, outils et Skills
  - **Quatre types d'agents prédéfinis** :
    - **Custom (Personnalisé)** : Agent librement configuré par l'utilisateur, servant de modèle vierge
    - **Orchestrator (Coordinateur)** : Coordonne plusieurs SubAgents, distribue les tâches, agrège les résultats
    - **Planner (Planificateur)** : Analyse les problèmes, élabore des plans d'exécution
    - **Executor (Exécuteur)** : Exécute des tâches spécifiques, appelle les outils et Skills
- **Compilation par tri topologique** : Compilation ascendante, résolution automatique des dépendances entre agents
- **Exécution concurrente** : Prend en charge l'exécution parallèle de multiples agents et l'agrégation des résultats
- **Délégation SubAgent** : Délégation de sous-tâches à des SubAgents spécialisés via l'outil Task

### 🔧 Écosystème d'outils riche

SoloEngine intègre un ensemble complet d'outils, couvrant les opérations de fichiers, l'exécution de commandes, l'accès réseau et autres scénarios :

| Catégorie d'outils | Nom de l'outil | Description de la fonction |
|-------------------|----------------|---------------------------|
| **Opérations de fichiers** | Read | Lire le contenu d'un fichier, prend en charge la plage de numéros de ligne |
| | Write | Écrire dans un fichier |
| | DeleteFile | Supprimer un fichier |
| | LS | Lister le contenu d'un répertoire |
| | SearchReplace | Rechercher et remplacer le contenu d'un fichier |
| **Recherche** | Grep | Recherche regex dans le contenu des fichiers |
| | Glob | Recherche de fichiers par pattern matching |
| | SearchCodebase | Recherche sémantique de code |
| **Commandes** | RunCommand | Exécuter des commandes Shell, prend en charge les modes bloquant/non-bloquant |
| | CheckCommandStatus | Vérifier le statut d'exécution d'une commande |
| | StopCommand | Arrêter une commande en cours d'exécution |
| | GetDiagnostics | Obtenir les informations de diagnostic du code |
| **Réseau** | WebSearch | Recherche sur le web |
| | WebFetch | Récupérer le contenu d'une page web |
| **Agent** | Skill | Appeler un Skill |
| | Task | Lancer un SubAgent |
| | MCP | Appeler un outil MCP |
| **Ask** | AskUserQuestion | Poser une question à l'utilisateur |
| | TodoWrite | Créer une liste de tâches |

**Mécanisme de quatre événements pour la sortie en flux des appels d'outils** :

SoloEngine implémente une gestion complète du cycle de vie des quatre événements d'appel d'outils, assurant l'affichage en temps réel du statut des appels d'outils sur le frontend :

| Événement | Moment de déclenchement | Contenu des données |
|-----------|------------------------|---------------------|
| `TOOL_CALL_START` | Détection d'un nouvel ID d'appel d'outil | `{id, name, status: "start"}` |
| `TOOL_CALL_ARGS` | Transmission incrémentale des paramètres (peut survenir plusieurs fois) | `{id, arguments: "..."}` |
| `TOOL_CALL_END` | Transmission des paramètres terminée | `{id, status: "end"}` |
| `TOOL_CALL_RESULT` | Retour du résultat d'exécution de l'outil | `{id, result, error?}` |

**Format unifié du frontend** : Tous les événements sont convertis au format `{type: "tool_calls", tool_calls: [...]}`, poussés en temps réel via WebSocket.

### 🎯 Système de Skills

Les Skills sont des modules de capacités IA réutilisables, adoptant une conception de **divulgation progressive** :

```
skill-name/
├── SKILL.md          # Requis : Définition et instructions du Skill
├── references/       # Optionnel : Documentation de référence
├── scripts/          # Optionnel : Scripts auxiliaires
├── templates/        # Optionnel : Fichiers modèles
└── assets/           # Optionnel : Fichiers de ressources
```

**Mécanisme de divulgation progressive** :

| Niveau | Moment | Contenu | Consommation de tokens |
|--------|--------|---------|----------------------|
| Premier niveau | Tool Spec | name + description | ~100 tokens |
| Deuxième niveau | Appel Skill | Contenu complet de SKILL.md + folder_path | À la demande |
| Troisième niveau | Autonomie du modèle | Ressources imbriquées (references/, templates/) | À la demande |

**Système d'édition et de création de Skills** :

SoloEngine fournit des fonctionnalités complètes de gestion des Skills :

- **Créer un Skill** : Créer de nouveaux packages Skill via API ou interface
- **Éditer SKILL.md** : Éditer en ligne la définition et les instructions du Skill
- **Gestion de fichiers** : Gérer les répertoires references/, scripts/, templates/, assets/
- **Import/Export** : Prend en charge l'import/export de packages Skill au format ZIP
- **Skills système** : Skills système prédéfinis, que les utilisateurs peuvent consulter pour apprendre

### 🔌 Support du protocole MCP

Support complet du **Model Context Protocol** (protocole de contexte de modèle proposé par Anthropic), adoptant une **architecture hiérarchique Host-Client** et un **mode de découverte progressive** :

**Conception architecturale** :

```
┌─────────────────────────────────────────────────────────────┐
│                     CompiledFlow (Couche Host)              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           MCPHostClientManager (Gestion unifiée)     │   │
│  │  - Collecte l'union de tous les mcp_servers configurés│   │
│  │    par les agents lors de la compilation             │   │
│  │  - Crée et enregistre MCPClient de manière unifiée   │   │
│  │  - Gère le cycle de vie du Client (connexion, déconnexion)│   │
│  │  - Plusieurs agents partagent le même Client         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        MCPTool (Couche outils)              │
│  - Point d'entrée unifié pour appeler les outils du serveur MCP│
│  - Mode de découverte progressive : Discovery → Schema → Execution│
│  - N'injecte que la liste des serveurs dans le System Prompt,│
│    pas les outils spécifiques                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       MCPClient (Couche Client)             │
│  - stdio : Communication avec le serveur MCP local via     │
│            entrée/sortie standard                          │
│  - SSE : Communication avec le serveur distant via         │
│          Server-Sent Events                                │
│  - HTTP : Communication bidirectionnelle via               │
│           Streamable HTTP                                  │
└─────────────────────────────────────────────────────────────┘
```

**Mode de découverte progressive (trois niveaux)** :

| Niveau | Mode d'appel | Contenu retourné | Économie de tokens |
|--------|-------------|------------------|-------------------|
| **Tier 1 - Discovery** | `MCP(server_name="github")` | Liste de tous les outils du serveur (nom + description) | Évite d'injecter tous les outils |
| **Tier 2 - Schema** | `MCP(server_name="github", tool_name="create_issue")` | Détails d'un/plusieurs outils (avec schéma de paramètres) | Chargement à la demande |
| **Tier 3 - Execution** | `MCP(server_name="github", tool_name="create_issue", arguments={...})` | Résultat d'exécution de l'outil | Exécution précise |

**Écriture de services MCP en Python** :

SoloEngine permet aux utilisateurs d'écrire des serveurs MCP personnalisés en Python :

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-custom-server")

@mcp.tool()
def my_tool(param: str) -> str:
    """Description de l'outil personnalisé"""
    return f"Résultat du traitement: {param}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

**Gestion des services MCP** :

- Prend en charge les protocoles de transport HTTP/SSE/Stdio
- Importe les configurations de serveurs MCP open source (GitHub, Filesystem, PostgreSQL, etc.)
- Crée et gère des serveurs MCP personnalisés
- Édite le code Python Function en ligne, compile automatiquement en serveur MCP
- Teste la connexion au serveur MCP
- Obtient la liste et les ressources des serveurs MCP

### 💬 Panneau d'exécution

- **Sortie en flux temps réel** : Push en temps réel du statut d'exécution et des réponses LLM via WebSocket
- **Gestion des sessions** : Prend en charge le basculement entre plusieurs sessions et l'historique
- **Explorateur de fichiers** : Intégration de la gestion des fichiers de projet
- **Éditeur de code** : Expérience d'édition de code basée sur Monaco Editor
- **Journal d'appels** : Affichage en temps réel du statut des appels d'outils, Skills et MCP

### 🔌 Architecture à plugins

Extensibilité élevée via des interfaces abstraites :

```python
class IToolExecutor(ABC):
    """Interface de l'exécuteur d'outils"""
    async def execute(self, tool_call: dict) -> dict: ...
    def get_available_tools(self) -> List[dict]: ...

class IMCPClient(ABC):
    """Interface client MCP"""
    async def connect(self) -> None: ...
    async def call_tool(self, tool_name: str, arguments: dict) -> dict: ...
```

***

## Démarrage rapide

### Prérequis

- Python 3.11+
- Node.js 18+
- npm ou yarn

### Étapes d'installation

1. **Cloner le dépôt**

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine
```

2. **Installer les dépendances backend**

```bash
cd backend
pip install -r requirements.txt
```

3. **Installer les dépendances frontend**

```bash
cd frontend
npm install
```

4. **Démarrer les services**

```bash
# Démarrer le backend (port 8990)
cd backend
python main.py

# Démarrer le frontend (port 8991)
cd frontend
npm run dev
```

5. **Accéder à l'application**

Ouvrez votre navigateur et accédez à `http://localhost:8991`

### Configuration des ports

| Service | Port | Description |
|---------|------|-------------|
| Backend principal | 8990 | Service FastAPI |
| Page frontend | 8991 | Serveur de développement React |

***

## Concepts fondamentaux

### AgenticFlow

AgenticFlow est le concept fondamental de SoloEngine, représentant un flux de travail (workflow) IA complet. Il est défini par un JSON de canevas, contenant des nœuds (agents) et des arêtes (relations d'appel).

```json
{
  "nodes": [
    {
      "id": "agent_1",
      "type": "agent",
      "data": {
        "name": "Assistant de code",
        "agentType": "executor",
        "system_prompt": "Vous êtes un assistant de programmation professionnel...",
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

### Configuration de l'agent

Les agents dans SoloEngine n'ont pas de différence essentielle, **tous les agents sont des unités d'exécution identiques**. Les "types" ne sont que des configurations prédéfinies différentes :

| Élément de configuration | Description |
|-------------------------|-------------|
| **system_prompt** | Prompt système, définit le rôle et le comportement de l'agent |
| **tools** | Liste des outils disponibles, détermine quelles opérations l'agent peut effectuer |
| **skills** | Liste des Skills, fournit des capacités dans des domaines spécialisés |
| **mcp_servers** | Liste des serveurs MCP, étend les capacités des outils externes |
| **subagents** | Liste des sous-agents, réalise la délégation de tâches |

En combinant différentes configurations, on peut réaliser :

- **Rôle de coordinateur** : Configurer l'outil Task et des prompts de coordination
- **Rôle de planificateur** : Configurer des prompts liés à la planification
- **Rôle d'exécuteur** : Configurer des outils et Skills riches

***

## Architecture du système

### Architecture SoloAgent — Architecture d'exécution Agentic

```
┌─────────────────────────────────────────────────────────────────┐
│                        Couche instance AgenticFlow              │
│                         (run.py)                                │
│         Lecture/stockage de la mémoire du modèle, création      │
│         et gestion d'isolation des sessions                     │
├─────────────────────────────────────────────────────────────────┤
│                          Couche Compiler                        │
│                     (flow_compiler.py)                          │
│              Compile et exécute le Flow, coordonne              │
│              la collaboration multi-agents                      │
├─────────────────────────────────────────────────────────────────┤
│                         Couche SoloAgent                        │
│                        (agent.py)                               │
│        Basé sur ReActCore, responsable de l'assemblage          │
│        des divers plugins, compilé en agent complet             │
├─────────────────────────────────────────────────────────────────┤
│                         Couche ReActCore                        │
│                      (react_core.py)                            │
│          Responsable uniquement de la réception des données     │
│          et de l'exécution, moteur d'exécution ReAct central    │
├─────────────────────────────────────────────────────────────────┤
│                          Interface externe                      │
│              LLM API (OpenAI / Anthropic / Ollama / Qwen)       │
└─────────────────────────────────────────────────────────────────┘
```

### Persistance des données

SoloEngine adopte une base de données SQLite pour réaliser une persistance complète des sessions :

**Gestion des sessions** :

- `AgenticFlowSessionModel` : Métadonnées de session (statut, utilisation de tokens, durée d'exécution)
- `SessionMessageModel` : Enregistrement des messages (groupés par agent_id, prend en charge parent_agent_id pour enregistrer les relations hiérarchiques SubAgent)

**Mécanisme de distribution de la mémoire** :

```python
# Lire la mémoire depuis la base de données et distribuer par agent_id
agent_memories = await load_and_distribute_memories(db, session_id, user_id)
# Définir dans CompiledFlow
compiled_flow.set_agent_memories(agent_memories)
```

### Mécanisme de cache de compilation (Couche Compiler)

`CompiledFlowFactory` implémente un cache LRU, évitant les recompilations répétées :

| Configuration | Valeur par défaut | Description |
|---------------|-------------------|-------------|
| `MAX_INSTANCES` | 100 | Nombre maximal d'instances en cache |
| `CACHE_TIMEOUT` | 1800s | Délai d'expiration du cache |

**Format de la clé de cache** : `{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}`

**Caractéristiques du cache** :

- Nettoyage automatique des instances expirées
- Verrou d'exécution concurrente (asyncio.Lock indépendant pour chaque Flow)
- Suivi de l'enregistrement des utilisateurs

### Responsabilités des composants principaux

| Composant | Fichier | Responsabilité |
|-----------|---------|----------------|
| **ReActCore** | `core/react_core.py` | Moteur central ReAct, gère la boucle d'appel LLM, les appels d'outils, le formatage des messages |
| **SoloAgent** | `solo_agent/agent.py` | Classe de base Agent, assemble les plugins Memory, Tools, MCP, Skills |
| **AgenticFlowCompiler** | `solo_agent/compiler/flow_compiler.py` | Compilateur, compile le JSON du canevas en arborescence d'instances d'agents exécutables |
| **ToolkitExecutor** | `plugins/tools/toolkit_executor.py` | Exécuteur d'outils, gère et exécute les outils disponibles pour l'agent |
| **MCPHostClientManager** | `solo_agent/compiler/mcp_host_client_manager.py` | Gestionnaire de couche Host MCP, gère de manière unifiée toutes les connexions MCP Client |
| **MCPClient** | `plugins/mcp/mcp_client.py` | Client MCP, communique avec les serveurs MCP |
| **MCPTool** | `plugins/tools/agent/mcp.py` | Outil MCP, implémente le mode de découverte progressive (Discovery→Schema→Execution) |
| **SkillTool** | `plugins/tools/agent/skill.py` | Outil Skill, implémente la divulgation progressive des Skills |

### Couche d'adaptation de modèles

SoloEngine prend en charge plusieurs fournisseurs de LLM via une couche d'adaptation de modèles unifiée :

```
┌─────────────────────────────────────────────────────────────┐
│                    ReActCore (appel unifié)                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Couche d'adaptation de modèles          │
│  OpenAIModel | AnthropicModel | OllamaModel | QwenModel    │
│  DeepSeekModel | ZhipuModel                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     LLM API                                 │
│  OpenAI | Claude | Ollama Llama | Tongyi Qwen              │
│  DeepSeek | Zhipu GLM                                       │
└─────────────────────────────────────────────────────────────┘
```

Chaque adaptateur de modèle est responsable de :

- Conversion unifiée du format des messages
- Traitement des réponses en flux/non-flux
- Adaptation des appels d'outils (Function Calling)
- Support de fonctionnalités spéciales (comme Claude Extended Thinking)

***

## Structure du projet

```
SoloEngine/
├── backend/                    # Code backend
│   ├── app/                    # Application FastAPI
│   │   ├── core/               # Modules principaux
│   │   │   ├── database.py     # Modèles de base de données
│   │   │   ├── config.py       # Gestion de configuration
│   │   │   └── data_paths.py   # Gestion des chemins
│   │   └── routers/            # Routes API
│   ├── SoloAgent/              # Cœur de l'agent
│   │   ├── core/               # Moteur principal
│   │   │   ├── react_core.py   # Implémentation ReAct
│   │   │   └── interfaces.py   # Définitions des interfaces plugin
│   │   ├── model/              # Adaptation des modèles LLM
│   │   │   ├── openai_model.py # Adaptation OpenAI
│   │   │   ├── anthropic_model.py # Adaptation Anthropic
│   │   │   ├── ollama_model.py # Adaptation Ollama
│   │   │   └── qwen_model.py   # Adaptation Tongyi Qwen
│   │   ├── plugins/            # Système de plugins
│   │   │   ├── tools/          # Plugins d'outils
│   │   │   │   ├── agent/      # Outils Agent (Skill, MCP, Task)
│   │   │   │   ├── file/       # Outils de fichiers (Read, Write, Delete)
│   │   │   │   ├── command/    # Outils de commandes (RunCommand)
│   │   │   │   ├── network/    # Outils réseau (WebSearch, WebFetch)
│   │   │   │   └── search/     # Outils de recherche (Grep, Glob, SearchCodebase)
│   │   │   ├── mcp/            # Client MCP
│   │   │   │   └── mcp_client.py
│   │   │   └── memory/         # Plugin de mémoire
│   │   └── solo_agent/         # Configuration et compilation SoloAgent
│   │       ├── agent.py        # Implémentation de l'agent
│   │       ├── config.py       # Définitions de configuration
│   │       └── compiler/       # Compilateur
│   │           └── flow_compiler.py
│   └── main.py                 # Point d'entrée d'exécution
├── frontend/                   # Code frontend
│   ├── src/
│   │   ├── components/         # Composants React
│   │   │   ├── Canvas/         # Composants de canevas
│   │   │   ├── RunPanel/       # Panneau d'exécution
│   │   │   ├── Settings/       # Composants de paramètres
│   │   │   ├── SkillsManager/  # Gestion des Skills
│   │   │   └── MCPManager/     # Gestion MCP
│   │   ├── pages/              # Composants de pages
│   │   ├── services/           # Services API
│   │   ├── store/              # État Zustand
│   │   └── hooks/              # React Hooks
│   └── package.json
├── data/                       # Répertoire de données
│   ├── database/               # Base de données SQLite
│   └── system/                 # Ressources système
│       ├── mcp_servers/        # MCP système
│       └── skills/             # Skills système
└── i18n/                       # Documentation internationale
    └── docs/                   # Documentation
```

***

## Stack technique

### Backend

| Technologie | Version | Usage |
|-------------|---------|-------|
| [Python](https://www.python.org/) | 3.11+ | Runtime principal |
| [FastAPI](https://fastapi.tiangolo.com/) | 0.115+ | Framework Web, API REST |
| [SQLAlchemy](https://www.sqlalchemy.org/) | 2.0+ | Opérations ORM base de données |
| [SQLite](https://www.sqlite.org/) | 3.x | Base de données embarquée |
| [Pydantic](https://pydantic-docs.helpmanual.io/) | 2.0+ | Validation des données |
| [WebSockets](https://websockets.readthedocs.io/) | 12.0+ | Communication temps réel |
| [MCP Python SDK](https://modelcontextprotocol.io/) | latest | Model Context Protocol |

### Frontend

| Technologie | Version | Usage |
|-------------|---------|-------|
| [React](https://reactjs.org/) | 18.2 | Framework UI |
| [TypeScript](https://www.typescriptlang.org/) | 5.3 | Sécurité des types |
| [Vite](https://vitejs.dev/) | 5.0+ | Outil de build |
| [React Flow](https://reactflow.dev/) | 11.x | Visualisation de canevas |
| [Zustand](https://zustand-demo.pmnd.rs/) | 4.x | Gestion d'état |
| [Ant Design](https://ant.design/) | 5.x | Bibliothèque de composants UI |
| [Tailwind CSS](https://tailwindcss.com/) | 3.x | Framework de styles |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | 0.45+ | Éditeur de code |

### Paradigmes de fournisseurs LLM supportés

SoloEngine adopte une couche d'adaptation de modèles unifiée, prenant en charge les fournisseurs suivants :

| Fournisseur | Mode d'adaptation | Support de fonctionnalités |
|-------------|------------------|---------------------------|
| [OpenAI](https://openai.com/) | SDK natif | Function Calling, sortie en flux |
| [Anthropic](https://www.anthropic.com/) | SDK natif | Extended Thinking, utilisation d'outils |
| [Ollama](https://ollama.ai/) | API compatible OpenAI | Déploiement local, pas besoin de clé API |
| [Alibaba Qwen](https://tongyi.aliyun.com/) | API compatible OpenAI | Optimisation chinoise, contexte long |
| [DeepSeek](https://www.deepseek.com/) | API compatible OpenAI | Raisonnement amélioré, génération de code |
| [Zhipu GLM](https://open.bigmodel.cn/) | API compatible OpenAI | Optimisation chinoise, multimodal |

***

## Feuille de route

- Mécanisme d'export et packaging en un clic
- Intégration d'API externes comme Feishu, Telegram
- Mécanisme d'agents égaux
- Adaptation i18n multilingue
- Mode nuit
- Suivi des opérations Agentic AI

***

## 🤝 Partenariat et investissement

SoloEngine est en phase de développement rapide, nous nous engageons à créer une plateforme de développement Agentic AI low-code open source, ouverte et puissante. Nous croyons que la technologie des agents IA changera profondément les modes de travail futurs, et SoloEngine deviendra un acteur important de cette transformation.

### Ce que nous recherchons

| Direction de partenariat | Description |
|-------------------------|-------------|
| **Partenaires techniques** | Développer ensemble les fonctionnalités principales, explorer les frontières de la technologie Agent |
| **Partenariat produit** | Intégrer SoloEngine dans votre produit, créer ensemble des solutions sectorielles |
| **Construction d'écosystème** | Développer des plugins, Skills, services MCP, enrichir l'écosystème |

### Contactez-nous

Si vous êtes intéressé par SoloEngine, n'hésitez pas à nous contacter :

- 📧 **Email** : <sh4r1ock@qq.com>
- 🐙 **GitHub Issues** : [Soumettre une Issue](https://github.com/Sh4r1ock/SoloEngine/issues)

> **Nous attendons avec impatience de collaborer avec vous pour promouvoir ensemble l'amélioration et le développement de SoloEngine !**

***

## Guide de contribution

Nous accueillons toutes formes de contribution !

### Configuration de l'environnement de développement

1. Forker ce dépôt
2. Créer une branche de fonctionnalité : `git checkout -b feature/your-feature`
3. Installer les dépendances : `pip install -r backend/requirements.txt`

### Normes de code

- Python : Suivre la norme PEP 8, utiliser Black pour le formatage
- TypeScript : Utiliser ESLint + Prettier
- Messages de commit : Suivre Conventional Commits

### Soumettre une PR

1. Assurer que tous les tests passent
2. Mettre à jour la documentation pertinente
3. Soumettre une Pull Request

***

## Licence

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

Voir le fichier [LICENSE](../../LICENSE) pour plus de détails.

***

## Remerciements

Le développement de SoloEngine a bénéficié des projets open source suivants :

- [FastAPI](https://fastapi.tiangolo.com/) - Framework Web Python moderne et performant
- [React](https://reactjs.org/) - Bibliothèque JavaScript pour la construction d'interfaces utilisateur
- [React Flow](https://reactflow.dev/) - Pour la construction de diagrammes et flux interactifs
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Éditeur de code de VS Code
- [Model Context Protocol](https://modelcontextprotocol.io/) - Protocole de contexte de modèle d'Anthropic
- [Tailwind CSS](https://tailwindcss.com/) - Framework CSS utilitaire

***

<div align="center">

**Made with ❤️ by SoloEngine Team**

</div>
