import os
import json
import logging
import anthropic

logger = logging.getLogger(__name__)

CACHE_FILE = "mapper_cache.json"

PROMPT_TEMPLATE = """You are a data engineering assistant. Given the following table definition, 
map each column to the most appropriate Python Faker provider method.

Table: {table_name}
Columns:
{column_list}
Foreign Keys:
{fk_list}

Rules:
- Primary key columns: use `faker.unique.random_int(min=1, max=99999)`
- Foreign key columns: use the placeholder `FK:{{ref_table}}.{{ref_column}}` — do NOT generate a value
- Infer meaning from column names even if abbreviated (e.g., u_nm = username, addr = address, dob = date of birth)
- Return ONLY a valid JSON object mapping column name to a Faker call string. No explanation.

Example output:
{{
  "id": "faker.unique.random_int(min=1, max=99999)",
  "u_nm": "faker.user_name()",
  "email_addr": "faker.email()",
  "created_at": "faker.date_time_this_year().isoformat()"
}}
"""

def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}
    return {}

def save_cache(cache_data):
    with open(CACHE_FILE, "w") as f:
        json.dump(cache_data, f, indent=2)

def get_or_build_column_map(schema: dict) -> dict:
    """
    Takes the parsed schema dictionary and returns a mapping of 
    table_name -> { column_name -> faker_provider_string }
    """
    cache = load_cache()
    full_mapping = {}
    
    # In a real environment, you'd want to handle the API key securely.
    # Here we expect ANTHROPIC_API_KEY to be set in the environment.
    client = anthropic.Anthropic()
    
    schema_changed = False

    for table_name, table_data in schema.items():
        if table_name in cache:
            full_mapping[table_name] = cache[table_name]
            continue
            
        logger.info(f"Mapping columns for table '{table_name}' using LLM...")
        
        col_list_str = json.dumps(table_data["columns"], indent=2)
        fk_list_str = json.dumps(table_data["foreign_keys"], indent=2)
        
        prompt = PROMPT_TEMPLATE.format(
            table_name=table_name,
            column_list=col_list_str,
            fk_list=fk_list_str
        )
        
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001", # Fallback to a known model since the 2025 one might be hypothetical
                max_tokens=1024,
                temperature=0.0,
                messages=[
                    {"role": "user", "content": prompt}
                ]
            )
            
            # Parse the JSON out of the response
            # Sometimes Claude wraps it in ```json ... ``` blocks
            content = response.content[0].text
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
                
            mapping = json.loads(content)
            cache[table_name] = mapping
            full_mapping[table_name] = mapping
            schema_changed = True
            
        except Exception as e:
            logger.error(f"Error mapping table {table_name}: {e}")
            raise  # Do not fallback, halt execution
            
    if schema_changed:
        save_cache(cache)
        
    return full_mapping
