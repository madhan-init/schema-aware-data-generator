# Schema-Aware Test Data Generator — Project Plan

## Overview

A CLI tool that reads a SQL DDL file, uses an LLM to understand column semantics, and uses Faker to generate referentially-consistent mock data. Outputs `.sql` insert scripts and `.csv` files.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | Python 3.11+ | Best ecosystem for this task |
| DDL Parsing | `sqlglot` | Robust, dialect-aware SQL parser |
| Data Generation | `Faker` | Rich provider library |
| LLM Integration | `anthropic` SDK (claude-sonnet-4-20250514) | Column semantic mapping |
| Graph/Topology | `graphlib` (stdlib) | Topological sort for FK ordering |
| Output | `csv` (stdlib) + string templating | SQL inserts + CSV export |
| CLI | `argparse` or `click` | Simple entry point |

Install all deps:
```bash
pip install sqlglot faker anthropic click
```

---

## Project Structure

```
schema-datagen/
├── plan.md                  # this file
├── main.py                  # CLI entry point
├── parser/
│   ├── __init__.py
│   └── ddl_parser.py        # Parse DDL → schema graph
├── mapper/
│   ├── __init__.py
│   └── llm_mapper.py        # LLM: column name → Faker provider
├── generator/
│   ├── __init__.py
│   └── data_generator.py    # Topological generation engine
├── exporter/
│   ├── __init__.py
│   └── exporter.py          # Write .sql and .csv files
├── schemas/
│   └── sample.sql           # Your test DDL file
└── output/                  # Generated files land here
```

---

## Implementation Phases

### Phase 1 — DDL Parser (`parser/ddl_parser.py`)

**Goal:** Read a `.sql` file and produce a structured schema dictionary.

**Output data structure:**
```python
{
  "users": {
    "columns": [
      {"name": "id", "type": "INT", "primary_key": True},
      {"name": "email", "type": "VARCHAR(255)", "primary_key": False},
    ],
    "foreign_keys": []
  },
  "posts": {
    "columns": [
      {"name": "id", "type": "INT", "primary_key": True},
      {"name": "user_id", "type": "INT", "primary_key": False},
      {"name": "title", "type": "VARCHAR(255)", "primary_key": False},
    ],
    "foreign_keys": [
      {"column": "user_id", "ref_table": "users", "ref_column": "id"}
    ]
  }
}
```

**Steps:**
1. Use `sqlglot.parse()` to parse the DDL file.
2. Walk the AST for `CREATE TABLE` statements.
3. For each table, extract: column names, data types, `PRIMARY KEY` constraints, `FOREIGN KEY ... REFERENCES` constraints.
4. Return the schema dict.

**Test:** Parse `schemas/sample.sql` with two linked tables and print the dict.

---

### Phase 2 — Sample DDL (`schemas/sample.sql`)

Start with this minimal schema to validate your parser before scaling:

```sql
CREATE TABLE users (
    id          INT PRIMARY KEY,
    u_nm        VARCHAR(100) NOT NULL,
    email_addr  VARCHAR(255) UNIQUE NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
    id          INT PRIMARY KEY,
    user_id     INT NOT NULL,
    title       VARCHAR(255) NOT NULL,
    body        TEXT,
    published   BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE comments (
    id          INT PRIMARY KEY,
    post_id     INT NOT NULL,
    user_id     INT NOT NULL,
    content     TEXT,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

This tests: aliased column names (`u_nm`), multi-level FK chains (`comments` depends on both `posts` and `users`), and varied data types.

---

### Phase 3 — LLM Column Mapper (`mapper/llm_mapper.py`)

**Goal:** For each table, send column definitions to the LLM and get back a mapping of `column_name → Faker provider call`.

**Prompt template:**
```
You are a data engineering assistant. Given the following table definition, 
map each column to the most appropriate Python Faker provider method.

Table: {table_name}
Columns:
{column_list}

Rules:
- Primary key columns: use `faker.unique.random_int(min=1, max=99999)`
- Foreign key columns: use the placeholder `FK:{ref_table}.{ref_column}` — do NOT generate a value
- Infer meaning from column names even if abbreviated (e.g., u_nm = username, addr = address, dob = date of birth)
- Return ONLY a valid JSON object mapping column name to a Faker call string. No explanation.

