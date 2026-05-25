<div align="center">

<img src="../../icon/SoloEngine.png" alt="SoloEngine" width="420"/>

</div>

---

<h2 align="center"><b>Que l'IA impulse chaque industrie.</b></h2>

---

<p align="center"><b>SoloEngine</b> est la première plateforme de développement Agentic AI low-code. C'est comme constituer une équipe de startup : glissez les Agents dont vous avez besoin sur le canevas, connectez leurs relations de collaboration, puis exécutez. À partir de là, ils planifient, agissent et livrent de manière totalement autonome.</p>

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
  <a href="./README_DE.md">Deutsch</a> |
  Français
</p>

---

## Pourquoi SoloEngine

L'Agentic AI est en train de redéfinir le développement logiciel : un seul développeur accomplit aujourd'hui ce qui exigeait autrefois une équipe de dix personnes. Pourtant, cette révolution n'est jamais sortie de l'IDE. Pour construire un véritable AI Agent, il fallait écrire des pipelines LangChain à la main, déboguer des boucles ReAct sans fin et définir les schémas d'outils un par un. Vous ne savez pas coder ? Alors tout cela reste hors de portée.

Les alternatives actuelles ne résolvent pas davantage le problème : les plateformes de workflow (Dify, n8n, etc.) exécutent des chemins fixes préorchestrés, leur cœur n'étant pas celui d'un Agent autonome ; les frameworks de code (LangChain, CrewAI, etc.) exigent de maîtriser Python. **SoloEngine** existe précisément pour combler cet écart.

| | Dify, n8n, Zapier | LangChain, CrewAI, LangGraph | **SoloEngine** |
|---|---|---|---|
| Agentic AI | ✗ Workflows scriptés uniquement | ✓ ReAct / Multi-Agent | ✓ ReAct / Multi-Agent |
| Sans programmation | ✓ | ✗ Maîtrise de Python requise | ✓ |
| Orchestration visuelle | Partielle | ✗ | ✓ Expérience canevas complète |
| Experts métier autonomes | ✓ (mais l'Agent n'est pas réellement Agentic) | ✗ | ✓ |
| Collaboration Multi-Agent | ✗ | ✓ | ✓ |

- **Pas un énième outil de workflow.** Les Agents fonctionnent selon le cycle « penser → agir → observer → répéter ». Toutes les décisions sont prises à l'exécution. Lorsqu'un Agent de recherche se trouve bloqué, il ajuste son plan à la volée — aucun chemin de repli codé en dur.
- **Les experts métier construisent directement.** Un avocat glisse un Agent de révision de contrats sur le canevas, le connecte à un Agent de recherche, puis exécute. Aucun développeur n'est nécessaire.
- **Outils, Skills, MCP — tout est connectable à chaud.** Chaque Agent charge uniquement ce dont il a besoin à l'exécution. Grâce à la divulgation progressive, la consommation de tokens diminue de plus de 85 %.
- **Une couche d'adaptation pour tous les modèles.** OpenAI, Anthropic, Ollama, DeepSeek, Qwen, Zhipu — une interface unifiée, un basculement transparent.

### Comment ça fonctionne

Tous les Agents partagent les mêmes primitives sous-jacentes ; seule leur configuration diffère. Le design visuel du canevas est compilé directement en une équipe d'Agents exécutable.

1. **Compiler** — La disposition visuelle est transformée, par tri topologique, en un graphe orienté acyclique (DAG) d'Agents. Un même compilateur génère une infinité de combinaisons d'équipes.
2. **Moteur ReAct unifié** — Chaque Agent exécute le même cycle « penser → agir → observer → répéter ».
3. **Divulgation progressive** — Les Agents ne chargent que ce dont ils ont réellement besoin à l'exécution. C'est ce qui rend l'Agentic AI viable en environnement low-code.

## Démarrage rapide

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine

# Backend (Python 3.11+)
cd backend
pip install -r requirements.txt
python main.py

# Frontend (Node.js 18+) — à exécuter dans un autre terminal
cd frontend 
npm install
npm run dev
```

Ouvrez **http://localhost:8991** dans votre navigateur et construisez votre première équipe d'Agents.

## Cas d'usage

- **VibeLawing** — Un avocat glisse successivement un Agent de recherche, un Agent d'archivage et un Agent de mise en forme sur le canevas, puis exécute. L'IA décompose et planifie automatiquement le travail juridique : analyse des faits, localisation des textes de loi, organisation de la jurisprudence, structuration des arguments et mise en forme des documents — il ne vous reste qu'à vérifier et ajuster avant livraison. L'ensemble du processus est aussi fluide qu'un développeur pratiquant le vibe coding dans Cursor.
- **VibeMarketing** — Un spécialiste marketing glisse un Agent d'étude, un Agent de rédaction et un Agent de ressources sur le canevas, puis exécute. SoloEngine analyse automatiquement l'audience, recherche sur cette base des solutions produit pertinentes et effectue une analyse concurrentielle pour rédiger des stratégies marketing — vous livrant un plan marketing abouti.
- **Packaging en un clic** — Une fois votre équipe d'Agents prête, un seul clic génère un produit complet que n'importe qui peut utiliser directement.

## Tendance des Stars

[![Star History Chart](https://api.star-history.com/svg?repos=Sh4r1ock/SoloEngine&type=Date)](https://star-history.com/#Sh4r1ock/SoloEngine&Date)

<p align="center">⭐ <b>Si SoloEngine vous est utile, offrez-nous une étoile — chacune compte énormément pour nous !</b></p>

## Remerciements

Un remerciement tout particulier à :

<p align="center">
  <a href="https://github.com/XiaomiMiMo"><img src="https://avatars.githubusercontent.com/u/208276378?v=4" alt="MiMo" height="200"/></a>
</p>

## Contribuer

Nous serions ravis de vous compter parmi nous.

Qu'il s'agisse d'une correction orthographique, d'un nouveau plugin d'outil, d'une amélioration de la documentation ou d'une fonctionnalité complète — chaque contribution rend SoloEngine meilleur. Toutes les Pull Requests sont les bienvenues, quelle que soit leur taille.

📝 [Guide de contribution](../../CONTRIBUTING.md) &nbsp;·&nbsp; 🐛 [Premières issues](https://github.com/Sh4r1ock/SoloEngine/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) &nbsp;·&nbsp; 📧 [sh4r1ock@qq.com](mailto:sh4r1ock@qq.com)

## Licence

Apache License 2.0. Voir [LICENSE](../../LICENSE).

---

<div align="center">

**L'équipe SoloEngine, conçue avec ❤️**

</div>