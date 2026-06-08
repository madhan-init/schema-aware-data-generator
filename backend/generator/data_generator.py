import random
import ast
from graphlib import TopologicalSorter
from faker import Faker

def build_order(schema: dict) -> list:
    """
    Returns a topologically sorted list of table names, 
    so parent tables are generated before child tables.
    """
    graph = {}
    for table, meta in schema.items():
        deps = {fk["ref_table"] for fk in meta["foreign_keys"]}
        graph[table] = deps
        
    ts = TopologicalSorter(graph)
    return list(ts.static_order())

def safe_eval_faker(faker_instance: Faker, expr: str):
    """
    Safely evaluates a faker expression string like "faker.unique.random_int(min=1, max=99999)"
    using Python's AST, avoiding the security risks of raw eval().
    """
    try:
        tree = ast.parse(expr, mode='eval').body
    except SyntaxError:
        # Fallback if the LLM generated something weird
        return faker_instance.word()

    def _eval(node):
        if isinstance(node, ast.Name):
            if node.id == 'faker':
                return faker_instance
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
        print(f"Failed to safely evaluate '{expr}': {e}. Falling back to faker.word().")
        return faker_instance.word()

def generate_data(schema: dict, column_map: dict, topo_order: list, num_rows: int = 20) -> dict:
    """
    Generates mock data for all tables in the correct order,
    resolving foreign keys to actual generated values.
    """
    faker = Faker()
    generated = {}  # table_name -> list of row dicts

    for table in topo_order:
        rows = []
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
                    
            rows.append(row)
        generated[table] = rows

    return generated
