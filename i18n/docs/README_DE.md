<div align="center">

<img src="../../icon/SoloEngine.png" alt="SoloEngine" width="420"/>

</div>

---

<h2 align="center"><b>KI treibt jede Branche an.</b></h2>

---

<p align="center"><b>SoloEngine</b> ist die erste Low-Code Agentic AI-Entwicklungsplattform. Stell es dir wie das Zusammenstellen eines Startup-Teams vor: Ziehe die benötigten Agents auf die Arbeitsfläche, verbinde ihre Zusammenarbeit, starte — ab diesem Moment planen, handeln und liefern sie eigenständig.</p>

<p align="center">No Workflow. No orchestration code. Just Agents that get things done.</p>

<div align="center">

[![Stars](https://img.shields.io/github/stars/Sh4r1ock/SoloEngine?style=flat-square&label=stars&color=FB6A76)](https://github.com/Sh4r1ock/SoloEngine)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](./LICENSE)

</div>

<p align="center">
  <a href="../../README.md">简体中文</a> |
  <a href="./README_EN.md">English</a> |
  <a href="./README_ES.md">Español</a> |
  Deutsch |
  <a href="./README_FR.md">Français</a>
</p>

---

## Warum SoloEngine

Agentic AI verändert die Softwareentwicklung grundlegend: Ein einzelner Entwickler liefert heute, wofür früher ein Zehnerteam nötig war. Doch diese Revolution blieb bislang auf die IDE beschränkt. Um einen wirklich autonomen AI-Agenten zu bauen, musste man LangChain-Pipelines von Hand schreiben, ReAct-Loops debuggen und Tool-Schemas einzeln definieren. Wer nicht programmieren kann, stand vor einer Wand.

Die verfügbaren Alternativen lösen das Problem kaum: Workflow-Plattformen (Dify, n8n, Zapier u. a.) folgen starr vordefinierten Pfaden — ihr Kern ist kein autonomer Agent. Code-Frameworks (LangChain, CrewAI, LangGraph u. a.) setzen zwingend Python-Kenntnisse voraus. **SoloEngine** schließt genau diese Lücke.

| | Dify, n8n, Zapier | LangChain, CrewAI, LangGraph | **SoloEngine** |
|---|---|---|---|
| Agentic AI | ✗ Nur geskriptete Workflows | ✓ ReAct / Multi-Agent | ✓ ReAct / Multi-Agent |
| Ohne Programmierung | ✓ | ✗ Python-Kenntnisse nötig | ✓ |
| Visuelle Orchestrierung | Teilweise | ✗ | ✓ Volle Canvas-Erfahrung |
| Fachexperten bauen eigenständig | ✓ (Agent ist jedoch nicht wirklich Agentic) | ✗ | ✓ |
| Multi-Agent-Kollaboration | ✗ | ✓ | ✓ |

- **Kein weiteres Workflow-Tool** — Agents arbeiten nach dem Muster „Denken → Handeln → Beobachten → Wiederholen". Jede Entscheidung fällt zur Laufzeit. Stößt ein Research-Agent an eine Grenze, passt er seinen Plan selbstständig an — ohne hartcodierte Fallback-Pfade.
- **Fachexperten bauen direkt** — Ein Anwalt zieht einen Vertragsprüfungs-Agenten auf die Arbeitsfläche, verbindet ihn mit einem Recherche-Agenten und startet. Kein Entwickler nötig.
- **Tools, Skills, MCP — alles hot-plug-fähig** — Jeder Agent lädt zur Laufzeit nur die Werkzeuge und Skills, die er tatsächlich benötigt. Dank Progressive Disclosure sinkt der Token-Verbrauch um über 85 %.
- **Eine Adapterschicht für alle Modelle** — OpenAI, Anthropic, Ollama, DeepSeek, Tongyi Qianwen, Zhipu — einheitliche Schnittstelle, nahtloser Wechsel.

### So funktioniert es

Alle Agents teilen sich dieselben systemnahen Primitive; sie unterscheiden sich nur in ihrer Konfiguration. Das visuelle Design auf der Arbeitsfläche wird kompiliert und direkt in ein ausführbares Agent-Team überführt.

1. **Kompilierung** — Das visuelle Layout wird per topologischer Sortierung in einen gerichteten azyklischen Graphen (DAG) der Agents überführt. Ein und derselbe Compiler erzeugt beliebig viele Teamkonstellationen.
2. **Einheitliche ReAct-Engine** — Jeder Agent durchläuft denselben Zyklus: „Denken → Handeln → Beobachten → Wiederholen".
3. **Progressive Disclosure** — Agents laden nur das, was sie zur Laufzeit tatsächlich brauchen. Das macht Agentic AI in einer Low-Code-Umgebung überhaupt erst praktisch umsetzbar.

## Schnellstart

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine

# Backend (Python 3.11+)
cd backend
pip install -r requirements.txt
python main.py

# Frontend (Node.js 18+) — in einem zweiten Terminal ausführen
cd frontend 
npm install
npm run dev
```

Öffne **http://localhost:8991** im Browser und baue dein erstes Agent-Team.

## Anwendungsszenarien

- **VibeLawing** — Ein Anwalt zieht nacheinander einen Recherche-Agenten, einen Archivierungs-Agenten und einen Formatierungs-Agenten auf die Arbeitsfläche und startet. Die KI zerlegt und plant die juristische Arbeit automatisch: Sachverhalte werden analysiert, Gesetzestexte ermittelt, Fälle aufbereitet, Argumentationen strukturiert und Dokumente formatiert — Sie müssen nur noch prüfen und gegebenenfalls nachjustieren, bevor Sie abliefern. Der gesamte Ablauf verläuft so natürlich, als würde ein Entwickler in Cursor vibe coding betreiben.
- **VibeMarketing** — Eine Marketingfachkraft zieht einen Recherche-Agenten, einen Texter-Agenten und einen Asset-Agenten auf die Arbeitsfläche und startet. SoloEngine analysiert automatisch die Zielgruppe, recherchiert darauf aufbauend passende Produktansätze und vergleicht mit der Konkurrenz, um Marketingstrategien zu erstellen — das Ergebnis ist ein ausgereifter Marketingplan, direkt zur Übergabe bereit.
- **Ein-Klick-Paketierung** — Sobald das Agent-Team steht, genügt ein Klick auf „Paketieren", um ein vollständiges Produkt auszugeben, das jeder sofort nutzen kann.

## Star-Verlauf

[![Star History Chart](https://api.star-history.com/svg?repos=Sh4r1ock/SoloEngine&type=Date)](https://star-history.com/#Sh4r1ock/SoloEngine&Date)

<p align="center">⭐ <b>Wenn dir SoloEngine gefällt, gib uns einen Stern — jeder einzelne zählt!</b></p>

## Danksagung

Besonderer Dank an:

<p align="center">
  <a href="https://github.com/XiaomiMiMo"><img src="https://avatars.githubusercontent.com/u/208276378?v=4" alt="MiMo" height="200"/></a>
</p>

## Mitwirken

Wir freuen uns auf deinen Beitrag.

Ob eine korrigierte Schreibweise, ein neues Tool-Plugin, eine überarbeitete Dokumentation oder ein vollständiges Feature — jeder Beitrag macht SoloEngine besser. Pull Requests jeder Größe sind willkommen.

📝 [Contribution Guide](../../CONTRIBUTING.md) &nbsp;·&nbsp; 🐛 [Gute erste Issues](https://github.com/Sh4r1ock/SoloEngine/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) &nbsp;·&nbsp; 📧 [sh4r1ock@qq.com](mailto:sh4r1ock@qq.com)

## Lizenz

Apache License 2.0. Details unter [LICENSE](../../LICENSE).

---

<div align="center">

**Mit ❤️ vom SoloEngine-Team**

</div>