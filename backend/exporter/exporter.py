import os
import csv
import logging

logger = logging.getLogger(__name__)

def format_sql_value(v):
    if v is None:
        return "NULL"
    elif isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    elif isinstance(v, (int, float)):
        return str(v)
    else:
        # Escape single quotes for SQL
        escaped_str = str(v).replace("'", "''")
        return f"'{escaped_str}'"

def to_sql_inserts(table_name: str, rows: list) -> str:
    if not rows:
        return f"-- {table_name} (0 rows)\n"
        
    lines = [f"-- Data for {table_name}"]
    for row in rows:
        cols = ", ".join(row.keys())
        vals = ", ".join(format_sql_value(v) for v in row.values())
        lines.append(f"INSERT INTO {table_name} ({cols}) VALUES ({vals});")
    return "\n".join(lines)

def export_data(generated_data: dict, topo_order: list, output_dir: str):
    """
    Writes .csv and .sql files for each table, plus a combined seed_all.sql file.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    combined_sql_lines = []
    
    for table_name in topo_order:
        rows = generated_data.get(table_name, [])
        if not rows:
            continue
            
        # 1. Write individual SQL file
        sql_content = to_sql_inserts(table_name, rows)
        sql_path = os.path.join(output_dir, f"{table_name}.sql")
        with open(sql_path, "w") as f:
            f.write(sql_content + "\n")
            
        # Add to combined SQL
        combined_sql_lines.append(sql_content)
        combined_sql_lines.append("") # blank line between tables
        
        # 2. Write individual CSV file
        csv_path = os.path.join(output_dir, f"{table_name}.csv")
        with open(csv_path, "w", newline='') as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            # Replace None with empty string for CSV output
            for row in rows:
                csv_row = {k: ("" if v is None else v) for k, v in row.items()}
                writer.writerow(csv_row)
                
    # 3. Write combined SQL file
    combined_sql_path = os.path.join(output_dir, "seed_all.sql")
    with open(combined_sql_path, "w") as f:
        f.write("\n".join(combined_sql_lines))
        
    logger.info(f"Export completed successfully. Files written to '{output_dir}'.")
