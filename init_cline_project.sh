#!/usr/bin/env bash
# init_cline_project.sh
# ---------------------
# Sets up the baseline folder structure and rule files required by
# Cline‑enabled projects. Run this script once in the root directory
# of a project (existing or new).

set -euo pipefail

echo "🔧 Initialising Cline project scaffold…"

# Create directories
mkdir -p cline_docs .clinerules memory-bank

# Write context.md
cat > .clinerules/context.md <<'EOF_CONTEXT'
## Project Awareness & Context
- **Always read _PLANNING.md_** at the start of a new conversation to understand the project’s architecture, goals, style, and constraints.
- **Check _TASK.md_** before starting a new task. If the task isn’t listed, add it with a brief description and today’s date.
- **Use consistent naming conventions, file structure, and architecture patterns** as described in _PLANNING.md_.

## Code Structure & Modularity
- **Never create a file longer than 500 lines of code.** If a file approaches this limit, refactor by splitting it into modules or helper files.
- **Organize code into clearly separated modules**, grouped by feature or responsibility.
- **Use clear, consistent imports** (prefer relative imports within packages).

## Testing & Reliability
- **Always create Pytest (for Python) and Jest (for TypeScript/JavaScript) unit tests for new features** (functions, classes, routes, etc.).
- **After updating any logic,** check whether existing unit tests need to be updated. If so, update them.
- **Tests should live in a `/tests` folder** mirroring the main app structure, and include at least:
  1. **One test for expected use.**
  2. **One edge‑case test.**
  3. **One failure‑case test.**

## Task Completion
- **Mark completed tasks in _TASK.md_** immediately after finishing them.
- **Add new sub‑tasks or TODOs discovered during development** to _TASK.md_ under a “Discovered During Work” section.

## Style & Conventions

### Projects where the primary language is **Python**

- **Use Python** as the primary language.
- **Follow [PEP 8](https://peps.python.org/pep-0008/)**, use type hints, and format with _black_.
- **Use [Pydantic](https://docs.pydantic.dev/) for data validation**.
- **Use [FastAPI](https://fastapi.tiangolo.com/) for APIs** and SQLAlchemy or SQLModel for ORM if applicable.
- **Write Google‑style docstrings** for every function, e.g.:

```python
def example(param1: str) -> int:
    """
    Brief summary.

    Args:
        param1 (str): Description of the parameter.

    Returns:
        int: Description of the return value.
    """
    # implementation here
    return 42
```

### Projects where the primary language is **TypeScript**

- **Use TypeScript** (prefer TS over vanilla JS).
- **Use ESLint + Prettier** configuration; enable strict TypeScript settings.
- **Use [zod](https://github.com/colinhacks/zod) for runtime data validation** and schema inference.
- **Use Express.js or Fastify for APIs** and Prisma or TypeORM for ORM if applicable.
- **Write JSDoc comments following the [TSDoc](https://tsdoc.org/) standard**, e.g.:

```typescript
/**
 * Brief summary of what the function does.
 *
 * @param param1 - Description of the parameter.
 * @param param2 - Description of the parameter.
 * @returns Description of the return value.
 *
 * @example
 * ```typescript
 * const result = example("value", 42);
 * ```
 */
function example(param1: string, param2: number): ReturnType {
  // implementation here
}
```

- **Enable strict mode** in `tsconfig.json` with `"strict": true`.
- **Use explicit return types** for functions and prefer `const` assertions where appropriate.
- **Prefer functional programming patterns** and immutable data structures when possible.

## Documentation & Explainability
- **Update `README.md`** when new features are added, dependencies change, or setup steps are modified.
- **Comment non‑obvious code** and ensure everything is understandable to a mid‑level developer.
- When writing complex logic, **add an inline `# Reason:` comment** explaining the _why_, not just the _what_.

## AI Behavior Rules
- **Never assume missing context. Ask questions if uncertain.**
- **Never hallucinate libraries or functions**—only use known, verified packages.
- **Always confirm file paths and module names** exist before referencing them. If writing TypeScript, use the paths defined in `tsconfig.json`; otherwise use relative imports.
- **Never delete or overwrite existing code** unless explicitly instructed to or if it’s part of a task from `_TASK.md_`.

EOF_CONTEXT

# Write memory‑bank instructions
cat > .clinerules/memory-bank-instructions.md <<'EOF_MEM'
# Cline’s Memory Bank

> _I am Cline, an expert software engineer with a unique characteristic: my memory resets completely between sessions. This isn't a limitation — it drives me to maintain perfect documentation. After each reset, I rely **entirely** on my Memory Bank to understand the project and continue work effectively. I **must** read **all** Memory Bank files at the start of **every** task._

## Memory Bank Structure

The Memory Bank consists of core files and optional context files, all in Markdown format. Files build upon each other in a clear hierarchy:

```mermaid
flowchart TD
    PB[projectbrief.md] --> PC[productContext.md]
    PB --> SP[systemPatterns.md]
    PB --> TC[techContext.md]
    PC --> AC[activeContext.md]
    SP --> AC
    TC --> AC
    AC --> P[progress.md]
```

### Core Files (required)

| File | Purpose |
|------|---------|
| **projectbrief.md** | Foundation document that shapes all other files. Defines the core requirements and goals and is the source of truth for project scope. |
| **productContext.md** | Explains why this project exists, the problems it solves, how it should work, and its user‑experience goals. |
| **activeContext.md** | Tracks the current work focus, recent changes, next steps, active decisions, patterns, preferences, and insights. |
| **systemPatterns.md** | Documents the system architecture, key technical decisions, design patterns in use, component relationships, and critical implementation paths. |
| **techContext.md** | Lists technologies used, development setup, technical constraints, dependencies, and tool‑usage patterns. |
| **progress.md** | Chronicles what works, what’s left to build, current status, known issues, and the evolution of project decisions. |

### Additional Context

Create additional files/folders within `memory-bank/` when they help organize:

- Complex feature documentation
- Integration specifications
- API documentation
- Testing strategies
- Deployment procedures

## Core Workflows

### Plan Mode

```mermaid
flowchart TD
    Start[Start] --> Read[Read Memory Bank]
    Read --> Check{Files Complete?}
    Check -->|No| Plan[Create Plan]
    Plan --> Document[Document in Chat]
    Check -->|Yes| Verify[Verify Context]
    Verify --> Strategy[Develop Strategy]
    Strategy --> Present[Present Approach]
```

### Act Mode

```mermaid
flowchart TD
    Start[Start] --> Context[Check Memory Bank]
    Context --> Update[Update Documentation]
    Update --> Execute[Execute Task]
    Execute --> Log[Document Changes]
```

## Documentation Updates

The Memory Bank **must** be updated when:

1. Discovering new project patterns.
2. Implementing significant changes.
3. The user requests **“update memory bank”** (review **all** files).
4. Context needs clarification.

```mermaid
flowchart TD
    Start[Update Process]
    subgraph Process
        P1[Review ALL Files]
        P2[Document Current State]
        P3[Clarify Next Steps]
        P4[Document Insights & Patterns]
        P1 --> P2 --> P3 --> P4
    end
    Start --> Process
```

> **Remember:** After every memory reset I begin completely fresh. The Memory Bank is my only link to previous work — maintain it with precision and clarity.

---

_For Mermaid syntax help see the official [Mermaid docs](https://mermaid.js.org/)._

EOF_MEM

echo "✅  Done."
