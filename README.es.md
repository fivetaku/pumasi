[English](README.md) | [한국어](README.ko.md) | [中文](README.zh.md) | [日本語](README.ja.md) | Español

# pumasi

<p align="center">
  <img src="assets/pumasi-hero-01.png" alt="pumasi" width="320">
</p>

> **Orquestación de código en paralelo — Claude como PM, Codex CLI como tu equipo de desarrollo.**

Delega la construcción en Codex. Reserva el pensamiento para Claude.

[Inicio rápido](#inicio-rápido) • [¿Por qué pumasi?](#por-qué-pumasi) • [Cómo funciona](#cómo-funciona) • [Características](#características) • [Requisitos](#requisitos)

---

## Inicio rápido

### 1. Añade el marketplace (una sola vez)

```
/plugin marketplace add https://github.com/fivetaku/gptaku_plugins.git
```

### 2. Instala

```
/plugin install pumasi
```

Reinicia Claude Code después de la instalación.

### 3. Instala los requisitos previos

```bash
# Codex CLI
npm install -g @openai/codex

# yaml dependency (one-time)
cd <plugin-dir>/skills/pumasi && npm install yaml
```

### 4. Ejecuta

```
/pumasi Build me a Todo app with auth, storage, and API
```

O actívalo con lenguaje natural: pumasi se pone en marcha automáticamente cuando detecta 3 o más módulos independientes.

---

## ¿Por qué pumasi?

- **Claude no escribe código** — Diseña interfaces, escribe firmas y define requisitos. La implementación real la hace Codex. Los tokens de Claude salen baratos.
- **N módulos en paralelo** — Tres módulos independientes tardan lo mismo que uno. Con cinco, la misma historia.
- **Validación a coste cero de tokens** — Cada tarea recibe una puerta de validación basada en bash (type-check, build, test). Las puertas se ejecutan sin consumir tokens de Claude.
- **Rondas conscientes de las dependencias** — Las tareas con dependencias se dividen en rondas. La Ronda 1 termina antes de que empiece la Ronda 2. Sin sorpresas al integrar.
- **Instrucciones pensadas para Codex** — Codex no infiere contexto. pumasi escribe rutas absolutas, firmas de funciones, imports obligatorios y restricciones estrictas en cada instrucción — pero nunca el cuerpo de la función.

---

## Cómo funciona

```
User request
    │
    ▼
Claude (PM) — plans, decomposes, writes signatures + requirements
    │
    ├──────────────────────────────────┐
    │                                  │
    ▼                                  ▼
Codex #1          Codex #2          Codex #3
(implements)      (implements)      (implements)
    │                 │                 │
    └─────────────────┴─────────────────┘
                      │
                      ▼
           Gate validation (bash, 0 tokens)
                      │
                      ▼
           Claude reviews + integrates
                      │
                      ▼
                   Done
```

### Flujo de trabajo en 7 fases

| Fase | Quién | Qué |
|-------|-----|------|
| 0. Planificar | Claude | Analiza la petición, diseña el modelo de datos, confirma el alcance con el usuario |
| 1. Descomponer | Claude | Divide el trabajo en subtareas paralelizables de forma independiente |
| 2. Configurar | Claude | Escribe firmas + requisitos + puertas en `pumasi.config.yaml` |
| 3. Ejecutar | pumasi.sh | Lanza N instancias de Codex en paralelo |
| 4. Monitorizar | pumasi.sh | Espera a que todos los workers terminen |
| 5. Validar | Claude | Ejecuta las puertas (tsc, build, test) y lee solo el código que falla |
| 6. Integrar | Claude + Codex | Verifica las interfaces entre tareas y redelega las correcciones a Codex |

---

## Características

### Separación de roles

| Rol | Claude | Codex |
|------|--------|-------|
| Análisis de requisitos | Sí | No |
| Diseño del modelo de datos | Sí | No |
| Firmas de funciones | Sí | No |
| Cuerpos de funciones | **Nunca** | Sí |
| Validación de puertas | Sí (las ejecuta) | No |
| Corrección de bugs | Delega | Implementa |

### Cuándo usar pumasi

| Nº de tareas | Recomendación |
|------------|----------------|
| 1–2 tareas | Claude programa directamente — la sobrecarga de pumasi no compensa |
| 3–4 tareas | pumasi opcional — la ganancia en paralelo compensa aproximadamente el coste de configuración |
| 5+ tareas | pumasi muy recomendado — la ganancia en paralelo es clara |

### Cuándo NO usar pumasi

- Corrección de bugs o cambios sobre código existente (la inyección de contexto se vuelve demasiado pesada)
- Trabajo en un solo archivo (sin beneficio del paralelismo)
- Tareas donde no se pueden definir puertas (ajuste fino de la estética de la UI, etc.)

### pumasi vs `/batch`

| | pumasi | /batch |
|--|--------|--------|
| **Propósito** | Construir N módulos nuevos e independientes en paralelo | Aplicar el mismo patrón de cambio a N archivos existentes |
| **Workers** | Codex CLI (tokens de Codex) | Agentes de Claude (tokens de Claude) |
| **Aislamiento** | Directorio de trabajo compartido | Aislamiento completo con un git worktree por agente |
| **Ideal para** | Auth + DB + API, cada uno desde cero | Migración jest→vitest, conversión CSS→Tailwind |

### Puertas de validación

```
Step 0: Install dependencies (npm install if node_modules missing)
Step 1: Run gates — tsc --noEmit → npm run build → npm test → grep checks
Step 2: Pass = read only Codex reports. Fail = read only failing code.
Step 3: Cross-task interface check (types, import paths)
```

### Gestión de dependencias por rondas

```
Round 1: Shared types / utilities   (N tasks in parallel)
Round 2: Tasks that depend on Round 1 (M tasks in parallel)
Round 3: Final integration          (Claude direct)
```

### Comandos

```bash
pumasi.sh start [--config path] "project context"
pumasi.sh status [JOB_DIR]
pumasi.sh status --text [JOB_DIR]
pumasi.sh wait [JOB_DIR]
pumasi.sh results [JOB_DIR]
pumasi.sh stop [JOB_DIR]
pumasi.sh clean [JOB_DIR]
```

### Disparadores

| Disparador | Descripción |
|---------|-------------|
| `/pumasi [task]` | Inicia el modo pumasi con la descripción de la tarea |
| `/pumasi` | Menú interactivo |
| "품앗이로 만들어줘" | Disparador en lenguaje natural |
| "codex 외주로" | Disparador en lenguaje natural |
| 3+ módulos independientes detectados | Se activa automáticamente |

---

## Requisitos

- CLI de [Claude Code](https://docs.anthropic.com/claude-code)
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`
- (opcional) [Grok CLI](https://docs.x.ai/build/overview) — `curl -fsSL https://x.ai/cli/install.sh | bash`
- Node.js 18+
- Clave de API de OpenAI (para Codex)

---

## Licencia

MIT

---

<div align="center">

**Claude piensa. Codex construye. Tú publicas.**

</div>