Example output:
{
  "id": "faker.unique.random_int(min=1, max=99999)",
  "u_nm": "faker.user_name()",
  "email_addr": "faker.email()",
  "created_at": "faker.date_time_this_year().isoformat()"
}
```

**Steps:**
1. For each table in the schema, format the prompt.
2. Call `anthropic.messages.create(...)` with the prompt.
3. Parse the JSON response.
4. Cache results to avoid redundant LLM calls on re-runs (save to a `mapper_cache.json`).

**Important:** FK columns must be flagged as `FK:ref_table.ref_col` — the generator will resolve these at runtime from already-generated data, not from Faker.

---

### Phase 4 — Topological Sort & Generation Engine (`generator/data_generator.py`)

**Goal:** Generate rows in the correct dependency order so FK values always reference existing rows.

**Topological sort:**
```python
from graphlib import TopologicalSorter

def build_order(schema):
    graph = {}
    for table, meta in schema.items():
        deps = {fk["ref_table"] for fk in meta["foreign_keys"]}
        graph[table] = deps
    ts = TopologicalSorter(graph)
    return list(ts.static_order())  # e.g. ["users", "posts", "comments"]
```

**Generation loop:**
```python
generated = {}  # table_name → list of row dicts

for table in topo_order:
    rows = []
    pk_pool = []
    for i in range(num_rows):
        row = {}
        for col, faker_expr in column_map[table].items():
            if faker_expr.startswith("FK:"):
                _, ref = faker_expr.split("FK:")
                ref_table, ref_col = ref.split(".")
                # Pick a random already-generated value
                row[col] = random.choice(generated[ref_table])[ref_col]
            else:
                row[col] = eval(faker_expr)  # or safer: use a dispatch dict
        rows.append(row)
    generated[table] = rows
```

> **Security note for your agent:** Replace `eval()` with a safe dispatcher dict that maps known Faker method strings to actual callables. This avoids arbitrary code execution.

**Config:** Accept a `--rows N` CLI argument (default: 20 rows per table).

---

### Phase 5 — Exporter (`exporter/exporter.py`)

**Goal:** Write `output/{table}.sql` and `output/{table}.csv` for each table.

**SQL insert format:**
```python
def to_sql_inserts(table_name, rows, schema):
    lines = [f"-- {table_name}"]
    for row in rows:
        cols = ", ".join(row.keys())
        vals = ", ".join(
            f"'{v}'" if isinstance(v, str) else str(v)
            for v in row.values()
        )
        lines.append(f"INSERT INTO {table_name} ({cols}) VALUES ({vals});")
    return "\n".join(lines)
```

**CSV export:** Use `csv.DictWriter` with the column names as headers.

**Combined output:** Also write a single `output/seed_all.sql` that contains all tables in topological order, ready to run as one script.

---

### Phase 6 — CLI Entry Point (`main.py`)

```python
# Usage:
# python main.py --ddl schemas/sample.sql --rows 50 --output output/

import click

@click.command()
@click.option("--ddl", required=True, help="Path to DDL .sql file")
@click.option("--rows", default=20, help="Rows to generate per table")
@click.option("--output", default="output/", help="Output directory")
def run(ddl, rows, output):
    schema = parse_ddl(ddl)
    column_map = get_or_build_column_map(schema)   # LLM mapper with cache
    topo_order = build_order(schema)
    generated = generate_data(schema, column_map, topo_order, rows)
    export(generated, schema, topo_order, output)
    click.echo(f"Done. Files written to {output}")
```

---

## Build Order (Recommended Sequence for Your Agent)

1. `schemas/sample.sql` — write the test schema first
2. `parser/ddl_parser.py` — get structured schema dict working, print and verify
3. `mapper/llm_mapper.py` — LLM mapping + cache; verify FK columns are flagged correctly
4. `generator/data_generator.py` — topological sort first, then generation loop
5. `exporter/exporter.py` — SQL inserts + CSV
6. `main.py` — wire everything together via CLI
7. End-to-end test with `sample.sql`, then try a 5-table schema

---

## Key Edge Cases to Handle

| Case | How to Handle |
|---|---|
| Circular FK references | Detect cycle in `graphlib`, raise a clear error |
| Nullable FK columns | Allow `NULL` with a configurable null-rate (e.g. 10%) |
| Composite primary keys | Track as tuple in `pk_pool` |
| `UNIQUE` constraints on non-PK cols | Use `faker.unique.*` providers |
| LLM returns invalid JSON | Retry once; fall back to `faker.word()` for unknown columns |
| Large schemas (20+ tables) | Batch LLM calls by table; use cache aggressively |

---

## Definition of Done

- [ ] Parses a multi-table DDL with FK relationships correctly
- [ ] LLM correctly maps abbreviated column names (`u_nm`, `dob`, `addr`) to Faker providers
- [ ] Generated data has zero FK violations (all child FKs exist in parent tables)
- [ ] Outputs valid `.sql` insert scripts that run without errors on a fresh DB
- [ ] Outputs `.csv` files per table
- [ ] CLI works end-to-end: `python main.py --ddl schemas/sample.sql --rows 50`
