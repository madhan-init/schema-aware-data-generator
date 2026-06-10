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

def generate_data(schema: dict, column_map: dict, topo_order: list, num_rows: int = 20) -> dict:
    """
    Generates mock data for all tables in the correct order,
    resolving foreign keys to actual generated values.
    """
    faker = Faker()
    generated = {}  # table_name -> list of row dicts

    # Initialize all tables in generated so self-references can append incrementally
    for table in topo_order:
        generated[table] = []

    for table in topo_order:
        for _ in range(num_rows):
            row = {}
            for col, faker_expr in column_map.get(table, {}).items():
                if faker_expr.startswith("FK:"):
                    # Resolve FK
                    _, ref = faker_expr.split("FK:")
                    ref_table, ref_col = ref.split(".")
                    
                    if ref_table not in generated or not generated[ref_table]:
                        # Fallback if parent table data isn't available (e.g. cycles or bad schema)
                        row[col] = None
                    else:
                        # Pick a random already-generated row from the referenced table
                        parent_row = random.choice(generated[ref_table])
                        row[col] = parent_row[ref_col]
                else:
                    # Generate value using safe evaluator
                    row[col] = safe_eval_faker(faker, faker_expr)
                    
            generated[table].append(row)

    # Second pass to patch cyclic FKs that were resolved to None
    for table in topo_order:
        for row in generated[table]:
            for col, faker_expr in column_map.get(table, {}).items():
                if faker_expr.startswith("FK:") and row[col] is None:
                    _, ref = faker_expr.split("FK:")
                    ref_table, ref_col = ref.split(".")
                    if ref_table in generated and generated[ref_table]:
                        parent_row = random.choice(generated[ref_table])
                        row[col] = parent_row[ref_col]

    return generated
