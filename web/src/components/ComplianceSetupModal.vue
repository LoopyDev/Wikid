<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorkspaceStore } from '../stores/workspace';

// Sets up a compliance database: its fields (from a template) and the workflow between statuses.
// Emits `submit` with { database: { fields, workflow }, title? }, or `cancel`.
const props = defineProps({
  allowTitle: { type: Boolean, default: false },
  defaultTitle: { type: String, default: 'Untitled database' },
  template: { type: String, default: 'inventory' },
});
const emit = defineEmits(['submit', 'cancel']);

const { pages } = storeToRefs(useWorkspaceStore());

const complianceSetupAllowTitle = ref(props.allowTitle);
const complianceSetupTitle = ref(props.defaultTitle);
const complianceSetupFields = ref([]);
const complianceSetupTransitions = ref([]);
const complianceSetupError = ref('');
const complianceSetupFieldSeed = ref(0);
const complianceSetupTransitionSeed = ref(0);
const complianceFieldTypes = [
  { id: 'TEXT', label: 'Text' },
  { id: 'NUMBER', label: 'Number' },
  { id: 'DATE', label: 'Date' },
  { id: 'CHECKBOX', label: 'Checkbox' },
  { id: 'ASSET_TAG', label: 'Asset Tag (QR)' },
  { id: 'SELECT', label: 'Select' },
  { id: 'MULTI_SELECT', label: 'Multi-select' },
  { id: 'RELATION', label: 'Relation' },
  { id: 'URL', label: 'URL' },
];
const complianceStatuses = [
  { id: 'draft', label: 'Draft' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'review', label: 'In Review' },
  { id: 'closed', label: 'Closed/Sealed' },
  { id: 'archived', label: 'Archived' },
];
const complianceDatabaseOptions = computed(() =>
  pages.value.filter(
    (page) => page.kind === 'DATABASE' && page.databaseComplianceMode === true && !page.isDeleted && !page.isHidden
  )
);
const inventoryTemplateFields = [
  { name: 'Item Name', type: 'TEXT', isTitle: true },
  { name: 'Asset Tag', type: 'ASSET_TAG' },
  { name: 'SKU', type: 'TEXT' },
  { name: 'Category', type: 'SELECT', choices: ['Raw Materials', 'Components', 'Finished Goods', 'Consumables', 'Tools'] },
  { name: 'Location', type: 'TEXT' },
  { name: 'Quantity On Hand', type: 'NUMBER' },
  { name: 'Unit', type: 'SELECT', choices: ['ea', 'box', 'kg', 'L', 'm'] },
  { name: 'Reorder Point', type: 'NUMBER' },
  { name: 'Supplier', type: 'TEXT' },
  { name: 'Lot/Batch', type: 'TEXT' },
  { name: 'Serial Number', type: 'TEXT' },
  { name: 'Expiry Date', type: 'DATE' },
  { name: 'Status', type: 'SELECT', choices: ['In Stock', 'Low', 'Out', 'Reserved', 'Discontinued'] },
  { name: 'Notes', type: 'TEXT' },
];
const maintenanceTemplateFields = [
  { name: 'Maintenance Summary', type: 'TEXT', isTitle: true },
  { name: 'Item', type: 'RELATION' },
  { name: 'Event Type', type: 'SELECT', choices: ['Inspection', 'Repair', 'Cleaning', 'Calibration', 'Upgrade', 'Other'] },
  { name: 'Scheduled Date', type: 'DATE' },
  { name: 'Completed Date', type: 'DATE' },
  { name: 'Status', type: 'SELECT', choices: ['Planned', 'In Progress', 'Completed', 'Cancelled'] },
  { name: 'Performed By', type: 'TEXT' },
  { name: 'Vendor', type: 'TEXT' },
  { name: 'Cost', type: 'NUMBER' },
  { name: 'Downtime (hrs)', type: 'NUMBER' },
  { name: 'Findings', type: 'TEXT' },
  { name: 'Actions Taken', type: 'TEXT' },
  { name: 'Parts Used', type: 'TEXT' },
  { name: 'Notes', type: 'TEXT' },
];
const assignmentsTemplateFields = [
  { name: 'Assignment Summary', type: 'TEXT', isTitle: true },
  { name: 'Asset', type: 'RELATION' },
  { name: 'Status', type: 'SELECT', choices: ['Open', 'In Progress', 'Blocked', 'Completed', 'Cancelled'] },
  { name: 'Priority', type: 'SELECT', choices: ['Low', 'Medium', 'High', 'Urgent'] },
  { name: 'Task Type', type: 'SELECT', choices: ['Inspection', 'Repair', 'Cleaning', 'Calibration', 'Move', 'Other'] },
  { name: 'Assigned To', type: 'TEXT' },
  { name: 'Requested By', type: 'TEXT' },
  { name: 'Requested Date', type: 'DATE' },
  { name: 'Due Date', type: 'DATE' },
  { name: 'Completed Date', type: 'DATE' },
  { name: 'Estimated Hours', type: 'NUMBER' },
  { name: 'Actual Hours', type: 'NUMBER' },
  { name: 'Work Order Ref', type: 'TEXT' },
  { name: 'Notes', type: 'TEXT' },
];
const resolveComplianceTemplate = (template) => {
  if (template === 'blank' || template === 'inventory' || template === 'maintenance' || template === 'assignments') {
    return template;
  }
  return 'inventory';
};
const complianceTemplateFields = {
  inventory: inventoryTemplateFields,
  maintenance: maintenanceTemplateFields,
  assignments: assignmentsTemplateFields,
};
const createComplianceField = (overrides = {}) => ({
  id: `csf-${(complianceSetupFieldSeed.value += 1)}`,
  name: '',
  type: 'TEXT',
  choices: '',
  relationPageId: '',
  isTitle: false,
  ...overrides,
});
const createComplianceTransition = (overrides = {}) => ({
  id: `cst-${(complianceSetupTransitionSeed.value += 1)}`,
  from: 'draft',
  to: 'submitted',
  guards: { reviewer: false, approval: false, reason: false },
  ...overrides,
});
const choicesToText = (choices) => (Array.isArray(choices) ? choices.join('\n') : '');
const parseChoicesText = (raw) => {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};
const applyComplianceTemplate = (template) => {
  const templateFields = complianceTemplateFields[template];
  const nextFields = Array.isArray(templateFields)
    ? templateFields.map((field) =>
        createComplianceField({
          name: field.name,
          type: field.type,
          choices: choicesToText(field.choices),
          isTitle: !!field.isTitle,
        })
      )
    : [createComplianceField({ name: 'Name', type: 'TEXT', isTitle: true })];
  complianceSetupFields.value = nextFields;
};
const resetComplianceTransitions = () => {
  complianceSetupTransitions.value = [
    createComplianceTransition({ from: 'draft', to: 'submitted' }),
    createComplianceTransition({ from: 'submitted', to: 'review', guards: { reviewer: true, approval: false, reason: false } }),
    createComplianceTransition({ from: 'review', to: 'closed', guards: { reviewer: true, approval: true, reason: false } }),
    createComplianceTransition({ from: 'closed', to: 'review', guards: { reviewer: false, approval: true, reason: true } }),
  ];
};
const addComplianceField = () => {
  const isFirst = complianceSetupFields.value.length === 0;
  const field = createComplianceField({ isTitle: isFirst });
  complianceSetupFields.value = [...complianceSetupFields.value, field];
};
const removeComplianceField = (fieldId) => {
  const next = complianceSetupFields.value.filter((field) => field.id !== fieldId);
  if (next.length && !next.some((field) => field.isTitle)) {
    next[0] = { ...next[0], isTitle: true, type: 'TEXT' };
  }
  complianceSetupFields.value = next;
};
const clearComplianceFields = () => {
  complianceSetupFields.value = [];
};
const setComplianceTitleField = (fieldId) => {
  complianceSetupFields.value = complianceSetupFields.value.map((field) => {
    const isTitle = field.id === fieldId;
    return {
      ...field,
      isTitle,
      type: isTitle ? 'TEXT' : field.type,
    };
  });
};
const addComplianceTransition = () => {
  const transition = createComplianceTransition({ from: 'submitted', to: 'review' });
  complianceSetupTransitions.value = [...complianceSetupTransitions.value, transition];
};
const removeComplianceTransition = (transitionId) => {
  complianceSetupTransitions.value = complianceSetupTransitions.value.filter((entry) => entry.id !== transitionId);
};
const buildComplianceFieldsPayload = () => {
  const trimmed = complianceSetupFields.value
    .map((field) => ({
      ...field,
      name: typeof field.name === 'string' ? field.name.trim() : '',
    }))
    .filter((field) => field.name);
  if (!trimmed.length) {
    complianceSetupError.value = 'Add at least one field before creating the database.';
    return null;
  }
  const missingRelation = trimmed.some(
    (field) => field.type === 'RELATION' && (!field.relationPageId || !String(field.relationPageId).trim())
  );
  if (missingRelation) {
    complianceSetupError.value = 'Choose a target database for each relation field.';
    return null;
  }
  let titleIndex = trimmed.findIndex((field) => field.isTitle);
  if (titleIndex < 0) titleIndex = 0;
  return trimmed.map((field, index) => {
    const options = {};
    let type = field.isTitle || index === titleIndex ? 'TEXT' : field.type;
    if (type === 'ASSET_TAG') {
      type = 'TEXT';
      options.source = 'assetTag';
      options.readonly = true;
    }
    if (field.isTitle || index === titleIndex) {
      options.source = 'page';
    }
    if (type === 'RELATION') {
      const targetId = typeof field.relationPageId === 'string' ? field.relationPageId.trim() : '';
      if (targetId) {
        options.relation = { pageId: targetId, allowMultiple: false };
      }
    }
    if (type === 'SELECT' || type === 'MULTI_SELECT') {
      const choices = parseChoicesText(field.choices);
      if (choices.length) options.choices = choices;
    }
    return { name: field.name, type, options };
  });
};
const buildComplianceWorkflowPayload = () => {
  const transitions = complianceSetupTransitions.value
    .filter((entry) => entry.from && entry.to)
    .map((entry) => {
      const guards = [];
      if (entry.guards?.reviewer) guards.push({ type: 'role', value: 'reviewer' });
      if (entry.guards?.approval) guards.push({ type: 'approval' });
      if (entry.guards?.reason) guards.push({ type: 'reason' });
      return { from: entry.from, to: entry.to, guards };
    });
  return {
    states: complianceStatuses.map((state) => ({ id: state.id, label: state.label })),
    transitions,
  };
};
// Fills in the chosen template's fields and the standard workflow.
const complianceSetupTemplate = ref(resolveComplianceTemplate(props.template));
applyComplianceTemplate(complianceSetupTemplate.value);
resetComplianceTransitions();

