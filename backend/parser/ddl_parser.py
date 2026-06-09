import sqlglot
from sqlglot import exp

def parse_ddl(ddl_string: str) -> dict:
    """
    Parses a DDL SQL string and returns a structured schema dictionary.
    """
    statements = sqlglot.parse(ddl_string)
    schema = {}

    for stmt in statements:
        if isinstance(stmt, exp.Create) and stmt.args.get("kind") == "TABLE":
            table_name = stmt.this.this.name
            schema[table_name] = {"columns": [], "foreign_keys": []}
            
            for element in stmt.this.expressions:
                if isinstance(element, exp.ColumnDef):
                    col_name = element.name
                    col_type = element.args.get("kind").sql()
                    
                    # Check for inline primary key
                    is_pk = False
                    for constraint in element.args.get("constraints", []):
                        if isinstance(constraint.args.get("kind"), exp.PrimaryKeyColumnConstraint):
                            is_pk = True
                            
                    schema[table_name]["columns"].append({
                        "name": col_name,
                        "type": col_type,
                        "primary_key": is_pk
                    })
                else:
                    fk_element = None
                    if isinstance(element, exp.ForeignKey):
                        fk_element = element
                    elif isinstance(element, exp.Constraint):
                        for expr in element.expressions:
                            if isinstance(expr, exp.ForeignKey):
                                fk_element = expr
                                break
                    
                    if fk_element is not None:
                        col_names = [e.name for e in fk_element.expressions]
                        
                        # Depending on sqlglot version, reference might be structured differently
                        ref_schema = fk_element.args.get("reference").this
                        if isinstance(ref_schema, exp.Schema):
                            ref_table = ref_schema.this.name
                            ref_cols = [e.name for e in ref_schema.expressions]
                        else:
                            ref_table = ref_schema.name
                            ref_cols = [e.name for e in fk_element.args.get("reference").expressions]
                        
                        for col_name, ref_col in zip(col_names, ref_cols):
                            schema[table_name]["foreign_keys"].append({
                                "column": col_name,
                                "ref_table": ref_table,
                                "ref_column": ref_col
                            })
    return schema

if __name__ == "__main__":
    import json
    import os
    
    # Simple test if run directly
    sample_path = os.path.join(os.path.dirname(__file__), "..", "schemas", "sample.sql")
    if os.path.exists(sample_path):
        with open(sample_path, "r") as f:
            ddl = f.read()
        parsed = parse_ddl(ddl)
        print(json.dumps(parsed, indent=2))