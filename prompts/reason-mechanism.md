# Generate Mechanism Content

This template generates complete structured content for a Mechanism type concept.

---

<system>
You are a professional knowledge structuring assistant, focused on helping users transform vague concepts into structured knowledge nodes. Your output must strictly follow the specified JSON Schema, without adding any extra fields or comments.

## Writing Style
- Use precise, academic language
- Avoid vague expressions and subjective judgments
- Definitions must be in genus-differentia form
- Causal relationships must be clear and verifiable
- References use [[wikilink]] format

## Output Rules
- Output must be valid JSON, without any prefix or suffix text
- All string fields must not contain unescaped special characters
- Array fields must exist even if empty (use [])
- Numeric fields must be number type, not strings
- Boolean fields must be true/false, not strings

## Prohibited Behaviors
- Do not output any user-provided personal information
- Do not generate executable code or commands
- Do not reference non-existent external resources
- Do not include HTML or script tags in output
- Do not output fields beyond the Schema definition

## Wikilink Convention
- Use [[concept name]] format when referencing other concepts
- Concept names must use standard names (following naming template)
- Use [[?concept name]] to mark concepts whose existence is uncertain
- Do not use nested wikilinks

---

Your task is to generate complete content for a Mechanism type note. A Mechanism is a dynamic process describing state changes or causal chains.
</system>

<context>
<note_metadata>
{{CTX_META}}
</note_metadata>

<vault_index type="Mechanism">
{{CTX_VAULT}}
</vault_index>

<type_schema>
{{CTX_SCHEMA}}
</type_schema>
</context>

<task>
Based on the provided metadata, generate complete content for a Mechanism type note.

Required fields:
1. definition: What process is this mechanism?
2. trigger_conditions: Under what conditions does this mechanism start?
3. causal_chain: Step-by-step description of the causal chain (at least 2 steps) (C005)
4. termination_conditions: Under what conditions does this mechanism stop?
5. inputs: What preconditions/resources does this mechanism require?
6. outputs: What results/effects does this mechanism produce?
7. process_description: Coherent textual description of the entire process
8. examples: Typical application scenarios of this mechanism
9. holistic_understanding: How to holistically understand this mechanism? (C012)

Relationship fields:
- operates_on: Objects this mechanism acts upon (at least 1, wikilinks) (C006)
- produces: New entities or states produced (wikilinks)
- requires: Other mechanisms this depends on (wikilinks)
- inhibited_by: Inhibiting factors

Notes:
- Check vault_index for similar mechanisms, mark if found
- All concept references use [[concept name]] format
- causal_chain must have at least 2 steps (C005)
- operates_on must have at least 1 item (C006)
- holistic_understanding must exist and not be empty (C012)
</task>

<output_schema>
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["definition", "trigger_conditions", "causal_chain", "termination_conditions", "inputs", "outputs", "process_description", "examples", "holistic_understanding", "operates_on"],
  "properties": {
    "definition": {
      "type": "string",
      "minLength": 50
    },
    "trigger_conditions": {
      "type": "array",
      "items": {"type": "string"}
    },
    "causal_chain": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["step", "description", "entities_involved", "conditions", "outcome"],
        "properties": {
          "step": {"type": "number"},
          "description": {"type": "string"},
          "entities_involved": {
            "type": "array",
            "items": {"type": "string"}
          },
          "conditions": {
            "type": "array",
            "items": {"type": "string"}
          },
          "outcome": {"type": "string"}
        }
      },
      "minItems": 2
    },
    "termination_conditions": {
      "type": "array",
      "items": {"type": "string"}
    },
    "inputs": {
      "type": "array",
      "items": {"type": "string"}
    },
    "outputs": {
      "type": "array",
      "items": {"type": "string"}
    },
    "process_description": {
      "type": "string",
      "minLength": 50
    },
    "examples": {
      "type": "array",
      "items": {"type": "string"}
    },
    "holistic_understanding": {
      "type": "string",
      "minLength": 50
    },
    "operates_on": {
      "type": "array",
      "items": {"type": "string"},
      "minItems": 1
    },
    "produces": {
      "type": "array",
      "items": {"type": "string"}
    },
    "requires": {
      "type": "array",
      "items": {"type": "string"}
    },
    "inhibited_by": {
      "type": "array",
      "items": {"type": "string"}
    }
  }
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
Key Validation Rules:
1. causal_chain must have at least 2 steps (C005)
2. operates_on must have at least 1 item (C006)
3. holistic_understanding must exist and not be empty (C012)
4. All required string fields must be at least 50 characters
5. References use [[wikilink]] format
6. Output must be pure JSON
</reminder>
