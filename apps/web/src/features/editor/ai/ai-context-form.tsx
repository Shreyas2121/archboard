import {
  COMPONENT_CATEGORIES,
  MAX_AI_CONTEXT_COMPONENTS,
  MAX_AI_CONTEXT_CONNECTIONS,
  MAX_NODE_TITLE_CHARACTERS,
  MAX_COMPONENT_DESCRIPTION_CHARACTERS,
  MAX_TECHNOLOGY_CHARACTERS,
  MAX_AI_TEXT_CHARACTERS,
  MAX_AI_SEMANTIC_KEY_CHARACTERS,
  MAX_EDGE_LABEL_CHARACTERS,
  MAX_EDGE_PROTOCOL_CHARACTERS,
} from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import type { AiContextForm } from './ai-review-model';

export function AiContextFormFields({
  form,
  disabled,
  change,
}: {
  readonly form: AiContextForm;
  readonly disabled: boolean;
  readonly change: (form: AiContextForm) => void;
}) {
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      <legend className="mb-2 text-sm font-medium">Project context</legend>
      <Label htmlFor="ai-project-name">Project name</Label>
      <Input
        id="ai-project-name"
        value={form.name}
        maxLength={MAX_NODE_TITLE_CHARACTERS}
        onChange={(event) => change({ ...form, name: event.target.value })}
      />
      <Label htmlFor="ai-project-description">What does the project do?</Label>
      <Textarea
        id="ai-project-description"
        value={form.description}
        maxLength={MAX_AI_TEXT_CHARACTERS}
        onChange={(event) => change({ ...form, description: event.target.value })}
      />
      <Label htmlFor="ai-technologies">Technologies (one per line)</Label>
      <Textarea
        id="ai-technologies"
        value={form.technologies}
        onChange={(event) => change({ ...form, technologies: event.target.value })}
      />
      <p className="text-xs text-muted-foreground">
        Describe only facts you choose to share. Evidence and visual groups can be included through
        the JSON file option.
      </p>
      {form.components.map((component) => (
        <fieldset key={component.rowId} className="grid gap-2 rounded-lg border p-3">
          <legend className="text-sm">Component {component.key}</legend>
          <Label htmlFor={`${component.rowId}-key`}>Logical key</Label>
          <Input
            id={`${component.rowId}-key`}
            value={component.key}
            maxLength={MAX_AI_SEMANTIC_KEY_CHARACTERS}
            onChange={(event) =>
              change({
                ...form,
                components: form.components.map((row) =>
                  row.rowId === component.rowId ? { ...row, key: event.target.value } : row,
                ),
              })
            }
          />
          <Label htmlFor={`${component.rowId}-name`}>Name</Label>
          <Input
            id={`${component.rowId}-name`}
            value={component.name}
            maxLength={MAX_NODE_TITLE_CHARACTERS}
            onChange={(event) =>
              change({
                ...form,
                components: form.components.map((row) =>
                  row.rowId === component.rowId ? { ...row, name: event.target.value } : row,
                ),
              })
            }
          />
          <Label htmlFor={`${component.rowId}-category`}>Category</Label>
          <Select
            disabled={disabled}
            value={component.category}
            onValueChange={(value) => {
              const category = Object.values(COMPONENT_CATEGORIES).find(
                (category) => category === value,
              );
              if (category)
                change({
                  ...form,
                  components: form.components.map((row) =>
                    row.rowId === component.rowId ? { ...row, category } : row,
                  ),
                });
            }}
          >
            <SelectTrigger id={`${component.rowId}-category`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(COMPONENT_CATEGORIES).map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor={`${component.rowId}-technology`}>Technology</Label>
          <Input
            id={`${component.rowId}-technology`}
            value={component.technology}
            maxLength={MAX_TECHNOLOGY_CHARACTERS}
            onChange={(event) =>
              change({
                ...form,
                components: form.components.map((row) =>
                  row.rowId === component.rowId ? { ...row, technology: event.target.value } : row,
                ),
              })
            }
          />
          <Label htmlFor={`${component.rowId}-description`}>Description</Label>
          <Textarea
            id={`${component.rowId}-description`}
            value={component.description}
            maxLength={MAX_COMPONENT_DESCRIPTION_CHARACTERS}
            onChange={(event) =>
              change({
                ...form,
                components: form.components.map((row) =>
                  row.rowId === component.rowId ? { ...row, description: event.target.value } : row,
                ),
              })
            }
          />
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              change({
                ...form,
                components: form.components.filter((row) => row.rowId !== component.rowId),
              })
            }
          >
            Remove component
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || form.components.length >= MAX_AI_CONTEXT_COMPONENTS}
        onClick={() => {
          const rowId = crypto.randomUUID();
          change({
            ...form,
            components: [
              ...form.components,
              {
                rowId,
                key: `component-${rowId}`,
                name: '',
                category: 'service',
                technology: '',
                description: '',
                evidenceKeys: [],
              },
            ],
          });
        }}
      >
        Add component
      </Button>
      {form.connections.map((connection) => (
        <fieldset key={connection.rowId} className="grid gap-2 rounded-lg border p-3">
          <legend className="text-sm">Connection</legend>
          {(['source', 'target'] as const).map((field) => (
            <div key={field} className="grid gap-2">
              <Label htmlFor={`${connection.rowId}-${field}`}>
                {field === 'source' ? 'Source key' : 'Target key'}
              </Label>
              <Input
                id={`${connection.rowId}-${field}`}
                value={connection[field]}
                maxLength={MAX_AI_SEMANTIC_KEY_CHARACTERS}
                onChange={(event) =>
                  change({
                    ...form,
                    connections: form.connections.map((row) =>
                      row.rowId === connection.rowId
                        ? { ...row, [field]: event.target.value }
                        : row,
                    ),
                  })
                }
              />
            </div>
          ))}
          <Label htmlFor={`${connection.rowId}-label`}>Label</Label>
          <Input
            id={`${connection.rowId}-label`}
            value={connection.label}
            maxLength={MAX_EDGE_LABEL_CHARACTERS}
            onChange={(event) =>
              change({
                ...form,
                connections: form.connections.map((row) =>
                  row.rowId === connection.rowId ? { ...row, label: event.target.value } : row,
                ),
              })
            }
          />
          <Label htmlFor={`${connection.rowId}-protocol`}>Protocol</Label>
          <Input
            id={`${connection.rowId}-protocol`}
            value={connection.protocol}
            maxLength={MAX_EDGE_PROTOCOL_CHARACTERS}
            onChange={(event) =>
              change({
                ...form,
                connections: form.connections.map((row) =>
                  row.rowId === connection.rowId ? { ...row, protocol: event.target.value } : row,
                ),
              })
            }
          />
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              change({
                ...form,
                connections: form.connections.filter((row) => row.rowId !== connection.rowId),
              })
            }
          >
            Remove connection
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || form.connections.length >= MAX_AI_CONTEXT_CONNECTIONS}
        onClick={() =>
          change({
            ...form,
            connections: [
              ...form.connections,
              {
                rowId: crypto.randomUUID(),
                source: '',
                target: '',
                label: '',
                protocol: '',
                evidenceKeys: [],
              },
            ],
          })
        }
      >
        Add connection
      </Button>
      <Label htmlFor="ai-constraints">Constraints (one per line)</Label>
      <Textarea
        id="ai-constraints"
        value={form.constraints}
        onChange={(event) => change({ ...form, constraints: event.target.value })}
      />
      <Label htmlFor="ai-unknowns">Unknowns and open questions (one per line)</Label>
      <Textarea
        id="ai-unknowns"
        value={form.unknowns}
        onChange={(event) => change({ ...form, unknowns: event.target.value })}
      />
    </fieldset>
  );
}
