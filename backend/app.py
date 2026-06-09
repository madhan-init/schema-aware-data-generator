import os
import io
import csv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import sqlglot
import anthropic

from backend.parser.ddl_parser import parse_ddl
from backend.mapper.llm_mapper import get_or_build_column_map
from backend.generator.data_generator import build_order, generate_data
from backend.exporter.exporter import to_sql_inserts

load_dotenv()

app = FastAPI()

class GenerateRequest(BaseModel):
    ddl: str = Field(..., min_length=1, max_length=50_000)
    rows: int = Field(default=20, ge=1, le=10_000)

@app.post("/api/generate")
def api_generate(req: GenerateRequest):
    try:
        schema = parse_ddl(req.ddl)
        column_map = get_or_build_column_map(schema)
        topo_order = build_order(schema)
        generated = generate_data(schema, column_map, topo_order, num_rows=req.rows)
        
        results = {
            "tables": [],
            "seed_all": ""
        }
        
        combined_sql = []
        
        for table_name in topo_order:
            rows = generated.get(table_name, [])
            if not rows:
                continue
            
            # SQL
            sql_str = to_sql_inserts(table_name, rows)
            combined_sql.append(sql_str)
            combined_sql.append("")
            
            # CSV
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            for row in rows:
                writer.writerow({k: ("" if v is None else v) for k, v in row.items()})
            csv_str = output.getvalue()
            
            results["tables"].append({
                "name": table_name,
                "sql": sql_str,
                "csv": csv_str,
                "data": rows
            })
            
        results["seed_all"] = "\n".join(combined_sql)
        return results
    except sqlglot.errors.ParseError as e:
        raise HTTPException(status_code=400, detail=f"Bad DDL: {str(e)}")
    except anthropic.AuthenticationError as e:
        raise HTTPException(status_code=500, detail=f"Anthropic Authentication Error: {str(e)}")
    except anthropic.APIConnectionError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API Connection Error: {str(e)}")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API Status Error: {str(e)}")
    except anthropic.AnthropicError as e:
        raise HTTPException(status_code=500, detail=f"Anthropic Error: {str(e)}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Bad Request: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

# Create frontend dir if it doesn't exist
os.makedirs("frontend", exist_ok=True)
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
