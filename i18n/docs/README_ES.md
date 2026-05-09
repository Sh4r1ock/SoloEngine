<div align="center">

<img src="../../icon/SoloEngine.png" alt="SoloEngine" width="500"/>

</div>

---

<h3 align="center"><b>Que la IA impulse cada industria.</b></h3>

---

**SoloEngine** es la primera plataforma de desarrollo Agentic AI de bajo código. Es como formar un equipo de startup: arrastra los Agents que necesites al lienzo, conecta sus relaciones de colaboración y compila. A partir de ese momento, planifican, ejecutan y entregan de forma totalmente autónoma.

No Workflow. No orchestration code. Just Agents that get things done.

<div align="center">

[![Stars](https://img.shields.io/github/stars/Sh4r1ock/SoloEngine?style=flat-square&label=stars&color=FB6A76)](https://github.com/Sh4r1ock/SoloEngine)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](./LICENSE)

</div>

[English](../../README.md) | [简体中文](./README_CN.md) | Español | [Deutsch](./README_DE.md) | [Français](./README_FR.md)

---

## ¿Por qué SoloEngine?

La Agentic AI está transformando el desarrollo de software: un solo desarrollador logra hoy lo que antes exigía un equipo de diez personas. Sin embargo, esta revolución jamás salió del editor de código. Para construir un AI Agent real, tenías que escribir pipelines de LangChain a mano, depurar bucles ReAct una y otra vez, y definir esquemas de herramientas uno por uno. ¿No sabes programar? Entonces todo esto queda fuera de tu alcance.

Las alternativas actuales tampoco resuelven el problema: las plataformas de workflow (Dify, n8n, etc.) ejecutan rutas fijas preorquestadas, sin Agents autónomos en su núcleo; los frameworks de código (LangChain, CrewAI, etc.) exigen dominar Python. **SoloEngine** existe precisamente para cerrar esa brecha.

| | Dify, n8n, Zapier | LangChain, CrewAI, LangGraph | **SoloEngine** |
|---|---|---|---|
| Agentic AI | ✗ Solo workflows con scripts | ✓ ReAct / Multi-Agent | ✓ ReAct / Multi-Agent |
| Sin programación | ✓ | ✗ Requiere Python | ✓ |
| Orquestación visual | Parcial | ✗ | ✓ Experiencia completa en lienzo |
| Expertos de dominio autónomos | ✓ (pero el Agent no es realmente Agentic) | ✗ | ✓ |
| Colaboración Multi-Agent | ✗ | ✓ | ✓ |

- **No es una herramienta de workflow más.** Los Agents operan con el ciclo «pensar → actuar → observar → repetir». Todas las decisiones se toman en tiempo de ejecución. Si un Agent de investigación se atasca, ajusta su plan sobre la marcha, sin rutas de respaldo predefinidas.
- **Los expertos de dominio construyen directamente.** Un abogado arrastra un Agent de revisión de contratos al lienzo, lo conecta a un Agent de investigación y compila. Sin intervención de programadores.
- **Herramientas, Skills, MCP: todo es conectable.** Cada Agent carga solo lo que necesita en tiempo de ejecución. Gracias a la divulgación progresiva, el consumo de tokens se reduce en más de un 85 %.
- **Una sola capa de adaptación para todos los modelos.** OpenAI, Anthropic, Ollama, DeepSeek, Qwen, Zhipu: una interfaz unificada, cambio transparente.

### Cómo funciona

Todos los Agents comparten las mismas primitivas subyacentes; la diferencia está solo en cómo se configuran. El diseño visual del lienzo se compila directamente en un equipo de Agents ejecutable.

1. **Compilar**: el diseño visual se transforma, mediante ordenamiento topológico, en un grafo acíclico dirigido (DAG) de Agents. Un mismo compilador genera infinitas combinaciones de equipos.
2. **Motor ReAct unificado**: cada Agent ejecuta el mismo ciclo «pensar → actuar → observar → repetir».
3. **Divulgación progresiva**: los Agents solo cargan lo que realmente necesitan en tiempo de ejecución. Es lo que hace viable la Agentic AI en entornos de bajo código.

## Inicio rápido

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine

# Backend (Python 3.11+)
cd backend
pip install -r requirements.txt
python main.py

# Frontend (Node.js 18+) — ejecutar en otra terminal
cd frontend 
npm install
npm run dev
```

Abre **http://localhost:8991** en el navegador y construye tu primer equipo de Agents.

## Casos de uso

- **VibeLawing**: un abogado arrastra Agents de búsqueda, archivo y formato al lienzo, y compila. El trabajo legal fluye de inmediato: se localizan normas, se organiza jurisprudencia, se formatean documentos, con la misma naturalidad con que un desarrollador hace vibe coding en Cursor.
- **VibeMarketing**: un especialista en marketing arrastra Agents de investigación, redacción y diseño al lienzo, y compila. Las campañas se generan y el análisis de audiencia se realiza de forma autónoma.
- **Empaquetado en un clic**: cuando tu equipo de Agents está listo, un solo clic genera un producto completo que cualquiera puede usar directamente.

## Tendencias de Stars

[![Star History Chart](https://api.star-history.com/svg?repos=Sh4r1ock/SoloEngine&type=Date)](https://star-history.com/#Sh4r1ock/SoloEngine&Date)

⭐ **Si SoloEngine te resulta útil, ¡regálanos una estrella! Cada una es un gran estímulo para nosotros.**

## Agradecimientos

Un agradecimiento especial a:

<p align="center">
  <a href="https://github.com/XiaomiMiMo"><img src="https://avatars.githubusercontent.com/u/208276378?v=4" alt="MiMo" height="40"/></a>
</p>

## Contribuciones

Nos encantaría contar contigo.

Ya sea una corrección ortográfica, un nuevo plugin de herramientas, una mejora en la documentación o una funcionalidad completa: cada contribución hace mejor a SoloEngine. Todos los PR son bienvenidos, sin importar su tamaño.

📝 [Guía de contribución](../../CONTRIBUTING.md) &nbsp;·&nbsp; 🐛 [Issues para empezar](https://github.com/Sh4r1ock/SoloEngine/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) &nbsp;·&nbsp; 📧 [sh4r1ock@qq.com](mailto:sh4r1ock@qq.com)

## Licencia

Apache License 2.0. Consulta la [LICENCIA](../../LICENSE).

---

<div align="center">

**El equipo de SoloEngine, creado con ❤️**

</div>