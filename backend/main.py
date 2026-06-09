import os
import sys

# Add the root project directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging

import click
from dotenv import load_dotenv
from backend.parser.ddl_parser import parse_ddl
from backend.mapper.llm_mapper import get_or_build_column_map
from backend.generator.data_generator import build_order, generate_data
from backend.exporter.exporter import export_data

load_dotenv()

@click.command()
@click.option("--ddl", required=True, type=click.Path(exists=True), help="Path to DDL .sql file")
@click.option("--rows", default=20, type=int, help="Number of rows to generate per table")
@click.option("--output", default="output/", type=click.Path(), help="Output directory for generated files")
def run(ddl, rows, output):
    """
    Schema-Aware Test Data Generator
    Parses a DDL file, uses LLMs to map Faker functions, and generates referentially intact data.
    """
    click.echo(f"[*] Parsing DDL from {ddl}...")
    with open(ddl, "r") as f:
        ddl_content = f.read()
    schema = parse_ddl(ddl_content)
    
    click.echo(f"[*] Extracting schema and mapping columns...")
    column_map, tokens_used = get_or_build_column_map(schema)
    
    click.echo(f"[*] Resolving topological dependencies...")
    topo_order = build_order(schema)
    click.echo(f"    Order: {' -> '.join(topo_order)}")
    
    click.echo(f"[*] Generating {rows} rows per table...")
    generated = generate_data(schema, column_map, topo_order, num_rows=rows)
    
    click.echo(f"[*] Exporting to SQL and CSV...")
    export_data(generated, topo_order, output)
    
    click.echo(click.style(f"[+] Success! Check the '{output}' directory.", fg="green"))

if __name__ == "__main__":
    run()
