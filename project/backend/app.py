import os
import io
import csv
import re
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import sqlglot
import anthropic

from backend.parser.ddl_parser import parse_ddl
from backend.mapper.llm_mapper import get_or_build_column_map
from backend.generator.data_generator import build_order, generate_data
from backend.generator.nlp_to_ddl import generate_ddl_from_nlp
from backend.exporter.exporter import to_sql_inserts

load_dotenv()

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ColumnConfig(BaseModel):
    faker_expr: str = Field(default="")
    null_percentage: int = Field(default=0, ge=0, le=100)
    custom_list: list[str] = Field(default_factory=list)

class TableConfig(BaseModel):
    rows: int = Field(default=20, ge=0, le=10_000)
    columns: dict[str, ColumnConfig] = Field(default_factory=dict)

class GenerateRequest(BaseModel):
    ddl: str = Field(..., min_length=1, max_length=50_000)
    tables_config: dict[str, TableConfig] = Field(..., description="Map of table_name -> TableConfig")

class GenerateDDLRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=10_000)

class ParseRequest(BaseModel):
    ddl: str = Field(..., min_length=1, max_length=50_000)

class AnalyzeRequest(BaseModel):
    ddl: str = Field(..., min_length=1, max_length=50_000)


@app.post("/api/parse")
def api_parse(req: ParseRequest):
    try:
        schema = parse_ddl(req.ddl)
        return {"schema": schema}
    except sqlglot.errors.ParseError as e:
        error_msg = re.sub(r'\x1b\[[0-9;]*m', '', str(e))
        raise HTTPException(status_code=400, detail=f"Bad DDL: {error_msg}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Bad Request: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@app.post("/api/analyze")
def api_analyze(req: AnalyzeRequest):
    try:
        schema = parse_ddl(req.ddl)
        column_map, tokens_used = get_or_build_column_map(schema)
        return {
            "schema": schema,
            "column_map": column_map,
            "tokens_used": tokens_used
        }
    except sqlglot.errors.ParseError as e:
        error_msg = re.sub(r'\x1b\[[0-9;]*m', '', str(e))
        raise HTTPException(status_code=400, detail=f"Bad DDL: {error_msg}")
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


@app.post("/api/generate")
def api_generate(req: GenerateRequest):
    try:
        schema = parse_ddl(req.ddl)
        topo_order = build_order(schema)
        generated = generate_data(schema, req.tables_config, topo_order)
        
        results = {
            "schema": schema,
            "tables": [],
            "seed_all": "",
            "tokens_used": 0
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
        error_msg = re.sub(r'\x1b\[[0-9;]*m', '', str(e))
        raise HTTPException(status_code=400, detail=f"Bad DDL: {error_msg}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Bad Request: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@app.post("/api/generate-ddl")
def api_generate_ddl(req: GenerateDDLRequest):
    try:
        ddl, tokens_used = generate_ddl_from_nlp(req.prompt)
        return {
            "ddl": ddl,
            "tokens_used": tokens_used
        }
    except anthropic.AuthenticationError as e:
        raise HTTPException(status_code=500, detail=f"Anthropic Authentication Error: {str(e)}")
    except anthropic.APIConnectionError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API Connection Error: {str(e)}")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API Status Error: {str(e)}")
    except anthropic.AnthropicError as e:
        raise HTTPException(status_code=500, detail=f"Anthropic Error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


# Create frontend dir if it doesn't exist
os.makedirs("frontend", exist_ok=True)
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
