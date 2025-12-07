# Generate Theory Content

This template generates complete structured content for a Theory type concept.

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

Your task is to generate complete content for a Theory type note. A Theory is a deducible axiomatic system starting from axioms.
</system>

<context>
<note_metadata>
{{CTX_META}}
</note_metadata>

<vault_index type="Theory">
{{CTX_VAULT}}
</vault_index>

<type_schema>
{{CTX_SCHEMA}}
</type_schema>
</context>

<task>
Based on the provided metadata, generate complete content for a Theory type note.

Required fields:
1. axioms: Self-evident foundational assumptions (at least 1) (C003, C004)
2. argument_chain: Complete derivation from axioms to conclusions (at least 1 step) (C014)
3. core_predictions: Testable predictions made by this theory
4. scope_and_applicability: Under what conditions is this theory valid?
5. limitations: Known defects, phenomena that cannot be explained
6. historical_development: Creation, evolution, and revision history of this theory
7. extracted_components: Entities and mechanisms defined/described by this theory (C015)
8. holistic_understanding: How to holistically understand this theory? (C012)

Notes:
- Check vault_index for similar theories, mark if found
- All concept references use [[wikilink]] format
- axioms array must have at least 1 item (C003)
- Each axiom must include statement and justification (C004)
- argument_chain must have at least 1 step (C014)
- extracted_components must include entities and mechanisms arrays (C015)
- holistic_understanding must exist and not be empty (C012)
</task>

<output_schema>
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["axioms", "argument_chain", "core_predictions", "scope_and_applicability", "limitations", "historical_development", "extracted_components", "holistic_understanding"],
  "properties": {
    "axioms": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["statement", "justification"],
        "properties": {
          "statement": {"type": "string"},
          "justification": {"type": "string"},
          "source": {"type": "string"}
        }
      },
      "minItems": 1
    },
    "argument_chain": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["step", "claim", "reasoning", "premises"],
        "properties": {
          "step": {"type": "number"},
          "claim": {"type": "string"},
          "reasoning": {"type": "string"},
          "premises": {
            "type": "array",
            "items": {"type": "string"}
          }
        }
      },
      "minItems": 1
    },
    "core_predictions": {
      "type": "array",
      "items": {"type": "string"}
    },
    "scope_and_applicability": {
      "type": "string",
      "minLength": 50
    },
    "limitations": {
      "type": "array",
      "items": {"type": "string"}
    },
    "historical_development": {
      "type": "string",
      "minLength": 50
    },
    "extracted_components": {
      "type": "object",
      "required": ["entities", "mechanisms"],
      "properties": {
        "entities": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "role"],
            "properties": {
              "name": {"type": "string"},
              "role": {"type": "string"}
            }
          }
        },
        "mechanisms": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "role"],
            "properties": {
              "name": {"type": "string"},
              "role": {"type": "string"}
            }
          }
        }
      }
    },
    "holistic_understanding": {
      "type": "string",
      "minLength": 50
    }
  }
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
Key Validation Rules:
1. axioms array must have at least 1 item (C003)
2. Each axiom must include statement and justification (C004)
3. argument_chain must have at least 1 step (C014)
4. extracted_components must include entities and mechanisms arrays (C015)
5. holistic_understanding must exist and not be empty (C012)
6. All required string fields must be at least 50 characters
7. References use [[wikilink]] format
8. Output must be pure JSON
</reminder>
