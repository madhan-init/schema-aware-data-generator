import logging
import anthropic

logger = logging.getLogger(__name__)

PROMPT_TEMPLATE = """You are an expert SQL database designer. 
Given the following natural language description of a system, design a relational database schema.
Output ONLY valid SQL DDL statements (CREATE TABLE, etc.) for PostgreSQL.
Include primary keys, foreign keys, and appropriate data types.
Do NOT include any explanations, markdown blocks, or other text. Just the raw SQL statements.

Description:
{description}
"""

def generate_ddl_from_nlp(description: str) -> tuple[str, int]:
    """
    Takes a natural language description and returns a tuple containing:
    - The generated SQL DDL string
    - The number of tokens used
    """
    client = anthropic.Anthropic()
    
    prompt = PROMPT_TEMPLATE.format(description=description)
    
    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2048,
            temperature=0.2,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        content = response.content[0].text
        
        # Clean up any potential markdown blocks if Claude includes them despite instructions
        if "```sql" in content:
            content = content.split("```sql")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
            
        prompt_tokens = response.usage.input_tokens
        completion_tokens = response.usage.output_tokens
        total_tokens = prompt_tokens + completion_tokens
        
        logger.info(f"Generated DDL from NLP. Tokens used: {total_tokens}")
        
        return content, total_tokens
        
    except Exception as e:
        logger.error(f"Error generating DDL from NLP: {e}")
        raise