const submit = () => {
  complianceSetupError.value = '';
  const fields = buildComplianceFieldsPayload();
  if (!fields) return;
  const workflow = buildComplianceWorkflowPayload();
  const result = { database: { fields, workflow } };
  if (complianceSetupAllowTitle.value) {
    const title = complianceSetupTitle.value.trim();
    if (title) result.title = title;
  }
  emit('submit', result);
};
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <div class="modal-card compliance-setup-modal">
      <h3>Create compliance database</h3>
      <p class="muted">Define the data model and compliance workflow for this database.</p>
      <div class="compliance-setup__body">
        <div v-if="complianceSetupAllowTitle" class="form-field">
          <div class="form-field__label-row">
            <label class="form-field__label">Title</label>
          </div>
          <input v-model="complianceSetupTitle" class="form-input" type="text" placeholder="Inventory database" />
        </div>
        <div class="form-field compliance-template-field">
          <div class="form-field__label-row">
            <label class="form-field__label">Template</label>
          </div>
          <div class="compliance-template__row">
            <select v-model="complianceSetupTemplate" class="form-input">
              <option value="inventory">Inventory template</option>
              <option value="maintenance">Maintenance log template</option>
              <option value="assignments">Assignments template</option>
              <option value="blank">Blank</option>
            </select>
            <button class="ghost-btn" type="button" @click="applyComplianceTemplate(complianceSetupTemplate)">
              Apply template
            </button>
          </div>
          <div class="form-field__note muted">Applying a template replaces the current field list.</div>
        </div>
        <div class="compliance-setup__section">
          <div class="compliance-setup__section-header">
            <h4 class="compliance-setup__section-title">Fields</h4>
            <span class="muted">The compliance schema stored with each revision.</span>
          </div>
          <div v-if="!complianceSetupFields.length" class="muted">No fields yet. Add one below.</div>
          <div v-for="field in complianceSetupFields" :key="field.id" class="compliance-field">
            <div class="compliance-field__row">
              <input
                v-model="field.name"
                class="form-input compliance-field__name"
                type="text"
                placeholder="Field name"
              />
              <select v-model="field.type" class="form-input compliance-field__type" :disabled="field.isTitle">
                <option v-for="type in complianceFieldTypes" :key="type.id" :value="type.id">
                  {{ type.label }}
                </option>
              </select>
              <label class="compliance-field__title">
                <input
                  type="radio"
                  name="compliance-title-field"
                  :checked="field.isTitle"
                  @change="setComplianceTitleField(field.id)"
                />
                Title field
              </label>
              <button class="ghost-btn compliance-field__remove" type="button" @click="removeComplianceField(field.id)">
                Remove
              </button>
            </div>
            <div v-if="field.type === 'SELECT' || field.type === 'MULTI_SELECT'" class="compliance-field__choices">
              <label class="form-field__label">Choices</label>
              <textarea
                v-model="field.choices"
                class="form-input form-input--multi"
                placeholder="One choice per line"
              ></textarea>
            </div>
            <div v-if="field.type === 'RELATION'" class="compliance-field__choices">
              <label class="form-field__label">Target database</label>
              <select
                v-model="field.relationPageId"
                class="form-input"
                :disabled="!complianceDatabaseOptions.length"
              >
                <option value="">Select a compliance database...</option>
                <option v-for="page in complianceDatabaseOptions" :key="page.id" :value="page.id">
                  {{ page.title || 'Untitled database' }}
                </option>
              </select>
              <div class="form-field__note muted">
                Relations can only target other compliance databases.
              </div>
            </div>
          </div>
          <div class="compliance-setup__actions">
            <button class="ghost-btn" type="button" @click="addComplianceField">Add field</button>
            <button class="ghost-btn" type="button" @click="clearComplianceFields">Clear fields</button>
          </div>
        </div>
        <div class="compliance-setup__section">
          <div class="compliance-setup__section-header">
            <h4 class="compliance-setup__section-title">Workflow transitions</h4>
            <span class="muted">Guards are enforced when statuses change.</span>
          </div>
          <div v-for="transition in complianceSetupTransitions" :key="transition.id" class="compliance-transition">
            <div class="compliance-transition__row">
              <select v-model="transition.from" class="form-input compliance-transition__select">
                <option v-for="state in complianceStatuses" :key="state.id" :value="state.id">
                  {{ state.label }}
                </option>
              </select>
              <span class="compliance-transition__arrow">-&gt;</span>
              <select v-model="transition.to" class="form-input compliance-transition__select">
                <option v-for="state in complianceStatuses" :key="state.id" :value="state.id">
                  {{ state.label }}
                </option>
              </select>
              <button
                class="ghost-btn compliance-transition__remove"
                type="button"
                @click="removeComplianceTransition(transition.id)"
              >
                Remove
              </button>
            </div>
            <div class="compliance-transition__guards">
              <label class="compliance-transition__guard">
                <input type="checkbox" v-model="transition.guards.reviewer" />
                Reviewer
              </label>
              <label class="compliance-transition__guard">
                <input type="checkbox" v-model="transition.guards.approval" />
                Approval
              </label>
              <label class="compliance-transition__guard">
                <input type="checkbox" v-model="transition.guards.reason" />
                Reason
              </label>
            </div>
          </div>
          <div class="compliance-setup__actions">
            <button class="ghost-btn" type="button" @click="addComplianceTransition">Add transition</button>
            <button class="ghost-btn" type="button" @click="resetComplianceTransitions">Reset defaults</button>
          </div>
        </div>
      </div>
      <span v-if="complianceSetupError" class="alert">{{ complianceSetupError }}</span>
      <div class="modal-actions">
        <button class="ghost-btn" type="button" @click="submit">Create</button>
        <button class="ghost-btn" type="button" @click="emit('cancel')">Cancel</button>
      </div>
    </div>
  </div>
</template>
