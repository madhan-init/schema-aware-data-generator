import random
import ast
from graphlib import TopologicalSorter, CycleError
from faker import Faker

def build_order(schema: dict) -> list:
    """
    Returns a topologically sorted list of table names, 
    so parent tables are generated before child tables.
    """
    graph = {}
    for table, meta in schema.items():
        # Exclude self-references to avoid trivial CycleErrors
        deps = {fk["ref_table"] for fk in meta["foreign_keys"] if fk["ref_table"] != table}
        graph[table] = deps
        
    while True:
        try:
            ts = TopologicalSorter(graph)
            return list(ts.static_order())
        except CycleError as e:
            # e.args[1] is a tuple representing the cycle (e.g., A -> B -> C -> A)
            cycle = e.args[1]
            if len(cycle) >= 2:
                node_with_dep = cycle[0]
                dep_to_remove = cycle[1]
                if dep_to_remove in graph.get(node_with_dep, set()):
                    graph[node_with_dep].remove(dep_to_remove)
                else:
                    # Fallback if format differs, remove an arbitrary edge in the cycle
                    for n in cycle:
                        if graph.get(n):
                            graph[n].pop()
                            break
            else:
                # Fallback, just pick a node and clear a dependency
                for n in graph:
                    if graph[n]:
                        graph[n].pop()
                        break

def safe_eval_faker(faker_instance: Faker, expr: str):
    """
    Safely evaluates a faker expression string like "faker.unique.random_int(min=1, max=99999)"
    using Python's AST, avoiding the security risks of raw eval().
    """
    try:
        tree = ast.parse(expr, mode='eval').body
    except SyntaxError as e:
        raise ValueError(f"Invalid faker expression from LLM: '{expr}'. Syntax error: {e}")

    def _eval(node):
        if isinstance(node, ast.Name):
            if node.id == 'faker':
                return faker_instance
            if node.id in ('true', 'True'):
                return True
            if node.id in ('false', 'False'):
                return False
            if node.id in ('null', 'None'):
                return None
            raise ValueError(f"Unknown name: {node.id}")
        elif isinstance(node, ast.Attribute):
            obj = _eval(node.value)
            return getattr(obj, node.attr)
        elif isinstance(node, ast.Call):
            func = _eval(node.func)
            args = [_eval(a) for a in node.args]
            kwargs = {kw.arg: _eval(kw.value) for kw in node.keywords}
            return func(*args, **kwargs)
        elif isinstance(node, ast.Constant):
            return node.value
        else:
            raise ValueError(f"Unsupported AST node: {type(node)}")

    try:
        return _eval(tree)
    except Exception as e:
        raise ValueError(f"Failed to evaluate faker expression '{expr}': {e}")

def generate_data(schema: dict, tables_config: dict, topo_order: list) -> dict:
    """
    Generates mock data for all tables in the correct order,
    taking custom configuration for rows, null values, and custom value lists.
    """
    faker = Faker()
    generated = {}  # table_name -> list of row dicts

    # Initialize all tables in generated so self-references can append incrementally
    for table in topo_order:
        generated[table] = []

    for table in topo_order:
        table_cfg = tables_config.get(table, {})
        
        # Accept either a dict or a TableConfig object/model (FastAPI parses to dict or Pydantic model)
        if hasattr(table_cfg, "dict"):
            table_cfg = table_cfg.dict()
        elif not isinstance(table_cfg, dict):
            table_cfg = {}
            
        num_rows = table_cfg.get("rows", 20)
        columns_cfg = table_cfg.get("columns", {})

        for _ in range(num_rows):
            row = {}
            for col_def in schema[table]["columns"]:
                col_name = col_def["name"]
                is_unique = col_def.get("unique", False)
                is_pk = col_def.get("primary_key", False)
                
                col_cfg = columns_cfg.get(col_name, {})
                if hasattr(col_cfg, "dict"):
                    col_cfg = col_cfg.dict()
                elif not isinstance(col_cfg, dict):
                    col_cfg = {}
                
                faker_expr = col_cfg.get("faker_expr", "")
                null_percentage = col_cfg.get("null_percentage", 0)
                custom_list = col_cfg.get("custom_list", [])

                # 1. Null probability check (skip for PKs and FKs)
                is_fk = faker_expr.startswith("FK:")
                if not is_pk and not is_fk and null_percentage > 0 and random.randint(1, 100) <= null_percentage:
                    row[col_name] = None
                    continue

                # 2. Check for custom lists
                if custom_list and len(custom_list) > 0:
                    if is_unique:
                        # Attempt to generate unique value
                        existing_values = {r[col_name] for r in generated[table] if col_name in r}
                        val = None
                        for _ in range(100):
                            temp_val = random.choice(custom_list)
                            if temp_val not in existing_values:
                                val = temp_val
                                break
                        if val is None:
                            val = random.choice(custom_list) # fallback
                        row[col_name] = val
                    else:
                        row[col_name] = random.choice(custom_list)
                    continue

                # 3. Check for foreign keys
                if is_fk:
                    _, ref = faker_expr.split("FK:")
                    ref_table, ref_col = ref.split(".")
                    
                    if ref_table not in generated or not generated[ref_table]:
                        row[col_name] = None
                    else:
                        parent_row = random.choice(generated[ref_table])
                        row[col_name] = parent_row[ref_col]
                    continue

                # 4. Standard Faker generation with UNIQUE constraint retry check
                if faker_expr:
                    if is_unique:
                        existing_values = {r[col_name] for r in generated[table] if col_name in r}
                        val = None
                        for _ in range(100):
                            temp_val = safe_eval_faker(faker, faker_expr)
                            if temp_val not in existing_values:
                                val = temp_val
                                break
                        if val is None:
                            val = safe_eval_faker(faker, faker_expr)
                        row[col_name] = val
                    else:
                        row[col_name] = safe_eval_faker(faker, faker_expr)
                else:
                    row[col_name] = None

            generated[table].append(row)

    # Second pass to patch cyclic FKs that were resolved to None
    for table in topo_order:
        table_cfg = tables_config.get(table, {})
        if hasattr(table_cfg, "dict"):
            table_cfg = table_cfg.dict()
        elif not isinstance(table_cfg, dict):
            table_cfg = {}
        columns_cfg = table_cfg.get("columns", {})

        for row in generated[table]:
            for col_def in schema[table]["columns"]:
                col_name = col_def["name"]
                col_cfg = columns_cfg.get(col_name, {})
                if hasattr(col_cfg, "dict"):
                    col_cfg = col_cfg.dict()
                elif not isinstance(col_cfg, dict):
                    col_cfg = {}

                faker_expr = col_cfg.get("faker_expr", "")
                if faker_expr.startswith("FK:") and row.get(col_name) is None:
                    _, ref = faker_expr.split("FK:")
                    ref_table, ref_col = ref.split(".")
                    if ref_table in generated and generated[ref_table]:
                        parent_row = random.choice(generated[ref_table])
                        row[col_name] = parent_row[ref_col]

    return generated
