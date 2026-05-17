export interface ValidationRule {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  patternMessage?: string;
}

export interface InputValidationError {
  inputName: string;
  message: string;
  rule: string;
}

export function validateInputs(
  inputs: Array<{
    name: string;
    type: string;
    required?: boolean;
    validation?: ValidationRule;
  }>,
  values: Record<string, unknown>
): InputValidationError[] {
  const errors: InputValidationError[] = [];

  for (const input of inputs) {
    const value = values[input.name];

    if (input.required && (value === undefined || value === null || value === "")) {
      errors.push({
        inputName: input.name,
        message: `${input.name} is required`,
        rule: "required",
      });
      continue;
    }

    if (value === undefined || value === null || value === "") continue;

    if (input.type === "number" || input.type === "slider") {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        errors.push({
          inputName: input.name,
          message: "Must be a number",
          rule: "number",
        });
        continue;
      }

      const validation = input.validation;
      if (!validation) continue;

      if (validation.min !== undefined && num < validation.min) {
        errors.push({
          inputName: input.name,
          message: `Must be at least ${validation.min}`,
          rule: "min",
        });
      }
      if (validation.max !== undefined && num > validation.max) {
        errors.push({
          inputName: input.name,
          message: `Must be at most ${validation.max}`,
          rule: "max",
        });
      }
    }

    if (input.type === "text" || input.type === "string") {
      const validation = input.validation;
      if (!validation) continue;

      const str = String(value);
      if (validation.minLength !== undefined && str.length < validation.minLength) {
        errors.push({
          inputName: input.name,
          message: `Must be at least ${validation.minLength} characters`,
          rule: "minLength",
        });
      }
      if (validation.maxLength !== undefined && str.length > validation.maxLength) {
        errors.push({
          inputName: input.name,
          message: `Must be at most ${validation.maxLength} characters`,
          rule: "maxLength",
        });
      }
      if (validation.pattern) {
        try {
          if (!new RegExp(validation.pattern).test(str)) {
            errors.push({
              inputName: input.name,
              message: validation.patternMessage || `Must match pattern: ${validation.pattern}`,
              rule: "pattern",
            });
          }
        } catch {
          // Invalid regex — don't block the user
        }
      }
    }
  }

  return errors;
}
