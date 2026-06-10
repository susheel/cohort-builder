import type { Field, OptionList } from 'react-querybuilder';
import type { CohortSpec, VariableSpec } from '../spec/types';

/**
 * Operator names used across the app. These are interpreted by our own tree
 * compiler (src/query/compileTree.ts), not by react-querybuilder's formatQuery.
 */
export const OP = {
  in: 'in', // ANY of (OR / IN)
  notIn: 'notIn', // NONE of (NOT IN)
  all: 'all', // ALL of (file-level: linked to files covering every value)
  is: '=', // boolean / equality
  between: 'between', // numeric range
  gte: '>=', // minimum count
} as const;

/** react-querybuilder Field carrying our extra metadata. */
export interface CohortField extends Field {
  /** the spec variable this field maps to */
  variable: VariableSpec;
  /** widget hint for the custom value editor */
  cbWidget: VariableSpec['widget'];
  cbEntity: string;
  cbIsFileLevel: boolean;
  cbSensitivity: VariableSpec['sensitivity'];
}

function valuesToOptionList(values?: string[]): OptionList | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((v) => ({ name: v, label: v }));
}

/** Build the react-querybuilder field list from a resolved spec. */
export function buildFields(spec: CohortSpec): CohortField[] {
  const fields: CohortField[] = [];
  for (const v of spec.variables) {
    if (v.visible === false || v.widget === 'internal') continue;
    const isFile = v.entity !== spec.primaryEntity;

    let operators: { name: string; label: string }[];
    let valueEditorType: Field['valueEditorType'] = 'text';
    let values: OptionList | undefined;
    let defaultOperator: string = OP.in;
    let defaultValue: unknown = [];
    let inputType: string | undefined;

    switch (v.widget) {
      case 'boolean':
        operators = [{ name: OP.is, label: 'is' }];
        valueEditorType = 'radio';
        values = [
          { name: 'true', label: v.booleanLabels?.yes ?? 'Yes' },
          { name: 'false', label: v.booleanLabels?.no ?? 'No' },
        ];
        defaultOperator = OP.is;
        defaultValue = 'true';
        break;
      case 'multiselect':
        operators = isFile
          ? [
              { name: OP.in, label: 'is any of' },
              { name: OP.all, label: 'is all of' },
              { name: OP.notIn, label: 'is none of' },
            ]
          : [
              { name: OP.in, label: 'is any of' },
              { name: OP.notIn, label: 'is none of' },
            ];
        valueEditorType = 'multiselect';
        values = valuesToOptionList(v.values);
        defaultOperator = OP.in;
        defaultValue = [];
        break;
      case 'bins':
        operators = [
          { name: OP.in, label: 'is in' },
          { name: OP.notIn, label: 'is not in' },
        ];
        valueEditorType = 'multiselect';
        values = valuesToOptionList((v.bins ?? []).map((b) => b.label));
        defaultOperator = OP.in;
        defaultValue = [];
        break;
      case 'minCount':
        operators = [{ name: OP.gte, label: 'at least' }];
        valueEditorType = 'select';
        values = (v.options ?? []).map((o) => ({ name: String(o.min), label: o.label }));
        defaultOperator = OP.gte;
        defaultValue = String(v.options?.[0]?.min ?? 1);
        break;
      case 'range':
        operators = [{ name: OP.between, label: 'between' }];
        valueEditorType = 'text';
        inputType = 'number';
        defaultOperator = OP.between;
        defaultValue = `${v.range?.min ?? 0},${v.range?.max ?? 100}`;
        break;
      default:
        operators = [{ name: OP.in, label: 'is any of' }];
    }

    fields.push({
      name: v.name,
      label: v.label,
      operators,
      defaultOperator,
      defaultValue,
      valueEditorType,
      values,
      inputType,
      variable: v,
      cbWidget: v.widget,
      cbEntity: v.entity,
      cbIsFileLevel: isFile,
      cbSensitivity: v.sensitivity,
    });
  }
  return fields;
}

export function fieldByName(fields: CohortField[], name: string): CohortField | undefined {
  return fields.find((f) => f.name === name);
}
